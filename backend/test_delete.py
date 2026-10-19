"""Run with: python test_delete.py (inside the backend venv).
Deleting calls: who may, what is removed (memory AND saved storage), ordering against queued saves, failures, retention."""
import os
os.environ.setdefault("FIREBASE_ENABLED", "false")
from datetime import datetime, timedelta, timezone

# ---------- minimal in-memory Firestore stand-in (with delete and a date filter) ----------
class Snap:
    def __init__(s, db, path, data): s._db, s.path, s.id, s._d = db, path, path[-1], data
    def to_dict(s): return dict(s._d)
    @property
    def reference(s): return Doc(s._db, s.path)
class Col:
    def __init__(s, db, path): s._db, s.path, s._flt = db, path, None
    def document(s, id): return Doc(s._db, s.path + (id,))
    def where(s, *a, filter=None, **k): s._flt = filter; return s
    def stream(s, **kw):
        n = len(s.path) + 1
        for p, d in list(s._db.data.items()):
            if len(p) == n and p[:-1] == s.path and (not s._flt or d.get(s._flt.field_path) < s._flt.value):
                yield Snap(s._db, p, d)
class Doc:
    def __init__(s, db, path): s._db, s.path = db, path
    def collection(s, name): return Col(s._db, s.path + (name,))
    def set(s, data, merge=False, **kw):
        cur = s._db.data.get(s.path, {}) if merge else {}
        cur.update(data); s._db.data[s.path] = cur
    def delete(s, **kw): s._db.data.pop(s.path, None)
class DB:
    def __init__(s): s.data = {}
    def collection(s, name): return Col(s, (name,))

from app import persistence  # noqa: E402
from app.config import Settings  # noqa: E402
Settings.firestore_enabled = property(lambda s: s.FIRESTORE_ENABLED)  # in-memory fake: no key file needed
db = DB()
persistence.repo._db = db

from starlette.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.models import Call, CallStatus, TranscriptChunk  # noqa: E402
from app.store import store  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


def docs_of(call_id):
    return [p for p in db.data if p[:2] == ("calls", call_id)]


a, b = TestClient(app), TestClient(app)
a.post("/api/auth/dev-login", json={"email": "a@example.com"})
b.post("/api/auth/dev-login", json={"email": "b@example.com"})


def make_call(client, label, ended=True):
    cid = client.post("/api/calls", json={"label": label}).json()["id"]
    for t in ["I am calling from your bank", "Share your otp now, your account will be blocked"]:
        client.post(f"/api/calls/{cid}/ingest", json={"text": t, "speaker": "caller"})
    client.post(f"/api/calls/{cid}/actions", json={"type": "flagged"})
    if ended:
        client.post(f"/api/calls/{cid}/end")
    return cid


# ------------------------------------------------------------------ one call
c1 = make_call(a, "to delete")
other = make_call(a, "to keep")
persistence.repo.flush()
expect(len(docs_of(c1)) > 5, f"the call is saved with its transcript, alerts, actions and risk history ({len(docs_of(c1))} documents)")

expect(TestClient(app).delete(f"/api/calls/{c1}").status_code == 401, "not signed in -> 401")
expect(b.delete(f"/api/calls/{c1}").status_code == 404, "a person with no access gets 404 and nothing is deleted")
expect(a.get(f"/api/calls/{c1}").status_code == 200, "...the call is still there")

store.add_participant(c1, "dev:b@example.com")
r = b.delete(f"/api/calls/{c1}")
expect(r.status_code == 403, "a joined participant may not delete the owner's call (403)")

live = make_call(a, "still going", ended=False)
r = a.delete(f"/api/calls/{live}")
expect(r.status_code == 409 and a.get(f"/api/calls/{live}").status_code == 200, "a call in progress cannot be deleted (409)")

with a.websocket_connect("/ws/dashboard") as ws:
    ws.receive_json()  # snapshot
    r = a.delete(f"/api/calls/{c1}")
    expect(r.status_code == 200 and r.json() == {"ok": True}, "owner deletes an ended call")
    ev = ws.receive_json()
    expect(ev == {"type": "call_deleted", "call_id": c1}, "open dashboards are told the call is gone")
expect(a.get(f"/api/calls/{c1}").status_code == 404, "it is gone from the API")
expect(c1 not in [c["id"] for c in a.get("/api/calls").json()], "...and from the list")
expect(a.post(f"/api/calls/{c1}/evaluate", json={"message": "hi"}).status_code == 404, "...and the evaluator can no longer reach it")
persistence.repo.flush()
expect(docs_of(c1) == [], "...and every saved document is gone (call, transcript, alerts, actions, risk history)")
expect(len(docs_of(other)) > 5, "other calls are untouched in saved storage")
expect(a.delete(f"/api/calls/{c1}").status_code == 404, "deleting twice -> 404")

# ------------------------------------------------------------------ ordering: a save still waiting cannot bring it back
c2 = make_call(a, "race")           # saves are queued right now, not flushed
expect(a.delete(f"/api/calls/{c2}").status_code == 200, "delete straight after the writes")
persistence.repo.flush()
expect(docs_of(c2) == [], "queued saves run first, then the delete: nothing comes back")

# ------------------------------------------------------------------ failure is reported, nothing removed
c3 = make_call(a, "fail")
persistence.repo.flush()
real = persistence.repo.delete_call
def boom(_id): raise RuntimeError("the delete queue is full")
persistence.repo.delete_call = boom
r = a.delete(f"/api/calls/{c3}")
persistence.repo.delete_call = real
expect(r.status_code == 503 and a.get(f"/api/calls/{c3}").status_code == 200, "if the saved copy cannot be deleted: 503 and the call is kept (never reported deleted)")
expect(len(docs_of(c3)) > 5, "...and its saved copy is intact")

# ------------------------------------------------------------------ delete all of my history
bcall = make_call(b, "b's call")
r = a.delete("/api/calls")
body = r.json()
expect(r.status_code == 200 and body["skipped_active"] == 1 and body["deleted"] >= 2, f"delete all: {body}")
ids = [c["id"] for c in a.get("/api/calls").json()]
expect(live in ids and other not in ids and c3 not in ids, "only ended calls were deleted; the call in progress is kept")
expect(b.get(f"/api/calls/{bcall}").status_code == 200, "another person's calls are never touched")
persistence.repo.flush()
expect(docs_of(other) == [] and docs_of(c3) == [] and len(docs_of(bcall)) > 5, "saved storage matches")
expect(TestClient(app).delete("/api/calls").status_code == 401, "delete all needs sign-in")

# ------------------------------------------------------------------ retention
store.reset()
db.data.clear()
now = datetime.now(timezone.utc)
def add(label, started_days_ago, ended=True):
    c = store.create_call(label, "simulated", owner_uid="u")
    c.started_at = (now - timedelta(days=started_days_ago)).isoformat()
    if ended:
        store.add_transcript_and_score(c.id, TranscriptChunk(text="hello"))
        c.status = CallStatus.ended
        c.ended_at = (now - timedelta(days=started_days_ago)).isoformat()
    persistence.repo.save_call(c, set())
    return c.id
old, fresh, old_active = add("old", 40), add("fresh", 2), add("old but active", 40, ended=False)
persistence.repo.flush()
# one very old call that exists only in saved storage (never loaded back into memory)
db.data[("calls", "ghost")] = {"status": "ended", "started_at": now - timedelta(days=90)}
db.data[("calls", "ghost", "transcript", "t1")] = {"text": "old words"}

expect(store.purge_older_than(0) == 0 and store.get(old) is not None, "retention 0 = off, nothing deleted")
n = store.purge_older_than(30)
persistence.repo.flush()
expect(n == 2, f"retention 30 days removed 2 calls (the old one and the saved-only one), got {n}")
expect(store.get(old) is None and store.get(fresh) is not None, "old call removed, recent call kept")
expect(store.get(old_active) is not None, "a call still in progress is never purged")
expect(docs_of("ghost") == [] and docs_of(old) == [] and docs_of(fresh) != [], "saved storage: old and saved-only calls gone, recent kept")

print("\nALL DELETION TESTS PASSED")

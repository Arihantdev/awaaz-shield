import sys, time, logging
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
logging.basicConfig(level=logging.WARNING)
from datetime import datetime

# ---------- minimal in-memory Firestore stand-in ----------
class Snap:
    def __init__(s, path, data): s.path, s.id, s._d = path, path[-1], data
    def to_dict(s): return dict(s._d)
    @property
    def reference(s): return Doc(s._db, s.path)
class Col:
    def __init__(s, db, path): s._db, s.path, s._order, s._lim = db, path, None, None
    def document(s, id): return Doc(s._db, s.path + (id,))
    def order_by(s, f, direction="ASCENDING"): s._order = (f, direction); return s
    def limit(s, n): s._lim = n; return s
    def stream(s, **kw):
        if s._db.fail: raise ConnectionError("firestore down")
        n = len(s.path) + 1
        items = [(p, d) for p, d in s._db.data.items() if len(p) == n and p[:-1] == s.path]
        if s._order:
            f, dr = s._order; items.sort(key=lambda x: x[1].get(f), reverse=(dr == "DESCENDING"))
        if s._lim: items = items[: s._lim]
        for p, d in items:
            sn = Snap(p, d); sn._db = s._db; yield sn
class Doc:
    def __init__(s, db, path): s._db, s.path = db, path
    def collection(s, name): return Col(s._db, s.path + (name,))
    def set(s, data, merge=False, **kw):
        if s._db.fail: raise ConnectionError("firestore down")
        assert kw.get("timeout") and "retry" in kw
        cur = s._db.data.get(s.path, {}) if merge else {}
        cur.update(data); s._db.data[s.path] = cur
class DB:
    def __init__(s): s.data, s.fail = {}, False
    def collection(s, name): return Col(s, (name,))

from app import persistence
from app.config import Settings, settings
# Tests use an in-memory fake, so don't require a real key file: "enabled" just follows FIRESTORE_ENABLED.
Settings.firestore_enabled = property(lambda s: s.FIRESTORE_ENABLED)
from app.store import CallStore
from app.models import TranscriptChunk

def ok(c, m): print(("[OK ] " if c else "[FAIL] ") + m); (c or sys.exit(1))

# ---------- 1. save ----------
db = DB(); persistence.repo._db = db
s1 = CallStore()
call = s1.create_call("Test call", "simulated", owner_uid="u1", owner_email="op@example.com")
s1.add_transcript_and_score(call.id, TranscriptChunk(text="Hello, this is from the bank, your account will be blocked", speaker="caller"))
s1.add_transcript_and_score(call.id, TranscriptChunk(text="Share the otp 482913 and my card is 4111 1111 1111 1111, do not disconnect the call", speaker="caller"))
s1.record_action(call.id, "escalated", "called customer on 9876543210", by_uid="u1")
s1.end_for_risk(call.id, 75)  # escalates (sent to operators) and ends the call, recording why
ok(persistence.repo.flush(), "writes flushed")
doc = db.data[("calls", call.id)]
print("   doc:", {k: doc[k] for k in ("status","current_score","current_level","max_score","alert_count","disposition","owner_email")})
ok(doc["owner_uid"] == "u1" and doc["disposition"] == "escalated" and doc["status"] == "ended", "summary doc has owner/disposition/status")
ok(isinstance(doc["started_at"], datetime) and doc["alert_count"] == len(call.alerts) >= 1, "timestamps are datetimes, alert_count right")
texts = [d["text"] for p, d in db.data.items() if p[:3] == ("calls", call.id, "transcript")]
ok(len(texts) == 2 and not any("482913" in t or "4111" in t for t in texts), f"transcripts saved & digits masked: {texts[1][:60]}")
ok(call.transcript[1].text.count("482913") == 1, "in-memory transcript keeps raw text (scoring unaffected)")
note = [d["note"] for p, d in db.data.items() if p[:3] == ("calls", call.id, "actions")][0]
ok("9876543210" not in note, f"action note masked: {note}")
ok(sum(1 for p in db.data if p[:3] == ("calls", call.id, "risk_history")) == 2, "risk points saved")
ok(sum(1 for p in db.data if p[:3] == ("calls", call.id, "alerts")) == len(call.alerts), "alerts saved")

# ---------- 2. restart -> load ----------
s2 = CallStore()
n = s2.load_from_persistence()
ok(n == 1, "loaded 1 call after 'restart'")
l = s2.get(call.id)
ok(l.current_score == call.current_score and l.current_level == call.current_level, f"score/level restored ({l.current_score}, {l.current_level.value})")
ok(len(l.transcript) == 2 and len(l.alerts) == len(call.alerts) and len(l.risk_history) == 2 and len(l.actions) == 2, "transcript/alerts/risk/actions restored")
ok(l.disposition == "escalated" and l.owner_email == "op@example.com", "disposition + owner restored")
ok(l.ended_reason == "auto_risk" and l.ended_threshold == 75 and l.shared_with_operators is True, "auto-end reason, limit and operator sharing restored")
ok(isinstance(l.started_at, str) and "T" in l.started_at, "timestamps back to ISO strings")
l.model_dump_json()  # serialisable for API/websocket
ok(s2.analytics()["monitored_calls"] == 1, "analytics sees loaded call")

# ---------- 3. call left active across restart gets closed ----------
c2 = s1.create_call("Left open", "simulated"); s1.add_transcript_and_score(c2.id, TranscriptChunk(text="hello")); persistence.repo.flush()
s3 = CallStore(); s3.load_from_persistence(); persistence.repo.flush()
ok(s3.get(c2.id).status.value == "ended", "stale active call closed on load")
ok(db.data[("calls", c2.id)]["status"] == "ended", "...and persisted as ended")

# ---------- 4. seed-script docs load correctly ----------
import seed_firestore   # (importing it switches persistence OFF so building samples writes nothing)
ok(not persistence.repo.enabled, "seed script turns store persistence off while building samples")
junk = DB(); persistence.repo._db = junk; seed_firestore.build_calls(); persistence.repo.flush()
ok(len(junk.data) == 0, f"building seed calls wrote nothing to Firestore ({len(junk.data)} docs)")
settings.FIRESTORE_ENABLED = True   # negative control: with persistence ON the same build WOULD write
junk2 = DB(); persistence.repo._db = junk2; seed_firestore.build_calls(); persistence.repo.flush()
ok(len(junk2.data) > 0, f"negative control: with persistence on it writes ({len(junk2.data)} docs) -> the guard matters")
settings.FIRESTORE_ENABLED = False  # building sample data must not write on its own
db2 = DB(); persistence.repo._db = db2
_seed = seed_firestore.build_calls()
settings.FIRESTORE_ENABLED = True   # ...but loading needs persistence on
for c in _seed:
    db2.data[("calls", c["id"])] = c["doc"]
    for sub in ("transcript", "alerts", "actions", "risk_history"):
        for it in c[sub]: db2.data[("calls", c["id"], sub, it["id"])] = {k: v for k, v in it.items() if k != "id"}
s4 = CallStore(); n = s4.load_from_persistence()
ok(n == 7, f"all 7 seeded calls load (got {n}; db2 docs={len(db2.data)}; top-level={sorted(p[1] for p in db2.data if len(p)==2)})")
lv = {c.id: (c.current_level.value, c.current_score, c.disposition, len(c.transcript)) for c in s4.list_calls()}
print("  ", lv["seed-01"], lv["seed-06"])
ok(lv["seed-01"][0] == "critical" and lv["seed-06"][0] == "low" and lv["seed-06"][2] == "dismissed", "seed levels/dispositions correct")
ok(s4.list_calls()[0].id == "seed-01", "newest first")

# ---------- 5. Firestore down: app keeps working ----------
db3 = DB(); db3.fail = True; persistence.repo._db = db3
s5 = CallStore(); t = time.time()
c = s5.create_call("x", "simulated"); r = s5.add_transcript_and_score(c.id, TranscriptChunk(text="share the otp"))
ok(r.current_score > 0 and time.time() - t < 0.5, f"ingest unaffected & non-blocking while Firestore down ({time.time()-t:.2f}s)")
ok(CallStore().load_from_persistence() == 0, "load returns 0 (no crash) when Firestore down")
persistence.repo.flush(15)

# ---------- 6. disabled ----------
persistence.repo._db = None
settings.FIRESTORE_ENABLED = False
ok(not persistence.repo.enabled, "disabled when Firebase not configured (no thread, no writes)")
print("\nALL PERSISTENCE TESTS PASSED")

# ---------- 7. concurrent first use of the Firebase app / Firestore client (startup race) ----------
import threading, importlib
from app import auth
import firebase_admin
from firebase_admin import credentials
from google.auth.credentials import AnonymousCredentials


class TestCredential(credentials.Base):
    def get_credential(self):
        return AnonymousCredentials()


# Keep the concurrency check self-contained: a clean checkout deliberately has no service-account file.
credentials.Certificate = lambda _path: TestCredential()
os.environ["GOOGLE_CLOUD_PROJECT"] = "awaaz-shield-test"
for a in list(firebase_admin._apps.values()): firebase_admin.delete_app(a)
auth._firebase_app = None
settings.FIREBASE_ENABLED = True; settings.FIRESTORE_ENABLED = True
errs, apps = [], []
def grab():
    try: apps.append(auth._get_firebase_app())
    except Exception as e: errs.append(e)
ts = [threading.Thread(target=grab) for _ in range(12)]
[t.start() for t in ts]; [t.join() for t in ts]
ok(not errs and len({id(a) for a in apps}) == 1, f"12 threads share ONE Firebase app, no 'already exists' error ({errs[:1]})")
r = persistence.FirestoreRepo(); cl = []
ts = [threading.Thread(target=lambda: cl.append(r._client())) for _ in range(12)]
[t.start() for t in ts]; [t.join() for t in ts]
ok(len({id(c) for c in cl}) == 1, "12 threads share ONE Firestore client")
print("\nALL TESTS (incl. race) PASSED")

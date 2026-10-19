"""Run with: python test_evaluator.py (inside the backend venv).
Covers the risk-evaluator chat, configurable risk bands, and who may see which call."""
import os

os.environ.setdefault("FIREBASE_ENABLED", "false")

from starlette.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Call, RiskLevel, Speaker, TranscriptChunk, level_for_score  # noqa: E402
from app.risk.evaluator import evaluate  # noqa: E402
from app.store import store  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


# ------------------------------------------------------------------ evaluator on typed text only
empty = Call(label="no transcript")
e = evaluate(empty, "Is this caller trying to scam me?")
expect(e.basis == "none" and e.score is None and e.level is None, "no evidence at all -> no score is invented")
expect("no transcript" in e.basis_note.lower(), "says plainly that there is no transcript")

for msg, minimum in [
    ("They are asking for my OTP. Is that dangerous?", RiskLevel.high),
    ("They are asking me to install an application.", RiskLevel.medium),
    ("The caller says my bank account will be blocked.", RiskLevel.medium),
    ("The caller claims that I am involved in a legal case.", RiskLevel.medium),
]:
    e = evaluate(empty, msg)
    order = ["low", "medium", "high", "critical"]
    expect(e.basis == "user_text" and e.score and order.index(e.level.value) >= order.index(minimum.value),
           f"typed report -> {e.score} {e.level.value} (user_text): {msg}")
    expect("not been verified" in e.basis_note, "typed report is labelled unverified")
    expect(e.warning_signs and e.recommended_steps and e.answer and e.disclaimer, "has signs, steps, answer and disclaimer")

for msg in ["They did not ask for my OTP, just my name.", "I never share my OTP with anyone.", "hi what is the weather today"]:
    expect(evaluate(empty, msg).score is None, f"negation / unrelated text gives no score: {msg}")

# ------------------------------------------------------------------ evaluator with a transcript
call = store.create_call("eval test", "simulated", owner_uid="uid-a")
for text in ["Hello sir I am calling from SBI bank KYC department", "Your account will be blocked today, share your OTP immediately"]:
    store.add_transcript_and_score(call.id, TranscriptChunk(text=text, speaker=Speaker.caller))
call = store.get(call.id)
e = evaluate(call, "Is this a scam?")
expect(e.basis == "transcript" and e.score == call.current_score and e.level.value in ("high", "critical"),
       f"transcript drives the score: {e.score} {e.level.value}")
expect(e.transcript_lines == 2, "reports how many transcript lines it used")
before = (call.current_score, len(call.transcript), len(call.risk_history))
evaluate(call, "They are asking me to transfer money to a safe account")
expect(before == (call.current_score, len(call.transcript), len(call.risk_history)), "the chat never changes the call itself")
e = evaluate(call, "They are asking for my OTP again")
expect(e.basis == "transcript+user_text", "transcript plus typed report is labelled as both")

# ------------------------------------------------------------------ configurable risk bands
saved = (settings.RISK_MEDIUM_MIN, settings.RISK_HIGH_MIN, settings.RISK_CRITICAL_MIN)
expect([level_for_score(s).value for s in (29, 30, 54, 55, 79, 80)] == ["low", "medium", "medium", "high", "high", "critical"],
       "default bands are unchanged (30 / 55 / 80)")
settings.RISK_MEDIUM_MIN, settings.RISK_HIGH_MIN, settings.RISK_CRITICAL_MIN = 25, 50, 75
expect([level_for_score(s).value for s in (24, 25, 49, 50, 74, 75)] == ["low", "medium", "medium", "high", "high", "critical"],
       "bands can be changed (25 / 50 / 75)")
settings.RISK_MEDIUM_MIN, settings.RISK_HIGH_MIN, settings.RISK_CRITICAL_MIN = 60, 50, 40
expect(level_for_score(55).value == "high", "invalid (non-ascending) bands fall back to the defaults")
settings.RISK_MEDIUM_MIN, settings.RISK_HIGH_MIN, settings.RISK_CRITICAL_MIN = saved

# ------------------------------------------------------------------ who can see which call
a, b = TestClient(app), TestClient(app)
expect(a.post("/api/auth/dev-login", json={"email": "a@example.com"}).status_code == 200, "user A signs in")
expect(b.post("/api/auth/dev-login", json={"email": "b@example.com"}).status_code == 200, "user B signs in")

cid = a.post("/api/calls", json={"label": "A's call"}).json()["id"]
expect(a.post(f"/api/calls/{cid}/ingest", json={"text": "share your otp now", "speaker": "caller"}).status_code == 200, "A can add to own call")
expect(a.get(f"/api/calls/{cid}").status_code == 200, "A can read own call")
expect(cid not in [c["id"] for c in b.get("/api/calls").json()], "B does not see A's call in the list")
for label, resp in [
    ("read", b.get(f"/api/calls/{cid}")),
    ("ingest", b.post(f"/api/calls/{cid}/ingest", json={"text": "hello", "speaker": "caller"})),
    ("end", b.post(f"/api/calls/{cid}/end")),
    ("action", b.post(f"/api/calls/{cid}/actions", json={"type": "dismissed"})),
    ("evaluate", b.post(f"/api/calls/{cid}/evaluate", json={"message": "is this a scam"})),
]:
    expect(resp.status_code == 404, f"B cannot {label} A's call (404, existence not revealed)")
expect(b.get("/api/analytics").json()["monitored_calls"] == 0, "B's analytics do not count A's call")
expect(a.get("/api/analytics").json()["monitored_calls"] >= 1, "A's analytics count A's call")

r = a.post(f"/api/calls/{cid}/evaluate", json={"message": "They are asking for my OTP"})
expect(r.status_code == 200 and r.json()["basis"] == "transcript+user_text", "A can use the evaluator on own call")
expect(a.post(f"/api/calls/{cid}/evaluate", json={"message": ""}).status_code == 422, "empty question is rejected")
expect(a.post(f"/api/calls/{cid}/evaluate", json={"message": "x" * 2001}).status_code == 422, "over-long question is rejected")
expect(a.post("/api/calls/nope/evaluate", json={"message": "hi"}).status_code == 404, "unknown call -> 404")
expect(TestClient(app).post(f"/api/calls/{cid}/evaluate", json={"message": "hi"}).status_code == 401, "not signed in -> 401")

# a joined participant (this is what joining a voice call does) gains access
store.add_participant(cid, "dev:b@example.com")
expect(b.get(f"/api/calls/{cid}").status_code == 200, "B can read the call after joining it")
expect(b.post(f"/api/calls/{cid}/evaluate", json={"message": "hi there"}).status_code == 200, "B can use the evaluator after joining")

# live dashboard socket only carries calls the person may see
c2 = TestClient(app)
c2.post("/api/auth/dev-login", json={"email": "c@example.com"})
with c2.websocket_connect("/ws/dashboard") as ws:
    snap = ws.receive_json()
    expect(snap["type"] == "snapshot" and cid not in [c["id"] for c in snap["calls"]], "dashboard snapshot hides other people's calls")
with a.websocket_connect("/ws/dashboard") as ws:
    snap = ws.receive_json()
    expect(cid in [c["id"] for c in snap["calls"]], "dashboard snapshot shows the owner's own call")

# access restriction can be switched off
settings.RESTRICT_CALL_ACCESS = False
expect(c2.get(f"/api/calls/{cid}").status_code == 200, "RESTRICT_CALL_ACCESS=false restores the shared-console behaviour")
settings.RESTRICT_CALL_ACCESS = True

# rate limit
settings.EVALUATOR_RATE_PER_MINUTE = 3
codes = [a.post(f"/api/calls/{cid}/evaluate", json={"message": "hello"}).status_code for _ in range(5)]
expect(429 in codes and codes[0] == 200, f"evaluator is rate-limited ({codes})")

print("\nALL EVALUATOR / ACCESS TESTS PASSED")

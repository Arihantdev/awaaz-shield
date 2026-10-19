"""Run with: python smoke_test.py (inside the backend venv).
Exercises the full pipeline in-process via Starlette's TestClient -
no real network socket needed, so it's immune to sandbox networking quirks
and is also just a good regression check to keep around.
"""
import os

os.environ.setdefault("FIREBASE_ENABLED", "false")

from starlette.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def expect(cond, msg):
    status = "OK " if cond else "FAIL"
    print(f"[{status}] {msg}")
    if not cond:
        raise SystemExit(1)


r = client.get("/api/health")
expect(r.status_code == 200 and r.json().get("ok") is True, "GET /api/health")

r = client.get("/api/status")
expect(r.status_code == 200, "GET /api/status")
print("   status:", r.json())

r = client.post("/api/auth/dev-login", json={"email": "operator@example.com"})
expect(r.status_code == 200, "POST /api/auth/dev-login")
expect(r.json()["dev_mode"] is True, "dev-login flags dev_mode=true")

r = client.get("/api/auth/me")
expect(r.status_code == 200 and r.json()["email"] == "operator@example.com", "GET /api/auth/me after login")

r = client.post("/api/calls", json={"label": "Test call", "source": "simulated"})
expect(r.status_code == 200, "POST /api/calls")
call_id = r.json()["id"]
print("   call_id:", call_id)

r = client.post(f"/api/calls/{call_id}/ingest", json={"text": "Hello, how can I help you today?", "speaker": "agent"})
expect(r.status_code == 200, "ingest benign line")
expect(r.json()["current_score"] == 0, f"benign line scores 0 (got {r.json()['current_score']})")

r = client.post(
    f"/api/calls/{call_id}/ingest",
    json={
        "text": "Sir this is from the bank, your account will be blocked, this is KYC update required urgently",
        "speaker": "caller",
    },
)
expect(r.status_code == 200, "ingest kyc/account-block line")
score_1 = r.json()["current_score"]
print("   score after KYC+block line:", score_1, r.json()["current_level"])
expect(score_1 > 0, "score rises after scam-pattern line")

r = client.post(
    f"/api/calls/{call_id}/ingest",
    json={"text": "Please share the otp sent to your phone right now, do not disconnect the call", "speaker": "caller"},
)
expect(r.status_code == 200, "ingest OTP-request line")
score_2 = r.json()["current_score"]
alerts = r.json()["alerts"]
print("   score after OTP+urgency line:", score_2, r.json()["current_level"], "alerts:", len(alerts))
expect(score_2 > score_1, "score escalates further after OTP request")
expect(len(alerts) >= 1, "a high/critical alert was raised")

r = client.get("/api/analytics")
expect(r.status_code == 200, "GET /api/analytics")
print("   analytics:", r.json())
expect(r.json()["monitored_calls"] == 1, "analytics counts the one call")

r = client.post("/api/calls/" + call_id + "/actions", json={"type": "escalated", "note": "sent to fraud desk"})
expect(r.status_code == 200, "POST operator action")
r = client.post("/api/calls/" + call_id + "/actions", json={"type": "dismissed", "note": ""})
expect(client.get("/api/calls/" + call_id).json()["disposition"] == "dismissed", "dismiss sets the disposition")
r = client.post("/api/calls/" + call_id + "/actions", json={"type": "restored", "note": ""})
got = client.get("/api/calls/" + call_id).json()
expect(got["disposition"] is None, "restore clears the disposition")
expect(got["actions"][-1]["type"] == "restored", "restore is kept in the action log")

r = client.post("/api/demo/reset")
expect(r.status_code == 200, "POST /api/demo/reset")

r = client.get("/api/calls")
expect(r.status_code == 200 and r.json() == [], "calls cleared after demo reset")

print("\nALL SMOKE TESTS PASSED")

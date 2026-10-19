"""Run with: python test_autoend.py (inside the backend venv).

Tests the automatic cut of an in-app voice call when the caller's risk score goes above the limit, and the hand-off to
operators: both people are told why and the socket closes, the call is ended and escalated ("sent to an operator"), an
operator (by email) sees it live on the dashboard socket while an ordinary user does not, a call below the limit is not
cut, the limit can be turned off, and demo/sample calls are never cut. Uses a stand-in for Deepgram, so no key or network.
It does NOT prove how real speech scores: the scoring is the same rules engine as everywhere else.
"""
import asyncio
import faulthandler
import json
import os
import threading
import time

os.environ.setdefault("FIREBASE_ENABLED", "false")
os.environ["OPERATOR_EMAILS"] = "ops@example.com, Second.Op@example.com"
faulthandler.dump_traceback_later(90, exit=True)

import websockets  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.store import store  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


async def fake_deepgram(ws):
    mk = lambda text, final: json.dumps({"type": "Results", "is_final": final, "channel": {"alternatives": [{"transcript": text}]}})
    try:
        async for msg in ws:
            if isinstance(msg, bytes) and msg.startswith(b"SAY:"):
                words = msg[4:].decode().strip()
                await ws.send(mk(words, True))
            elif not isinstance(msg, bytes) and json.loads(msg).get("type") == "CloseStream":
                await ws.close()
    except websockets.ConnectionClosed:
        pass


loop = asyncio.new_event_loop()
started, box = threading.Event(), {}


def run_server():
    asyncio.set_event_loop(loop)

    async def main():
        server = await serve(fake_deepgram, "127.0.0.1", 0)
        box["port"] = server.sockets[0].getsockname()[1]
        started.set()
        await asyncio.Future()

    loop.run_until_complete(main())


threading.Thread(target=run_server, daemon=True).start()
started.wait(5)
settings.DEEPGRAM_API_KEY = "test-key"
settings.DEEPGRAM_URL = f"ws://127.0.0.1:{box['port']}/v1/listen"


def say(words: str) -> bytes:
    b = b"SAY:" + words.encode()
    return b if len(b) % 2 == 0 else b + b" "


def session(email: str) -> dict:
    c = TestClient(app)
    c.post("/api/auth/dev-login", json={"email": email})
    return {"Cookie": f"{settings.SESSION_COOKIE_NAME}={c.cookies.get(settings.SESSION_COOKIE_NAME)}"}


HOST_H, GUEST_H, OPS_H, USER_H = session("host@example.com"), session("guest@example.com"), session("ops@example.com"), session("nosy@example.com")


def recv(ws):
    m = ws.receive()
    if m["type"] == "websocket.close":
        return ("closed", m.get("code"))
    if m.get("bytes") is not None:
        return ("b", m["bytes"])
    return ("t", json.loads(m["text"]))


def until(ws, pred, limit=60):
    got = []
    for _ in range(limit):
        kind, payload = recv(ws)
        got.append((kind, payload))
        if pred(kind, payload):
            return got
    raise SystemExit(f"[FAIL] expected message never arrived; saw {got[-5:]}")


is_t = lambda t: (lambda k, p: k == "t" and p.get("type") == t)

SCAM = ["this is from the bank, your account will be blocked", "now share the otp that came on your phone", "do not tell anyone, send the money by upi right now, this is the police"]


def start_call(client, label):
    r = client.post("/api/voice/calls", json={"label": label}, headers=HOST_H).json()
    return r["code"], r["call_id"]


def go_live(client, code):
    host = client.websocket_connect(f"/ws/voice/{code}?role=host", headers=HOST_H).__enter__()
    recv(host)
    guest = client.websocket_connect(f"/ws/voice/{code}?role=guest", headers=GUEST_H).__enter__()
    recv(guest)
    host.send_text(json.dumps({"type": "ack_notice"}))
    guest.send_text(json.dumps({"type": "ack_notice"}))
    until(host, is_t("live"))
    until(guest, is_t("live"))
    return host, guest


expect(settings.auto_end_score == 75, "the default limit is 75")
expect(settings.operator_emails == {"ops@example.com", "second.op@example.com"}, "operator emails are parsed, trimmed and lower-cased")

with TestClient(app) as client:
    expect(client.get("/api/status", headers=HOST_H).json()["auto_end_score"] == 75, "/api/status reports the limit")
    expect(client.get("/api/auth/me", headers=OPS_H).json()["operator"] is True, "an email on the operator list is an operator")
    expect(client.get("/api/auth/me", headers=USER_H).json()["operator"] is False, "other people are not operators")

    # ---- a call that stays below the limit is not cut ----
    code, cid = start_call(client, "Calm call")
    host, guest = go_live(client, code)
    host.send_bytes(say("hello how are you doing today"))
    until(host, is_t("risk")); until(guest, is_t("risk"))
    expect(store.get(cid).status.value == "active" and store.get(cid).ended_reason is None, "a harmless call is not cut")
    host.send_text(json.dumps({"type": "hangup"}))
    time.sleep(0.3)
    host.__exit__(None, None, None); guest.__exit__(None, None, None)
    expect(store.get(cid).ended_reason is None and store.get(cid).disposition is None, "a normal hang-up is not an escalation")

    # ---- a scam call is cut once the score goes above 75 ----
    code, cid = start_call(client, "Scam call")
    host, guest = go_live(client, code)
    with client.websocket_connect("/ws/dashboard", headers=OPS_H) as ops, client.websocket_connect("/ws/dashboard", headers=USER_H) as nosy:
        recv(ops); recv(nosy)  # snapshots
        # the operator cannot see an ordinary live call, so far
        expect(not any(c.id == cid for c in store.list_calls_for(client.get("/api/auth/me", headers=OPS_H).json()["uid"])), "an operator does not see an ordinary live call")
        scores, cut = [], None
        for line in SCAM:
            host.send_bytes(say(line))
            seen = until(host, lambda k, p: (k == "t" and p.get("type") in ("risk", "ended")) or k == "closed")
            last = [p for k, p in seen if k == "t" and p.get("type") in ("risk", "ended")][-1]
            if last["type"] == "ended":
                cut = last
                break
            if last["score"] > 75:  # this phrase crossed the limit: the cut follows straight after the score
                cut = until(host, is_t("ended"))[-1][1]
                break
            scores.append(last["score"])
        expect(cut is not None, f"the call is cut during the scam (scores before the cut: {scores})")
        expect(all(s <= 75 for s in scores), "every score before the cut was at or below the limit")
        expect(cut["reason"] == "risk_threshold" and cut["limit"] == 75 and cut["score"] > 75, f"the caller is told why (score {cut['score']} > {cut['limit']})")
        seen_g = until(guest, lambda k, p: k == "closed")
        ended_g = [p for k, p in seen_g if k == "t" and p.get("type") == "ended"]
        expect(len(ended_g) == 1 and ended_g[0]["reason"] == "risk_threshold", "the other person is told the same reason, exactly once (not 'host left')")
        until(host, lambda k, p: k == "closed")
        time.sleep(0.5)
        call = store.get(cid)
        expect(call.status.value == "ended" and call.ended_at, "the call is ended")
        expect(call.ended_reason == "auto_risk" and call.ended_threshold == 75, "the call records that it was ended automatically, and the limit")
        expect(call.disposition == "escalated" and call.shared_with_operators, "the call is escalated and shared with operators")
        expect(any(a.type == "escalated" and a.by_uid == "system" and "above the limit of 75" in a.note for a in call.actions), "the action log explains the cut")
        expect(len([a for a in call.actions if a.type == "escalated"]) == 1, "the call is escalated exactly once")

        # the operator's dashboard gets the call and the auto_ended event; an ordinary user's does not
        ev = until(ops, is_t("auto_ended"))
        expect(ev[-1][1]["call_id"] == cid and ev[-1][1]["score"] > 75, "the operator's dashboard receives an auto_ended event")
        expect(any(k == "t" and p.get("type") == "call_updated" and p["call"]["id"] == cid and p["call"]["shared_with_operators"] for k, p in ev), "...and the escalated call itself")
        ops_uid = client.get("/api/auth/me", headers=OPS_H).json()["uid"]
        expect(any(c.id == cid for c in store.list_calls_for(ops_uid)), "an operator now sees the escalated call")
        nosy_uid = client.get("/api/auth/me", headers=USER_H).json()["uid"]
        expect(not any(c.id == cid for c in store.list_calls_for(nosy_uid)), "an ordinary user still cannot see it")
        expect(client.get(f"/api/calls/{cid}", headers=OPS_H).status_code == 200, "an operator can open the escalated call")
        expect(client.get(f"/api/calls/{cid}", headers=USER_H).status_code == 404, "an ordinary user gets 404 for it")
        expect(client.delete(f"/api/calls/{cid}", headers=OPS_H).status_code in (403, 404), "an operator cannot delete the owner's call")
        r = client.post(f"/api/calls/{cid}/actions", json={"type": "flagged", "note": "reviewed"}, headers=OPS_H)
        expect(r.status_code == 200, "an operator can record a verdict on it")
        expect(client.get(f"/api/calls/{cid}", headers=OPS_H).status_code == 200, "the operator keeps access after recording a verdict")
        host.__exit__(None, None, None); guest.__exit__(None, None, None)
    with client.websocket_connect(f"/ws/voice/{code}?role=guest", headers=GUEST_H) as ws:
        m = recv(ws)[1]
    expect(m["type"] == "error" and m["code"] == "no_room", "the cut call's code stops working")

    # ---- turning the limit off ----
    settings.AUTO_END_SCORE = 0
    expect(settings.auto_end_score == 0 and client.get("/api/status", headers=HOST_H).json()["auto_end_score"] == 0, "AUTO_END_SCORE=0 turns the cut off")
    code, cid2 = start_call(client, "No cut")
    host, guest = go_live(client, code)
    for line in SCAM:
        host.send_bytes(say(line))
        until(host, is_t("risk")); until(guest, is_t("risk"))
    expect(store.get(cid2).current_score > 75 and store.get(cid2).status.value == "active", "with the limit off, even a high score does not cut the call")
    host.send_text(json.dumps({"type": "hangup"}))
    time.sleep(0.3)
    host.__exit__(None, None, None); guest.__exit__(None, None, None)
    settings.AUTO_END_SCORE = 75

    # ---- demo / sample / text calls are never cut ----
    demo = client.post("/api/calls", json={"label": "Demo"}, headers=HOST_H).json()
    for line in SCAM:
        client.post(f"/api/calls/{demo['id']}/ingest", json={"text": line}, headers=HOST_H)
    d = client.get(f"/api/calls/{demo['id']}", headers=HOST_H).json()
    expect(d["current_score"] > 75 and d["status"] == "active" and d["ended_reason"] is None, "a demo call that scores above the limit is not cut")

    # ---- the limit is strictly "above" ----
    settings.AUTO_END_SCORE = 99
    expect(settings.auto_end_score == 99, "a limit of 99 is accepted")
    settings.AUTO_END_SCORE = 150
    expect(settings.auto_end_score == 0, "a nonsense limit means off, not 'cut everything'")

print("\nAll auto-end and operator checks passed.")

"""Run with: python test_voice.py (inside the backend venv).

Tests the in-app voice call relay (/ws/voice/{code}) with two simulated browsers and a local stand-in for
Deepgram, so no key, network or microphone is needed. It proves the server side: auth, rooms and codes, that
audio is NOT relayed or transcribed until both people accepted the notice, that each side's audio reaches the
other side unchanged, that each side is transcribed under the right speaker and scored, mute / leave / hang-up
behaviour, and the failure modes. It does NOT prove anything about real Deepgram accuracy, real microphones,
browser audio capture or playback, or call quality on a real network: that needs two real devices.
"""
import asyncio
import faulthandler
import json
import os
import threading

os.environ.setdefault("FIREBASE_ENABLED", "false")
faulthandler.dump_traceback_later(90, exit=True)  # a hang is a failure, not a stuck test run

import websockets  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import voice  # noqa: E402
from app.store import store  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


# ---- a stand-in for Deepgram: a frame "SAY:<words>" makes it answer with an interim and a final result ----
dg = {"conns": [], "bytes": 0, "closed": 0}


async def fake_deepgram(ws):
    dg["conns"].append((ws.request.headers.get("Authorization"), ws.request.path))
    mk = lambda text, final: json.dumps({"type": "Results", "is_final": final, "channel": {"alternatives": [{"transcript": text}]}})
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                dg["bytes"] += len(msg)
                if msg.startswith(b"SAY:"):
                    words = msg[4:].decode().strip()
                    await ws.send(mk(words.split(",")[0], False))
                    await ws.send(mk(words, True))
            elif json.loads(msg).get("type") == "CloseStream":
                dg["closed"] += 1
                await ws.close()
    except websockets.ConnectionClosed:
        pass


loop = asyncio.new_event_loop()
started = threading.Event()
box = {}


def run_server():
    asyncio.set_event_loop(loop)

    async def main():
        server = await serve(fake_deepgram, "127.0.0.1", 0)
        box["port"] = server.sockets[0].getsockname()[1]
        started.set()
        await asyncio.Future()

    try:
        loop.run_until_complete(main())
    except Exception:  # noqa: BLE001
        pass


threading.Thread(target=run_server, daemon=True).start()
started.wait(5)
settings.DEEPGRAM_API_KEY = "test-key-123"
settings.DEEPGRAM_URL = f"ws://127.0.0.1:{box['port']}/v1/listen"


def say(words: str) -> bytes:
    b = b"SAY:" + words.encode()
    return b if len(b) % 2 == 0 else b + b" "  # real frames are 16-bit samples: always an even number of bytes


def session(email: str) -> dict:
    c = TestClient(app)
    c.post("/api/auth/dev-login", json={"email": email})
    return {"Cookie": f"{settings.SESSION_COOKIE_NAME}={c.cookies.get(settings.SESSION_COOKIE_NAME)}"}


HOST_H, GUEST_H, OTHER_H = session("host@example.com"), session("guest@example.com"), session("other@example.com")


def recv(ws):
    m = ws.receive()
    if m["type"] == "websocket.close":
        return ("closed", m.get("code"))
    if m.get("bytes") is not None:
        return ("b", m["bytes"])
    return ("t", json.loads(m["text"]))


def until(ws, pred, limit=40):
    """Read until pred(kind, payload) is true. Returns every message read, the last one matching."""
    got = []
    for _ in range(limit):
        kind, payload = recv(ws)
        got.append((kind, payload))
        if pred(kind, payload):
            return got
    raise SystemExit(f"[FAIL] expected message never arrived; saw {got[-5:]}")


is_t = lambda t: (lambda k, p: k == "t" and p.get("type") == t)

# ---- Participant.send_audio keeps the backlog bounded (drops the OLDEST audio, never control messages) ----
p = voice.Participant(role="host", identity=None, ws=None, speaker=None)
for i in range(60):
    p.send_audio(bytes([i % 250]) * 2)
p.send_json({"type": "x"})
expect(len(p.audio) == voice.MAX_AUDIO_BACKLOG and p.audio[0] == bytes([35]) * 2 and p.dropped_frames == 35, "slow listener: backlog is capped and the oldest frames are dropped")
expect(len(p.ctl) == 1, "control messages are never dropped")
expect(voice.normalise_code(" ab-c d2 ") == "ABCD2", "join codes ignore case, spaces and dashes")

with TestClient(app) as client:  # one shared event loop, like the real server
    # ---- auth / rooms ----
    anon = client.post("/api/voice/calls", json={})
    expect(anon.status_code == 401, "starting a voice call needs a signed-in user")
    r = client.post("/api/voice/calls", json={"label": "Test voice call"}, headers=HOST_H)
    expect(r.status_code == 200 and len(r.json()["code"]) == 6, f"start a voice call -> join code {r.json()['code']}")
    code, call_id = r.json()["code"], r.json()["call_id"]
    expect(all(ch in voice.CODE_ALPHABET for ch in code), "join code uses only unambiguous characters")
    expect(store.get(call_id).source == "voice" and store.get(call_id).owner_email == "host@example.com", "the call is recorded as a voice call owned by the host")
    info = client.get(f"/api/voice/rooms/{code.lower()}", headers=GUEST_H)
    expect(info.status_code == 200 and info.json()["is_host"] is False and info.json()["host_present"] is False, "room info works for a guest (code is case-insensitive)")
    expect(client.get("/api/voice/rooms/ZZZZZZ", headers=GUEST_H).status_code == 404, "unknown code -> 404")

    try:
        with client.websocket_connect(f"/ws/voice/{code}?role=host") as ws:
            ws.receive_text()
        expect(False, "anonymous websocket is refused")
    except WebSocketDisconnect as e:
        expect(e.code == 4401, "anonymous voice websocket is refused (4401)")
    try:
        with client.websocket_connect(f"/ws/voice/{code}?role=host", headers={**HOST_H, "Origin": "https://evil.example"}) as ws:
            ws.receive_text()
        expect(False, "foreign origin is refused")
    except WebSocketDisconnect as e:
        expect(e.code == 4403, "a page on another website cannot open the voice socket (4403)")
    with client.websocket_connect("/ws/voice/ZZZZZZ?role=guest", headers=GUEST_H) as ws:
        m = recv(ws)[1]
    expect(m["type"] == "error" and m["code"] == "no_room", "unknown code -> no_room error")
    with client.websocket_connect(f"/ws/voice/{code}?role=host", headers=OTHER_H) as ws:
        m = recv(ws)[1]
    expect(m["type"] == "error" and m["code"] == "not_host", "only the call's owner can be the host")

    # ---- a full call ----
    with client.websocket_connect(f"/ws/voice/{code}?role=host", headers=HOST_H) as host:
        j = recv(host)[1]
        expect(j["type"] == "joined" and j["role"] == "host" and j["peer"] is False and j["stt"] is True, "host joins an empty room")
        with client.websocket_connect(f"/ws/voice/{code}?role=guest", headers=GUEST_H) as guest:
            j = recv(guest)[1]
            expect(j["type"] == "joined" and j["role"] == "guest" and j["peer"] is True, "guest joins and sees the host")
            expect(recv(host)[1] == {"type": "peer", "state": "joined"}, "host is told the guest arrived")
            with client.websocket_connect(f"/ws/voice/{code}?role=guest", headers=OTHER_H) as third:
                m = recv(third)[1]
            expect(m["type"] == "error" and m["code"] == "role_taken", "a third person cannot take the guest's place")

            # nothing is relayed or transcribed before BOTH accepted the notice
            host.send_bytes(b"\x01\x01" * 320)
            host.send_bytes(say("this is from the bank, your account will be blocked"))
            host.send_text(json.dumps({"type": "ack_notice"}))
            host.send_bytes(b"\x02\x02" * 320)  # still only one side accepted
            host.send_text(json.dumps({"type": "mute", "muted": True}))
            expect(recv(guest)[1] == {"type": "peer_muted", "muted": True}, "mute state reaches the other person (and the early audio did not)")
            expect(dg["bytes"] == 0 and not dg["conns"], "no audio and no Deepgram connection before both accepted")
            expect(store.get(call_id).notice_given is False, "notice_given stays false until both accepted")

            guest.send_text(json.dumps({"type": "ack_notice"}))
            expect(until(host, is_t("live"))[-1][1] == {"type": "live"}, "host is told the call is live")
            expect(until(guest, is_t("live"))[-1][1] == {"type": "live"}, "guest is told the call is live")
            expect(store.get(call_id).notice_given is True, "notice_given is recorded once both accepted")

            # audio goes to the OTHER person, unchanged; odd-sized junk is ignored
            f1, f2 = bytes(range(0, 200, 2)) * 4, bytes(range(1, 201, 2)) * 4
            host.send_bytes(b"\x07")  # malformed (odd length)
            host.send_bytes(f1)
            kind, got = until(guest, lambda k, p: k == "b")[-1]
            expect(got == f1, "host audio reaches the guest unchanged (the early and malformed frames were dropped)")
            guest.send_bytes(f2)
            kind, got = until(host, lambda k, p: k == "b")[-1]
            expect(got == f2, "guest audio reaches the host unchanged")

            # each side is transcribed under its own speaker and the caller's words are scored
            host.send_bytes(say("this is from the bank, your account will be blocked"))
            for who in (host, guest):
                seen = until(who, is_t("risk"))
                caps = [p for k, p in seen if k == "t" and p.get("type") == "caption"]
                expect(any(c["final"] is False for c in caps) and any(c["final"] and c["speaker"] == "caller" for c in caps), "both people see the interim and final caption, labelled caller")
                risk1 = seen[-1][1]
            expect(risk1["score"] > 0, f"the host's (caller's) phrase is scored (score {risk1['score']})")
            guest.send_bytes(say("okay what should i do now"))
            seen = until(host, is_t("risk"))
            expect(any(k == "t" and p.get("type") == "caption" and p["speaker"] == "agent" and p["final"] for k, p in seen), "the guest's words are labelled agent")
            expect(seen[-1][1]["score"] == risk1["score"], "what the receiving side says does not raise the scam score")
            until(guest, is_t("risk"))
            host.send_bytes(say("now share the otp that came on your phone"))
            r2 = until(host, is_t("risk"))[-1][1]
            until(guest, is_t("risk"))
            expect(r2["score"] > risk1["score"], f"the score climbs when the caller asks for the OTP ({risk1['score']} -> {r2['score']})")
            call = store.get(call_id)
            expect([c.speaker.value for c in call.transcript] == ["caller", "agent", "caller"], "the call transcript has the right speakers in order")
            expect(call.current_score == r2["score"], "the stored call score matches what the browsers were told")

            auths = {a for a, _ in dg["conns"]}
            expect(auths == {"Token test-key-123"} and len(dg["conns"]) == 2, "one Deepgram connection per person, key sent as a header only")
            expect(all("encoding=linear16" in pth and "sample_rate=16000" in pth and "test-key" not in pth for _, pth in dg["conns"]), "Deepgram is asked for 16 kHz linear PCM; the key is not in the URL")

            # guest leaves: the call goes quiet (not live) but stays open
            guest.send_text(json.dumps({"type": "hangup"}))
            until(host, lambda k, p: k == "t" and p == {"type": "peer", "state": "left"})
            expect(store.get(call_id).status.value == "active", "the call stays open when only the guest leaves")
            before = dg["bytes"]
            host.send_bytes(say("anyone there"))
            host.send_text(json.dumps({"type": "mute", "muted": False}))  # a round trip to be sure the frame was processed
            import time; time.sleep(0.3)
            expect(dg["bytes"] == before, "with nobody on the other end the host's audio is no longer transcribed")

            # host hangs up: the call ends
            host.send_text(json.dumps({"type": "hangup"}))
    import time; time.sleep(0.3)
    expect(store.get(call_id).status.value == "ended", "the call ends when the host hangs up")
    expect(dg["closed"] >= 1, "CloseStream is sent so Deepgram flushes the last phrase")
    with client.websocket_connect(f"/ws/voice/{code}?role=guest", headers=GUEST_H) as ws:
        m = recv(ws)[1]
    expect(m["type"] == "error" and m["code"] == "no_room", "an ended call's code stops working")

    # ---- the guest is told when the host hangs up, and the socket closes ----
    c2 = client.post("/api/voice/calls", json={}, headers=HOST_H).json()
    with client.websocket_connect(f"/ws/voice/{c2['code']}?role=host", headers=HOST_H) as host:
        recv(host)
        with client.websocket_connect(f"/ws/voice/{c2['code']}?role=guest", headers=GUEST_H) as guest:
            recv(guest)
            host.send_text(json.dumps({"type": "hangup"}))
            seen = until(guest, lambda k, p: k == "closed")
            expect(any(k == "t" and p == {"type": "ended", "reason": "host_left"} for k, p in seen), "the guest is told the host ended the call, then the socket closes")

    # ---- no Deepgram key: the call still works, it just is not transcribed ----
    settings.DEEPGRAM_API_KEY = ""
    c3 = client.post("/api/voice/calls", json={}, headers=HOST_H).json()
    with client.websocket_connect(f"/ws/voice/{c3['code']}?role=host", headers=HOST_H) as host:
        expect(recv(host)[1]["stt"] is False, "joined message says transcription is unavailable")
        with client.websocket_connect(f"/ws/voice/{c3['code']}?role=guest", headers=GUEST_H) as guest:
            recv(guest)
            host.send_text(json.dumps({"type": "ack_notice"}))
            guest.send_text(json.dumps({"type": "ack_notice"}))
            n = until(host, is_t("notice"))[-1][1]
            expect(n["code"] == "stt_unavailable", "without a key both people are told the call is not transcribed")
            f = bytes(range(0, 100, 2)) * 4
            host.send_bytes(f)
            expect(until(guest, lambda k, p: k == "b")[-1][1] == f, "audio still reaches the other person without a Deepgram key")
            host.send_text(json.dumps({"type": "hangup"}))

print("\nAll voice relay checks passed.")

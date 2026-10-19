"""Run with: python test_stt.py (inside the backend venv).

Tests the /ws/stt/{call_id} relay against a local stand-in for Deepgram's streaming API, so no key or
network is needed. It proves the relay's own behaviour (auth, header, audio forwarding, interim vs final,
scoring of finished phrases, error cases). It does NOT prove anything about real Deepgram accuracy or
about what the browser's MediaRecorder sends: that needs a real key and a real browser.
"""
import asyncio
import json
import os
import threading

os.environ.setdefault("FIREBASE_ENABLED", "false")

import websockets  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
from websockets.asyncio.server import serve  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


seen = {"auth": None, "path": None, "bytes": 0, "closed": False}


async def fake_deepgram(ws):
    seen["auth"] = ws.request.headers.get("Authorization")
    seen["path"] = ws.request.path
    try:
        async for msg in ws:
            if isinstance(msg, bytes) and "diarize=true" in ws.request.path:
                seen["diarize_path"] = ws.request.path
                words = [{"word": w, "punctuated_word": p, "speaker": 0} for w, p in [("hello", "Hello"), ("who", "who"), ("is", "is"), ("this", "this?")]]
                words += [{"word": w, "punctuated_word": w, "speaker": 1} for w in "this is the bank your account will be blocked".split()]
                text = " ".join(w["punctuated_word"] for w in words)
                await ws.send(json.dumps({"type": "Results", "is_final": True, "channel": {"alternatives": [{"transcript": text, "words": words}]}}))
                continue
            if isinstance(msg, bytes):
                seen["bytes"] += len(msg)
                if seen["bytes"] == len(b"audio-chunk-1"):
                    mk = lambda text, final: json.dumps({"type": "Results", "is_final": final, "channel": {"alternatives": [{"transcript": text}]}})
                    await ws.send(mk("this is from the", False))
                    await ws.send(mk("", True))  # empty results must be ignored
                    await ws.send(mk("this is from the bank, your account will be blocked", True))
                    await ws.send(json.dumps({"type": "Metadata"}))
            elif json.loads(msg).get("type") == "CloseStream":
                seen["closed"] = True
                await ws.send(json.dumps({"type": "Results", "is_final": True, "channel": {"alternatives": [{"transcript": "share the otp"}]}}))
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

client = TestClient(app)
client.post("/api/auth/dev-login", json={"email": "operator@example.com"})
call_id = client.post("/api/calls", json={"label": "stt test", "source": "microphone"}).json()["id"]

# 1) not signed in
anon = TestClient(app)
try:
    with anon.websocket_connect(f"/ws/stt/{call_id}") as ws:
        ws.receive_text()
    expect(False, "anonymous websocket is refused")
except WebSocketDisconnect as e:
    expect(e.code == 4401, "anonymous websocket is refused (4401)")

# 2) no key configured
settings.DEEPGRAM_API_KEY = ""
with client.websocket_connect(f"/ws/stt/{call_id}") as ws:
    msg = json.loads(ws.receive_text())
expect(msg["type"] == "error" and msg["code"] == "not_configured", "no key -> clear not_configured error")

# 3) unknown call
settings.DEEPGRAM_API_KEY = "test-key-123"
settings.DEEPGRAM_URL = f"ws://127.0.0.1:{box['port']}/v1/listen"
with client.websocket_connect("/ws/stt/nope") as ws:
    msg = json.loads(ws.receive_text())
expect(msg["type"] == "error" and msg["code"] == "no_call", "unknown call -> no_call error")

# 4) happy path
with client.websocket_connect(f"/ws/stt/{call_id}?speaker=caller") as ws:
    expect(json.loads(ws.receive_text())["type"] == "ready", "relay connects to Deepgram and says ready")
    ws.send_bytes(b"audio-chunk-1")
    got = [json.loads(ws.receive_text()), json.loads(ws.receive_text())]
    expect(got[0] == {"type": "interim", "text": "this is from the"}, "interim text is passed through, not scored")
    expect(got[1]["type"] == "transcript" and got[1]["score"] > 0, f"final phrase is scored (score {got[1].get('score')})")
    ws.send_text("stop")
    last = json.loads(ws.receive_text())
    expect(last["type"] == "transcript" and last["text"] == "share the otp", "phrase flushed on stop is delivered")
    expect(last["score"] >= got[1]["score"], f"score keeps rising after the OTP ask ({got[1]['score']} -> {last['score']})")

expect(seen["auth"] == "Token test-key-123", "key is sent to Deepgram as an Authorization header only")
expect("test-key" not in (seen["path"] or ""), "key is not placed in the URL")
expect("interim_results=true" in seen["path"] and "model=" in seen["path"], "Deepgram query asks for interim results and a model")
expect("keyterm=OTP" in seen["path"] and "keyterm=KYC" in seen["path"] and "keyterm=UPI+PIN" in seen["path"], "scam-call keyterms are sent to Deepgram")
expect("endpointing=500" in seen["path"], "phrases close after 500 ms of silence")
expect(seen["bytes"] == len(b"audio-chunk-1"), "audio bytes were forwarded unchanged")
expect(seen["closed"], "CloseStream is sent so Deepgram flushes")

call = client.get(f"/api/calls/{call_id}").json()
texts = [(c["speaker"], c["text"]) for c in call["transcript"]]
expect(texts == [("caller", "this is from the bank, your account will be blocked"), ("caller", "share the otp")],
       f"only finished phrases became transcript lines: {texts}")
expect(call["current_level"] in ("high", "critical"), f"call reached {call['current_level']}")

# 4b) speakerphone mode: one stream, two voices
from app.routers.stt import split_by_speaker  # noqa: E402

expect(split_by_speaker({"words": [{"word": "hi"}]}) == [] and split_by_speaker({}) == [], "words without speaker labels -> no split (falls back to one line)")
expect(split_by_speaker({"words": [{"word": "a", "speaker": 0}, {"word": "b", "speaker": 0}, {"word": "c", "speaker": 1}, {"word": "d", "speaker": 0}]})
       == [(0, "a b"), (1, "c"), (0, "d")], "consecutive words by one voice are grouped, turn changes start a new run")

call2 = client.post("/api/calls", json={"label": "speakerphone", "source": "microphone"}).json()["id"]
with client.websocket_connect(f"/ws/stt/{call2}?diarize=1") as ws:
    expect(json.loads(ws.receive_text())["type"] == "ready", "diarize connection says ready")
    ws.send_bytes(b"x")
    a, b = json.loads(ws.receive_text()), json.loads(ws.receive_text())
    expect(a["speaker"] == "agent" and a["text"] == "Hello who is this?", f"first voice heard is the agent: {a}")
    expect(b["speaker"] == "caller" and b["text"].startswith("this is the bank"), f"second voice is the caller: {b}")
    expect(b.get("score", 0) > 0, "the caller's line is scored")
    ws.send_text("swap")
    expect(json.loads(ws.receive_text()) == {"type": "roles", "swapped": True}, "swap is acknowledged")
    ws.send_bytes(b"y")
    c, d = json.loads(ws.receive_text()), json.loads(ws.receive_text())
    expect(c["speaker"] == "caller" and d["speaker"] == "agent", f"after a swap the roles are reversed: {c['speaker']}, {d['speaker']}")
    ws.send_text("stop")
    json.loads(ws.receive_text())  # flushed phrase (no word labels): falls back to the single speaker
expect("diarize=true" in seen["diarize_path"], "Deepgram was asked to separate the voices")
call2_lines = [(t["speaker"]) for t in client.get(f"/api/calls/{call2}").json()["transcript"]]
expect(call2_lines[:4] == ["agent", "caller", "caller", "agent"], f"stored speaker labels follow the roles: {call2_lines}")

# 4c) language choice: a listed language is used, an unknown one falls back to the server default
for asked, expected in [("en-IN", "language=en-IN"), ("klingon", "language=multi")]:
    cid = client.post("/api/calls", json={"label": "lang", "source": "microphone"}).json()["id"]
    with client.websocket_connect(f"/ws/stt/{cid}?lang={asked}") as ws:
        json.loads(ws.receive_text())
        ws.send_text("stop")
        try:
            ws.receive_text()
        except Exception:  # noqa: BLE001
            pass
    expect(expected in seen["path"], f"?lang={asked} -> {expected}")

# 5) Deepgram unreachable
settings.DEEPGRAM_URL = "ws://127.0.0.1:9/v1/listen"
with client.websocket_connect(f"/ws/stt/{call_id}") as ws:
    msg = json.loads(ws.receive_text())
expect(msg["type"] == "error" and msg["code"] == "upstream_unreachable", "unreachable Deepgram -> upstream_unreachable error")

print("\nSTT RELAY TESTS PASSED")

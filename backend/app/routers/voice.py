"""
In-app voice calls: Awaaz Shield as the "middleman" of a call between two people who both use the app.

    host  (starts the call, scored as the "caller")  <-->  backend  <-->  guest (joins with a code, the "agent")

Each browser sends its microphone as raw 16-bit mono 16 kHz PCM (20 ms frames) over /ws/voice/{code}. The backend
(1) forwards each side's audio to the other side, so the call feels like a normal call, and (2) streams each side to
its own Deepgram connection, so every finished phrase becomes a transcript line with the right speaker and is scored
by the same pipeline as every other call. The Deepgram key never leaves the server.

Consent is enforced here, not only in the UI: audio is neither relayed nor transcribed until BOTH people have
accepted the notice that the call is relayed and analysed (they each send {"type": "ack_notice"}).

Messages to the browser (JSON text unless noted):
  {"type":"joined","role","code","call_id","label","peer","stt"}   you are in the room (stt = transcription available)
  {"type":"peer","state":"joined"|"left"}                          the other person arrived / left
  {"type":"live"}                                                  both accepted the notice: audio now flows
  {"type":"peer_muted","muted":bool}
  {"type":"caption","speaker":"caller"|"agent","text","final":bool}
  {"type":"risk","score","level"}                                  after every finished phrase
  {"type":"warning","score","limit"}                               the score is above the cut limit; if the caller keeps
                                                                   saying suspicious things the call will be cut (AUTO_END_LINES)
  {"type":"notice","code":"stt_unavailable","message"}             the call works, but is not transcribed
  {"type":"ended","reason"}                                        then the socket closes. reason: "host_left", or
                                                                   "risk_threshold" (+ "score","limit"): the call was cut
                                                                   automatically because the caller's score went too high
  {"type":"error","code","message"}                                then the socket closes
  binary frames                                                    the other person's audio (PCM16 mono 16 kHz)
"""
import asyncio
import json
import logging
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlencode, urlparse

import websockets
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from pydantic import BaseModel

from .. import auth
from ..config import settings
from ..models import Speaker, TranscriptChunk
from ..risk import heuristic
from ..store import store

logger = logging.getLogger("awaaz.voice")
router = APIRouter()

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L: easy to read out loud
CODE_LENGTH = 6
MAX_AUDIO_BACKLOG = 25  # 20 ms frames waiting for a slow listener; beyond this the OLDEST are dropped (latency over completeness)
MAX_FRAME_BYTES = 16000  # 500 ms of PCM16 at 16 kHz: anything larger is not a voice frame
UNUSED_ROOM_SECONDS = 15 * 60  # a room nobody joined to talk in is forgotten
KEEPALIVE_SECONDS = 5


def normalise_code(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


# ------------------------------------------------------------------------------------------ participants / rooms

@dataclass(eq=False)
class Participant:
    role: str  # "host" | "guest"
    identity: auth.Identity
    ws: WebSocket
    speaker: Speaker
    ctl: deque = field(default_factory=deque)  # JSON strings: never dropped
    audio: deque = field(default_factory=deque)  # PCM frames: bounded, oldest dropped
    wake: asyncio.Event = field(default_factory=asyncio.Event)
    closing: bool = False
    acked: bool = False
    upstream: object = None  # this person's own Deepgram connection, once the call is live
    dropped_frames: int = 0

    def send_json(self, obj: dict) -> None:
        self.ctl.append(json.dumps(obj))
        self.wake.set()

    def send_audio(self, frame: bytes) -> None:
        self.audio.append(frame)
        while len(self.audio) > MAX_AUDIO_BACKLOG:
            self.audio.popleft()
            self.dropped_frames += 1
        self.wake.set()

    def close_after_flush(self) -> None:
        self.closing = True
        self.wake.set()


class Room:
    def __init__(self, code: str, call_id: str, host_uid: str) -> None:
        self.code = code
        self.call_id = call_id
        self.host_uid = host_uid
        self.created = time.monotonic()
        self.parts: dict[str, Participant] = {}
        self.ended = False
        self.is_live = False
        self._live_event: Optional[asyncio.Event] = None
        self.ever_live = False
        self.end_reason: Optional[str] = None  # "risk" when Awaaz Shield cut the call
        self.hot = 0  # caller lines so far that kept the score above the cut limit (a cut needs AUTO_END_LINES of them)
        self.warned = False

    @property
    def live_event(self) -> asyncio.Event:
        if self._live_event is None:  # created lazily, always from inside the event loop
            self._live_event = asyncio.Event()
            if self.is_live:
                self._live_event.set()
        return self._live_event

    def peer_of(self, role: str) -> Optional[Participant]:
        return self.parts.get("guest" if role == "host" else "host")

    def broadcast(self, obj: dict) -> None:
        for p in list(self.parts.values()):
            p.send_json(obj)

    def recompute_live(self) -> bool:
        """Live only while the host is here and accepted AND a guest is here and accepted."""
        host, guest = self.parts.get("host"), self.parts.get("guest")
        live = bool(host and guest and host.acked and guest.acked and not self.ended)
        changed = live != self.is_live
        self.is_live = live
        if live:
            self.live_event.set()
        elif self._live_event is not None:
            self._live_event.clear()
        return changed


class Rooms:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def create(self, call_id: str, host_uid: str) -> Room:
        self._sweep()
        for _ in range(20):
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self._rooms:
                room = Room(code, call_id, host_uid)
                self._rooms[code] = room
                return room
        raise RuntimeError("could not allocate a join code")

    def get(self, code: str) -> Optional[Room]:
        room = self._rooms.get(normalise_code(code))
        if room and (room.ended or self._stale(room)):
            return None
        return room

    def _stale(self, room: Room) -> bool:
        return not room.parts and not room.ever_live and time.monotonic() - room.created > UNUSED_ROOM_SECONDS

    def _sweep(self) -> None:
        for code, room in list(self._rooms.items()):
            if (room.ended and not room.parts) or self._stale(room):
                self._rooms.pop(code, None)


rooms = Rooms()


# ---------------------------------------------------------------------------------------------------- REST

class StartVoiceCall(BaseModel):
    label: Optional[str] = None


@router.post("/api/voice/calls")
def start_voice_call(body: StartVoiceCall, identity: auth.Identity = Depends(auth.require_session)):
    call = store.create_call(body.label or "Voice call", "voice", owner_uid=identity.uid, owner_email=identity.email)
    room = rooms.create(call.id, identity.uid)
    return {"call_id": call.id, "code": room.code, "label": call.label}


@router.get("/api/voice/rooms/{code}")
def voice_room_info(code: str, identity: auth.Identity = Depends(auth.require_session)):
    room = rooms.get(code)
    if not room:
        raise HTTPException(status_code=404, detail="That call code is not valid any more.")
    call = store.get(room.call_id)
    return {
        "code": room.code,
        "call_id": room.call_id,
        "label": call.label if call else "Voice call",
        "host_present": "host" in room.parts,
        "guest_present": "guest" in room.parts,
        "is_host": room.host_uid == identity.uid,
    }


# ------------------------------------------------------------------------------------------- Deepgram helpers

def _upstream_url() -> str:
    params = {
        "model": settings.DEEPGRAM_MODEL,
        "language": settings.DEEPGRAM_LANGUAGE,
        "encoding": "linear16",
        "sample_rate": "16000",
        "channels": "1",
        "smart_format": "true",
        "interim_results": "true",
        "endpointing": "300",
        "punctuate": "true",
    }
    return f"{settings.DEEPGRAM_URL}?{urlencode(params)}"


async def _connect_upstream():
    headers = {"Authorization": f"Token {settings.DEEPGRAM_API_KEY}"}
    try:  # websockets >= 14
        return await websockets.connect(_upstream_url(), additional_headers=headers, open_timeout=10)
    except TypeError:  # older releases call it extra_headers
        return await websockets.connect(_upstream_url(), extra_headers=headers, open_timeout=10)


async def _stt_worker(room: Room, p: Participant) -> None:
    """Waits until the call is live (both accepted the notice), then transcribes THIS person's audio."""
    await room.live_event.wait()
    if not settings.deepgram_configured:
        p.send_json({"type": "notice", "code": "stt_unavailable",
                     "message": "The call works, but it is not being transcribed: the server has no Deepgram key."})
        return
    try:
        upstream = await _connect_upstream()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not reach Deepgram for %s: %s", p.role, exc)
        p.send_json({"type": "notice", "code": "stt_unavailable",
                     "message": "The call works, but it is not being transcribed: Deepgram could not be reached."})
        return
    p.upstream = upstream

    async def keepalive() -> None:
        while True:
            await asyncio.sleep(KEEPALIVE_SECONDS)
            await upstream.send(json.dumps({"type": "KeepAlive"}))

    ka = asyncio.create_task(keepalive())
    try:
        async for raw in upstream:
            try:
                data = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if data.get("type") != "Results":
                continue
            alts = (data.get("channel") or {}).get("alternatives") or []
            text = ((alts[0].get("transcript") if alts else "") or "").strip()
            if not text or room.ended:
                continue
            if not data.get("is_final"):
                room.broadcast({"type": "caption", "speaker": p.speaker.value, "text": text, "final": False})
                continue
            updated = await asyncio.to_thread(
                store.add_transcript_and_score, room.call_id, TranscriptChunk(text=text, speaker=p.speaker)
            )
            room.broadcast({"type": "caption", "speaker": p.speaker.value, "text": text, "final": True})
            if updated:
                room.broadcast({"type": "risk", "score": updated.current_score, "level": updated.current_level.value})
                limit = settings.auto_end_score
                if limit and not room.ended:
                    verdict = _cut_decision(room, p, text, updated.current_score, limit)
                    if verdict == "warn":
                        room.broadcast({"type": "warning", "score": updated.current_score, "limit": limit})
                    elif verdict == "cut":
                        await _auto_end(room, updated.current_score, limit)
    except Exception as exc:  # noqa: BLE001 - the call itself must survive a transcription failure
        logger.warning("Transcription for %s stopped: %r", p.role, exc)
    finally:
        ka.cancel()
        p.upstream = None
        try:
            await upstream.close()
        except Exception:  # noqa: BLE001
            pass


def _cut_decision(room: Room, p: Participant, text: str, score: int, limit: int) -> str:
    """"cut", "warn" or "none" after one more final line. One alarming sentence can be a real bank or an honest slip, so
    the first line above the limit only WARNS both people; the call is cut when AUTO_END_LINES lines in all (the first one
    plus later lines that themselves contain a scam tactic) have kept the score above the limit. A harmless reply in between
    changes nothing, and if the score falls back to the limit or below, the count starts again. Only the caller's lines count:
    the score is built from the caller's words alone."""
    if p.speaker != Speaker.caller:
        return "none"
    if score <= limit:
        room.hot, room.warned = 0, False
        return "none"
    if room.hot == 0:
        room.hot = 1
    elif heuristic.score_transcript(text, None).matched_patterns:
        room.hot += 1
    if room.hot >= settings.auto_end_lines:
        return "cut"
    if not room.warned:
        room.warned = True
        return "warn"
    return "none"


async def _auto_end(room: Room, score: int, limit: int) -> None:
    """The caller's risk score went above the limit: tell both people why, hang up on both, and send the call to the operators.
    Both are told BEFORE the call is saved, so the cut is immediate even if storage is slow."""
    if room.ended:
        return
    room.ended = True
    room.end_reason = "risk"
    room.recompute_live()  # an ended room is never live: no more audio is relayed or transcribed
    room.broadcast({"type": "ended", "reason": "risk_threshold", "score": score, "limit": limit})
    for p in list(room.parts.values()):
        p.close_after_flush()
    logger.warning("Voice call %s ended automatically: score %d is above the limit of %d", room.call_id, score, limit)
    await asyncio.to_thread(store.end_for_risk, room.call_id, limit)


async def _finish_stt(p: Participant, task: asyncio.Task) -> None:
    """Ask Deepgram to flush the last phrase, give it a moment, then stop."""
    up = p.upstream
    if up is not None:
        try:
            await up.send(json.dumps({"type": "CloseStream"}))
        except Exception:  # noqa: BLE001
            pass
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=3)
        except Exception:  # noqa: BLE001
            pass
    if not task.done():
        task.cancel()


# ------------------------------------------------------------------------------------------- the socket

async def _writer(p: Participant) -> None:
    """The only task that writes to this person's socket (control messages first, then audio)."""
    try:
        while True:
            while not (p.ctl or p.audio):
                if p.closing:
                    await p.ws.close()  # everything queued has been sent: now hang up on this person
                    return
                p.wake.clear()
                await p.wake.wait()
            if p.ctl:
                await p.ws.send_text(p.ctl.popleft())
            else:
                await p.ws.send_bytes(p.audio.popleft())
    except Exception:  # noqa: BLE001 - the socket is gone; the reader will notice too
        pass


def _origin_ok(ws: WebSocket) -> bool:
    origin = ws.headers.get("origin")
    if not origin:
        return True  # not a browser (tests, tools)
    if origin in settings.CORS_ORIGINS:
        return True
    return urlparse(origin).netloc == ws.headers.get("host", "")  # same-origin, e.g. behind the dev proxy or a tunnel


async def _refuse(ws: WebSocket, code: str, message: str) -> None:
    try:
        await ws.send_text(json.dumps({"type": "error", "code": code, "message": message}))
        await ws.close(code=1011)
    except Exception:  # noqa: BLE001
        pass


@router.websocket("/ws/voice/{code}")
async def voice_socket(websocket: WebSocket, code: str, role: str = "guest"):
    token = websocket.cookies.get(settings.SESSION_COOKIE_NAME)
    try:
        if not token:
            raise ValueError("no session")
        identity = auth.read_session_token(token)
    except Exception:
        await websocket.close(code=4401)
        return
    if not _origin_ok(websocket):
        await websocket.close(code=4403)
        return

    await websocket.accept()
    role = "host" if role == "host" else "guest"
    room = rooms.get(code)
    if not room:
        await _refuse(websocket, "no_room", "That call code is not valid any more.")
        return
    if role == "host" and identity.uid != room.host_uid:
        await _refuse(websocket, "not_host", "Only the person who started this call can host it.")
        return
    if role in room.parts:
        await _refuse(websocket, "role_taken", "Someone is already connected as that person on this call.")
        return

    me = Participant(role=role, identity=identity, ws=websocket, speaker=Speaker.caller if role == "host" else Speaker.agent)
    room.parts[role] = me
    store.add_participant(room.call_id, identity.uid)
    peer = room.peer_of(role)
    call = store.get(room.call_id)
    me.send_json({"type": "joined", "role": role, "code": room.code, "call_id": room.call_id,
                  "label": call.label if call else "Voice call", "peer": peer is not None,
                  "stt": settings.deepgram_configured})
    if peer:
        peer.send_json({"type": "peer", "state": "joined"})

    writer = asyncio.create_task(_writer(me))
    stt_task = asyncio.create_task(_stt_worker(room, me))
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data is not None:
                if not room.is_live or len(data) > MAX_FRAME_BYTES or len(data) % 2:
                    continue  # before both accepted the notice, audio is dropped: never relayed, never transcribed
                other = room.peer_of(role)
                if other:
                    other.send_audio(data)
                if me.upstream is not None:
                    try:
                        await me.upstream.send(data)
                    except Exception:  # noqa: BLE001
                        me.upstream = None
                continue
            text = msg.get("text")
            if not text or len(text) > 1024:
                continue
            try:
                cmd = json.loads(text)
            except ValueError:
                continue
            kind = cmd.get("type")
            if kind == "ack_notice":
                me.acked = True
                if room.recompute_live():
                    await asyncio.to_thread(store.set_notice_given, room.call_id)
                    room.broadcast({"type": "live"})
            elif kind == "mute":
                other = room.peer_of(role)
                if other:
                    other.send_json({"type": "peer_muted", "muted": bool(cmd.get("muted"))})
            elif kind == "hangup":
                break
    except Exception as exc:  # noqa: BLE001
        logger.info("Voice socket for %s ended: %r", role, exc)
    finally:
        room.parts.pop(role, None)
        room.recompute_live()
        other = room.peer_of(role)
        await _finish_stt(me, stt_task)
        if room.end_reason == "risk":
            pass  # already told both people and saved by _auto_end: do not say anything else or end the call a second time
        elif role == "host":
            room.ended = True
            if other:
                other.send_json({"type": "ended", "reason": "host_left"})
                other.close_after_flush()
            await asyncio.to_thread(store.end_call, room.call_id)
        elif other:
            other.send_json({"type": "peer", "state": "left"})
        me.close_after_flush()
        try:
            await asyncio.wait_for(writer, timeout=2)
        except Exception:  # noqa: BLE001
            writer.cancel()
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass

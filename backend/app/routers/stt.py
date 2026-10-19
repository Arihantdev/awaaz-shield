"""
Live speech-to-text through Deepgram.

The browser sends audio (MediaRecorder chunks) to /ws/stt/{call_id}; this endpoint relays it to Deepgram's
streaming API and turns each finished phrase into a normal transcript line, scored exactly like a typed
or microphone line. The Deepgram key stays here on the server and is never sent to the browser.

Messages sent back to the browser (JSON text):
  {"type": "ready"}                              Deepgram accepted the connection
  {"type": "interim", "text": "..."}             words still being spoken (display only, not scored)
  {"type": "transcript", "text": "...", "score": 87, "level": "critical"}   a finished phrase, now scored
                                                 (with ?diarize=1 it also carries "speaker": "agent" | "caller")
  {"type": "roles", "swapped": true}             the operator swapped who counts as the caller (diarize mode)

?lang=multi|en-IN|en|hi picks the recognition language for this stream (default: DEEPGRAM_LANGUAGE).

Speakerphone mode (?diarize=1): one audio stream holds both voices. Deepgram labels each word with a speaker
number; the first voice heard is taken to be the agent (the person on this laptop, who normally says "hello"
first) and any other voice is the caller. The browser can send the text "swap" to flip that, which affects
phrases from then on. Without ?diarize=1 every phrase gets the single speaker given in ?speaker=.
  {"type": "error", "code": "...", "message": "..."}   then the socket closes
"""
import asyncio
import json
import logging
from urllib.parse import urlencode

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import auth
from ..config import settings
from ..models import Speaker, TranscriptChunk
from ..store import store

logger = logging.getLogger("awaaz.stt")
router = APIRouter()


# Languages the operator may pick in the panel. "multi" follows English <-> Hindi switching inside one call.
LANGUAGES = {"multi", "en-IN", "en", "hi"}


def _upstream_url(diarize: bool = False, language: str | None = None, keyterms: bool = True) -> str:
    params = [
        ("model", settings.DEEPGRAM_MODEL),
        ("language", language if language in LANGUAGES else settings.DEEPGRAM_LANGUAGE),
        ("smart_format", "true"),
        ("interim_results", "true"),
        # ms of silence that closes a phrase: lower = faster, but phrases get split mid-sentence (and read worse)
        ("endpointing", str(settings.DEEPGRAM_ENDPOINTING_MS)),
        ("punctuate", "true"),
    ]
    if diarize:
        params.append(("diarize", "true"))  # label each word with the voice it belongs to
    if keyterms:
        params += [("keyterm", term) for term in settings.deepgram_keyterms]  # boost scam-call vocabulary
    return f"{settings.DEEPGRAM_URL}?{urlencode(params)}"


async def _open(url: str):
    headers = {"Authorization": f"Token {settings.DEEPGRAM_API_KEY}"}
    try:  # websockets >= 14
        return await websockets.connect(url, additional_headers=headers, open_timeout=10)
    except TypeError:  # older releases call it extra_headers
        return await websockets.connect(url, extra_headers=headers, open_timeout=10)


async def _connect_upstream(diarize: bool = False, language: str | None = None):
    try:
        return await _open(_upstream_url(diarize, language))
    except Exception:  # noqa: BLE001
        if not settings.deepgram_keyterms:
            raise
        # A model or language that does not accept keyterms would refuse the connection: retry once without them.
        logger.info("Deepgram refused the connection with keyterms; retrying without them")
        return await _open(_upstream_url(diarize, language, keyterms=False))


def split_by_speaker(alt: dict) -> list[tuple[int, str]]:
    """Group a Deepgram alternative's words into runs by speaker number: [(speaker, "text"), ...].
    Returns [] when the words carry no speaker labels, so the caller can fall back to the whole transcript."""
    words = alt.get("words") or []
    if not words or any("speaker" not in w for w in words):
        return []
    runs: list[tuple[int, list[str]]] = []
    for w in words:
        token = (w.get("punctuated_word") or w.get("word") or "").strip()
        if not token:
            continue
        if runs and runs[-1][0] == w["speaker"]:
            runs[-1][1].append(token)
        else:
            runs.append((w["speaker"], [token]))
    return [(spk, " ".join(toks)) for spk, toks in runs]


class RoleMap:
    """Turns Deepgram's speaker numbers into agent / caller. The first voice heard is the agent."""

    def __init__(self) -> None:
        self.order: list[int] = []
        self.swapped = False

    def role(self, speaker_no: int) -> Speaker:
        if speaker_no not in self.order:
            self.order.append(speaker_no)
        is_first = self.order.index(speaker_no) == 0
        agent = is_first != self.swapped
        return Speaker.agent if agent else Speaker.caller


async def _fail(websocket: WebSocket, code: str, message: str) -> None:
    try:
        await websocket.send_text(json.dumps({"type": "error", "code": code, "message": message}))
        await websocket.close(code=1011)
    except Exception:  # noqa: BLE001 - the client may already be gone
        pass


@router.websocket("/ws/stt/{call_id}")
async def stt_socket(websocket: WebSocket, call_id: str, speaker: str = "caller", diarize: int = 0, lang: str = ""):
    token = websocket.cookies.get(settings.SESSION_COOKIE_NAME)
    try:
        if not token:
            raise ValueError("no session")
        auth.read_session_token(token)
    except Exception:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    if not settings.deepgram_configured:
        await _fail(websocket, "not_configured", "Deepgram is not configured on the server (DEEPGRAM_API_KEY is empty).")
        return
    call = store.get(call_id)
    if not call or call.status.value != "active":
        await _fail(websocket, "no_call", "That call does not exist or has ended.")
        return
    who = Speaker.agent if speaker == "agent" else Speaker.caller
    roles = RoleMap() if diarize else None

    try:
        upstream = await _connect_upstream(bool(diarize), lang or None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not reach Deepgram: %s", exc)
        await _fail(websocket, "upstream_unreachable", "Could not connect to Deepgram. Check the API key and network.")
        return

    await websocket.send_text(json.dumps({"type": "ready"}))

    async def browser_to_deepgram() -> None:
        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    await upstream.send(msg["bytes"])
                elif msg.get("text") == "stop":
                    break
                elif msg.get("text") == "swap" and roles is not None:
                    roles.swapped = not roles.swapped
                    await websocket.send_text(json.dumps({"type": "roles", "swapped": roles.swapped}))
        except WebSocketDisconnect:
            pass
        finally:
            try:  # ask Deepgram to flush whatever it still holds
                await upstream.send(json.dumps({"type": "CloseStream"}))
            except Exception:  # noqa: BLE001
                pass

    async def deepgram_to_browser() -> None:
        async for raw in upstream:
            try:
                data = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if data.get("type") != "Results":
                continue
            alts = (data.get("channel") or {}).get("alternatives") or []
            text = (alts[0].get("transcript") if alts else "") or ""
            text = text.strip()
            if not text:
                continue
            if not data.get("is_final"):
                await websocket.send_text(json.dumps({"type": "interim", "text": text}))
                continue
            # one line per voice: in speakerphone mode a finished phrase can hold both people
            parts = [(roles.role(no), t) for no, t in split_by_speaker(alts[0])] if roles else []
            if not parts:
                parts = [(who, text)]
            for who_part, part_text in parts:
                updated = await asyncio.to_thread(
                    store.add_transcript_and_score, call_id, TranscriptChunk(text=part_text, speaker=who_part)
                )
                payload = {"type": "transcript", "text": part_text}
                if roles:
                    payload["speaker"] = who_part.value
                if updated:
                    payload.update(score=updated.current_score, level=updated.current_level.value)
                await websocket.send_text(json.dumps(payload))

    tasks = [asyncio.create_task(browser_to_deepgram()), asyncio.create_task(deepgram_to_browser())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if tasks[0] in done:  # browser stopped: give Deepgram a moment to return the last phrase
            try:
                await asyncio.wait_for(tasks[1], timeout=3)
            except Exception:  # noqa: BLE001
                pass
        for t in tasks:
            if not t.done():
                t.cancel()
        for t in done:
            if t.exception():
                logger.warning("STT relay ended with an error: %r", t.exception())
    finally:
        await upstream.close()
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass

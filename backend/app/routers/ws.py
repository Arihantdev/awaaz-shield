"""
A single broadcast channel: every connected dashboard gets every event
(call_created, call_updated, alert, action_recorded, demo_reset). For a
monitoring console this is simpler and good enough — filtering to "the one
call I'm viewing" happens client-side. A per-call channel would be a
straightforward follow-up (see README "Where to go from here").
"""
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import auth
from ..config import settings
from ..store import store

router = APIRouter()


@router.websocket("/ws/dashboard")
async def dashboard_socket(websocket: WebSocket):
    token = websocket.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        await websocket.close(code=4401)
        return
    try:
        identity = auth.read_session_token(token)
    except Exception:
        await websocket.close(code=4401)
        return
    uid = identity.uid

    await websocket.accept()
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def visible(event: dict) -> bool:
        """Only events about calls this person may see (a demo reset has no call and goes to everyone)."""
        call_id = (event.get("call") or {}).get("id") or event.get("call_id")
        return call_id is None or store.can_access_id(call_id, uid)

    def on_event(event: dict) -> None:
        if visible(event):
            loop.call_soon_threadsafe(queue.put_nowait, event)

    store.subscribe(on_event)
    try:
        # Prime the client with current state on connect.
        await websocket.send_text(json.dumps({"type": "snapshot", "calls": [c.model_dump() for c in store.list_calls_for(uid)]}))
        while True:
            event = await queue.get()
            await websocket.send_text(json.dumps(event, default=str))
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(on_event)

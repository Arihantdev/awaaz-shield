import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException

from .. import auth
from ..config import settings
from ..models import ActionRequest, Call, CallStatus, CreateCallRequest, EvaluateRequest, Evaluation, IngestRequest, TranscriptChunk
from ..risk import evaluator
from ..store import store

router = APIRouter(prefix="/api/calls", tags=["calls"])

_NOT_FOUND = "Call not found."  # also what a person with no access sees: we do not reveal that the call exists

_eval_times: dict[str, deque] = defaultdict(deque)
_eval_lock = threading.Lock()


def _own_call(call_id: str, identity: auth.Identity) -> Call:
    call = store.get_for(call_id, identity.uid)
    if not call:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return call


@router.post("", response_model=Call)
def create_call(body: CreateCallRequest, identity: auth.Identity = Depends(auth.require_session)):
    return store.create_call(body.label, body.source, owner_uid=identity.uid, owner_email=identity.email)


@router.get("", response_model=list[Call])
def list_calls(identity: auth.Identity = Depends(auth.require_session)):
    return store.list_calls_for(identity.uid)


@router.get("/{call_id}", response_model=Call)
def get_call(call_id: str, identity: auth.Identity = Depends(auth.require_session)):
    return _own_call(call_id, identity)


@router.post("/{call_id}/ingest", response_model=Call)
def ingest(call_id: str, body: IngestRequest, identity: auth.Identity = Depends(auth.require_session)):
    """Ingest one transcript line, score it, and broadcast the update."""
    _own_call(call_id, identity)
    chunk = TranscriptChunk(text=body.text, speaker=body.speaker)
    call = store.add_transcript_and_score(call_id, chunk)
    if not call:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return call


@router.post("/{call_id}/end", response_model=Call)
def end_call(call_id: str, identity: auth.Identity = Depends(auth.require_session)):
    _own_call(call_id, identity)
    call = store.end_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return call


@router.post("/{call_id}/actions")
def record_action(call_id: str, body: ActionRequest, identity: auth.Identity = Depends(auth.require_session)):
    _own_call(call_id, identity)
    action = store.record_action(call_id, body.type, body.note, by_uid=identity.uid)
    if not action:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return action


@router.delete("/{call_id}")
def delete_call(call_id: str, identity: auth.Identity = Depends(auth.require_session)):
    """Permanently delete a call, its transcript and its risk history, here and in saved storage. Owner only, ended calls only."""
    call = _own_call(call_id, identity)
    if not store.can_delete(call, identity.uid):
        raise HTTPException(status_code=403, detail="Only the person who started this call can delete it.")
    if call.status == CallStatus.active:
        raise HTTPException(status_code=409, detail="This call is still in progress. End it before deleting it.")
    try:
        deleted = store.delete_call(call_id)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Could not delete right now. Nothing was removed; please try again.") from None
    if not deleted:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return {"ok": True}


@router.delete("")
def delete_my_calls(identity: auth.Identity = Depends(auth.require_session)):
    """Delete every ended call this person started. Calls still in progress are kept."""
    try:
        deleted, skipped_active = store.delete_calls_of(identity.uid)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Could not delete right now. Some calls may remain; please try again.") from None
    return {"deleted": deleted, "skipped_active": skipped_active}


@router.post("/{call_id}/evaluate", response_model=Evaluation)
def evaluate(call_id: str, body: EvaluateRequest, identity: auth.Identity = Depends(auth.require_session)):
    """Risk-evaluator chat: answer a question about this call from its transcript and/or what the person typed.

    Nothing is stored or changed: the call's own score keeps coming from its transcript. The message is not logged."""
    call = _own_call(call_id, identity)
    _check_rate(identity.uid)
    return evaluator.evaluate(call, body.message)


def _check_rate(uid: str) -> None:
    limit = max(1, settings.EVALUATOR_RATE_PER_MINUTE)
    now = time.monotonic()
    with _eval_lock:
        q = _eval_times[uid]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            raise HTTPException(status_code=429, detail="Too many questions in a minute. Please wait a little and try again.")
        q.append(now)

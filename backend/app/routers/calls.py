from fastapi import APIRouter, Depends, HTTPException

from .. import auth
from ..models import ActionRequest, Call, CreateCallRequest, IngestRequest, TranscriptChunk
from ..store import store

router = APIRouter(prefix="/api/calls", tags=["calls"])


@router.post("", response_model=Call)
def create_call(body: CreateCallRequest, identity: auth.Identity = Depends(auth.require_session)):
    return store.create_call(body.label, body.source, owner_uid=identity.uid, owner_email=identity.email)


@router.get("", response_model=list[Call])
def list_calls(_identity: auth.Identity = Depends(auth.require_session)):
    return store.list_calls()


@router.get("/{call_id}", response_model=Call)
def get_call(call_id: str, _identity: auth.Identity = Depends(auth.require_session)):
    call = store.get(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    return call


@router.post("/{call_id}/ingest", response_model=Call)
def ingest(call_id: str, body: IngestRequest, _identity: auth.Identity = Depends(auth.require_session)):
    """Ingest one transcript line, score it, and broadcast the update."""
    chunk = TranscriptChunk(text=body.text, speaker=body.speaker)
    call = store.add_transcript_and_score(call_id, chunk)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    return call


@router.post("/{call_id}/end", response_model=Call)
def end_call(call_id: str, _identity: auth.Identity = Depends(auth.require_session)):
    call = store.end_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found.")
    return call


@router.post("/{call_id}/actions")
def record_action(call_id: str, body: ActionRequest, identity: auth.Identity = Depends(auth.require_session)):
    action = store.record_action(call_id, body.type, body.note, by_uid=identity.uid)
    if not action:
        raise HTTPException(status_code=404, detail="Call not found.")
    return action

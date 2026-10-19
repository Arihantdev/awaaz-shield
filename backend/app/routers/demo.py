from fastapi import APIRouter, Depends

from .. import auth
from ..models import AddPatternRequest
from ..risk.patterns import DEFAULT_PATTERNS, add_pattern, reset_to_defaults
from ..store import store

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/reset")
def reset_demo(_identity: auth.Identity = Depends(auth.require_session)):
    store.reset()
    reset_to_defaults(DEFAULT_PATTERNS)
    return {"ok": True}


@router.post("/patterns")
def add_demo_pattern(body: AddPatternRequest, _identity: auth.Identity = Depends(auth.require_session)):
    """Add a scam phrase live during a demo without restarting the backend."""
    pattern = add_pattern(body.category, body.phrase, body.weight, body.language)
    return {"ok": True, "pattern": pattern.__dict__}

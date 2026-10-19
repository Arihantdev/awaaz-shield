from fastapi import APIRouter, Depends

from .. import auth
from ..store import store

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("")
def get_analytics(_identity: auth.Identity = Depends(auth.require_session)):
    return store.analytics()

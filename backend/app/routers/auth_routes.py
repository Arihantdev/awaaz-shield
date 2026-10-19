from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from .. import auth
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SessionFromIdToken(BaseModel):
    id_token: str


class DevLogin(BaseModel):
    email: str


def _set_session_cookie(response: Response, identity: auth.Identity) -> None:
    token = auth.create_session_token(identity)
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=auth.SESSION_MAX_AGE_SECONDS,
        httponly=True,
        samesite="lax",
    )


@router.post("/session")
def exchange_firebase_token(body: SessionFromIdToken, response: Response):
    """Step 2 of auth: trade a verified Firebase ID token for a backend session."""
    identity = auth.verify_id_token(body.id_token)
    _set_session_cookie(response, identity)
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.post("/dev-login")
def dev_login(body: DevLogin, response: Response):
    """Only available while Firebase isn't configured — see auth.py docstring."""
    identity = auth.dev_login(body.email)
    _set_session_cookie(response, identity)
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.get("/me")
def me(identity: auth.Identity = Depends(auth.require_session)):
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(settings.SESSION_COOKIE_NAME)
    return {"ok": True}

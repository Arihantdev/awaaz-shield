from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from .. import auth
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SessionFromIdToken(BaseModel):
    id_token: str


class DevLogin(BaseModel):
    email: str


def _is_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


def cookie_flags(request: Request) -> dict:
    """secure / samesite for the session cookie. SameSite=None is only valid together with Secure, so it falls back to lax otherwise."""
    secure = {"true": True, "false": False}.get(settings.COOKIE_SECURE, _is_https(request))
    samesite = settings.COOKIE_SAMESITE if settings.COOKIE_SAMESITE in ("lax", "strict", "none") else "lax"
    if samesite == "none" and not secure:
        samesite = "lax"
    return {"secure": secure, "samesite": samesite}


def _set_session_cookie(request: Request, response: Response, identity: auth.Identity) -> None:
    token = auth.create_session_token(identity)
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=auth.SESSION_MAX_AGE_SECONDS,
        httponly=True,
        **cookie_flags(request),
    )


@router.post("/session")
def exchange_firebase_token(body: SessionFromIdToken, request: Request, response: Response):
    """Step 2 of auth: trade a verified Firebase ID token for a backend session."""
    identity = auth.verify_id_token(body.id_token)
    _set_session_cookie(request, response, identity)
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.post("/dev-login")
def dev_login(body: DevLogin, request: Request, response: Response):
    """Only available while Firebase isn't configured — see auth.py docstring."""
    identity = auth.dev_login(body.email)
    _set_session_cookie(request, response, identity)
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.get("/me")
def me(identity: auth.Identity = Depends(auth.require_session)):
    return {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode}


@router.post("/logout")
def logout(request: Request, response: Response):
    response.delete_cookie(settings.SESSION_COOKIE_NAME, httponly=True, **cookie_flags(request))
    return {"ok": True}

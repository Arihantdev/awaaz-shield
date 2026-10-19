"""
Two-step auth, matching the project's requirement that a successful
Firebase login in the browser is NOT the same thing as a valid backend
session: (1) the frontend authenticates with Firebase and gets an ID
token, (2) the frontend exchanges that token here for a backend session
cookie. Only the backend session (checked via require_session) guards
real routes.

DEV MODE: until you set FIREBASE_ENABLED=true and provide a real service
account (see .env.example), there is no Firebase project to verify
against. In that case /auth/session accepts a plain email with no
password check and issues a session clearly marked dev_mode=true. This
exists purely so you can build and demo the dashboard before Firebase is
wired up — do not use the dev-mode path once the project is public.
"""
import json
import threading
import time
from dataclasses import dataclass

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .config import settings

_serializer = URLSafeTimedSerializer(settings.APP_SECRET_KEY, salt="awaaz-session")
SESSION_MAX_AGE_SECONDS = 60 * 60 * 12  # 12 hours

_firebase_app = None
_firebase_lock = threading.Lock()


def _get_firebase_app():
    """Create the Firebase Admin app exactly once, even if several threads ask at the same moment
    (request handlers, the Firestore writer and the startup loader all use it)."""
    global _firebase_app
    if _firebase_app is not None:
        return _firebase_app
    with _firebase_lock:
        if _firebase_app is None:
            import firebase_admin
            from firebase_admin import credentials

            try:
                _firebase_app = firebase_admin.get_app()
            except ValueError:
                cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
                _firebase_app = firebase_admin.initialize_app(cred)
    return _firebase_app


@dataclass
class Identity:
    uid: str
    email: str
    dev_mode: bool


def verify_id_token(id_token: str) -> Identity:
    """Verify a Firebase ID token. Raises HTTPException(401) on failure."""
    if not settings.firebase_configured:
        raise HTTPException(
            status_code=400,
            detail="Firebase is not configured on this backend yet; use the dev-mode login instead.",
        )
    try:
        from firebase_admin import auth as firebase_auth

        _get_firebase_app()
        decoded = firebase_auth.verify_id_token(id_token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Invalid Firebase ID token: {exc}") from exc

    if settings.REQUIRE_EMAIL_VERIFIED and not decoded.get("email_verified", False):
        raise HTTPException(status_code=403, detail="Email not verified yet.")

    return Identity(uid=decoded["uid"], email=decoded.get("email", ""), dev_mode=False)


def dev_login(email: str) -> Identity:
    """Unverified local login used only while Firebase isn't configured."""
    if not settings.ALLOW_DEV_LOGIN:
        raise HTTPException(status_code=403, detail="Dev-mode login is turned off on this server. Sign in with Firebase.")
    if settings.firebase_configured:
        raise HTTPException(
            status_code=400,
            detail="Firebase is configured; use a real ID token instead of dev-mode login.",
        )
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Provide a valid-looking email.")
    return Identity(uid=f"dev:{email}", email=email, dev_mode=True)


def create_session_token(identity: Identity) -> str:
    payload = {"uid": identity.uid, "email": identity.email, "dev_mode": identity.dev_mode, "iat": time.time()}
    return _serializer.dumps(payload)


def read_session_token(token: str) -> Identity:
    try:
        payload = _serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except BadSignature as exc:
        raise HTTPException(status_code=401, detail="Session invalid or expired.") from exc
    return Identity(uid=payload["uid"], email=payload["email"], dev_mode=payload["dev_mode"])


def require_session(request: Request) -> Identity:
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated. No backend session found.")
    return read_session_token(token)

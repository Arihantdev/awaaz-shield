"""
Consent record. A user must accept before the console loads.

Stored in Firestore (collection `consents`, one document per user, id = their email), e.g.
    consents/chavisingh962@gmail.com -> { email, consent: "Yes", version, language, accepted_at, ... }
and also appended to a local file as a backup (also used when Firebase is not configured).
"""
import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import auth
from ..config import settings
from ..persistence import repo

log = logging.getLogger("awaaz.consent")
router = APIRouter(prefix="/api/consent", tags=["consent"])


class Accept(BaseModel):
    version: str
    language: str = "en"


def _file_records() -> list[dict]:
    try:
        with open(settings.CONSENT_LOG_PATH, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except FileNotFoundError:
        return []


@router.get("")
def get_consent(identity: auth.Identity = Depends(auth.require_session)):
    doc_id = repo.consent_doc_id(identity.email, identity.uid)
    if repo.enabled:
        try:
            doc = repo.get_consent(doc_id)
            ok = bool(doc) and doc.get("consent") == "Yes" and doc.get("version") == settings.CONSENT_VERSION
            return {"required_version": settings.CONSENT_VERSION, "accepted": ok, "at": (doc or {}).get("accepted_at"), "source": "firestore"}
        except Exception as exc:  # noqa: BLE001 - fall back to the local record rather than locking the user out
            log.warning("Could not read consent from Firestore (%s); using the local record.", type(exc).__name__)
    mine = [r for r in _file_records() if r.get("uid") == identity.uid and r.get("version") == settings.CONSENT_VERSION]
    return {"required_version": settings.CONSENT_VERSION, "accepted": bool(mine), "at": mine[-1]["at"] if mine else None, "source": "file"}


@router.post("")
def accept(body: Accept, identity: auth.Identity = Depends(auth.require_session)):
    now = datetime.now(timezone.utc).isoformat()
    stored = []
    if repo.enabled:
        try:
            repo.save_consent(
                repo.consent_doc_id(identity.email, identity.uid),
                {"email": identity.email, "uid": identity.uid, "consent": "Yes", "version": body.version,
                 "language": body.language, "accepted_at": now, "app": "awaaz-shield"},
            )
            stored.append("firestore")
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not save consent to Firestore: %s", type(exc).__name__)
    record = {"uid": identity.uid, "email": identity.email, "version": body.version, "language": body.language, "at": now}
    os.makedirs(os.path.dirname(settings.CONSENT_LOG_PATH) or ".", exist_ok=True)
    with open(settings.CONSENT_LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
    stored.append("file")
    return {"required_version": settings.CONSENT_VERSION, "accepted": body.version == settings.CONSENT_VERSION, "at": now, "stored": stored}

"""
Firestore persistence for calls (optional; off unless Firebase is configured).

Layout (matches backend/seed_firestore.py):
  calls/{callId}                      summary doc (score, level, status, owner, disposition, ...)
  calls/{callId}/transcript/{id}      one doc per transcript line
  calls/{callId}/alerts/{id}          one doc per alert
  calls/{callId}/actions/{id}         one doc per operator action
  calls/{callId}/risk_history/{id}    one doc per score point

Design rules:
  * WRITES NEVER BLOCK OR BREAK A CALL. Every write goes onto a queue and is performed by one
    background thread; failures are logged and dropped. If Firestore is down, scoring and the
    dashboard keep working from memory.
  * Digit runs (OTPs, card/phone numbers, ...) are masked in the PERSISTED copy of transcripts and
    notes (FIRESTORE_MASK_NUMBERS=false to disable). The live in-memory call keeps the raw text.
  * LOADING happens once at startup in a background thread (see CallStore.load_from_persistence).
"""
import logging
import queue
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from .config import settings
from .models import (
    Alert,
    Call,
    CallStatus,
    OperatorAction,
    RiskLevel,
    RiskPoint,
    Speaker,
    TranscriptChunk,
    level_for_score,
)

logger = logging.getLogger("awaaz.persistence")

# 4+ digits, optionally separated by single spaces/dashes (card numbers, phone numbers, OTPs)
_NUMBER_RE = re.compile(r"(?:\d[ -]?){3,}\d")
_WRITE_TIMEOUT = 15  # seconds per Firestore call


def mask(text: str) -> str:
    if not text or not settings.FIRESTORE_MASK_NUMBERS:
        return text
    return _NUMBER_RE.sub("[number]", text)


def _dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value)


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


class FirestoreRepo:
    def __init__(self, db: Any = None) -> None:
        self._db = db  # injectable for tests
        self._q: "queue.Queue[tuple]" = queue.Queue(maxsize=2000)
        self._thread: Optional[threading.Thread] = None
        self._thread_lock = threading.Lock()
        self._client_lock = threading.Lock()

    # ------------------------------------------------------------------ plumbing
    @property
    def enabled(self) -> bool:
        return settings.firestore_enabled

    def _client(self):
        if self._db is None:
            with self._client_lock:
                if self._db is None:
                    from firebase_admin import firestore

                    from . import auth

                    self._db = firestore.client(auth._get_firebase_app())
        return self._db

    # ------------------------------------------------------------------ consent (synchronous: small, user-facing)
    @staticmethod
    def consent_doc_id(email: str, uid: str) -> str:
        return (email or uid).strip().lower().replace("/", "_")

    def save_consent(self, doc_id: str, data: dict) -> None:
        self._client().collection("consents").document(doc_id).set(data, merge=True)

    def get_consent(self, doc_id: str) -> Optional[dict]:
        snap = self._client().collection("consents").document(doc_id).get(timeout=10)
        return snap.to_dict() if snap.exists else None

    def _ref(self, path: tuple):
        db = self._client()
        ref = db.collection(path[0]).document(path[1])
        if len(path) > 2:
            ref = ref.collection(path[2]).document(path[3])
        return ref

    def _ensure_thread(self) -> None:
        with self._thread_lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="firestore-writer", daemon=True)
                self._thread.start()

    def _run(self) -> None:
        while True:
            path, data = self._q.get()
            try:
                for attempt in (1, 2, 3):
                    try:
                        self._ref(path).set(data, merge=True, retry=None, timeout=_WRITE_TIMEOUT)
                        break
                    except Exception as exc:  # noqa: BLE001 - never let a write kill the worker
                        if attempt == 3:
                            logger.warning("Firestore write to %s failed: %s", "/".join(path), exc)
                        else:
                            time.sleep(attempt)  # 1s, then 2s: a cold connection often fails once
            finally:
                self._q.task_done()

    def _submit(self, path: tuple, data: dict) -> None:
        if not self.enabled:
            return
        self._ensure_thread()
        try:
            self._q.put_nowait((path, data))
        except queue.Full:
            logger.warning("Firestore write queue full; dropping write to %s", "/".join(path))

    def flush(self, timeout: float = 30.0) -> bool:
        """Wait until queued writes are done (used by tests / graceful shutdown)."""
        end = time.time() + timeout
        while self._q.unfinished_tasks and time.time() < end:
            time.sleep(0.02)
        return self._q.unfinished_tasks == 0

    # ------------------------------------------------------------------ writes
    def save_call(self, call: Call, matched_patterns: set[str]) -> None:
        self._submit(
            ("calls", call.id),
            {
                "label": call.label,
                "source": call.source,
                "status": call.status.value if hasattr(call.status, "value") else str(call.status),
                "started_at": _dt(call.started_at),
                "ended_at": _dt(call.ended_at),
                "owner_uid": call.owner_uid,
                "owner_email": call.owner_email,
                "current_score": call.current_score,
                "max_score": max((p.score for p in call.risk_history), default=0),
                "current_level": call.current_level.value,
                "scorer": call.scorer,
                "last_explanation": call.last_explanation,
                "matched_patterns": sorted(matched_patterns),
                "alert_count": len(call.alerts),
                "disposition": call.disposition,
            },
        )

    def add_transcript(self, call_id: str, chunk: TranscriptChunk) -> None:
        self._submit(
            ("calls", call_id, "transcript", chunk.id),
            {"speaker": chunk.speaker.value, "text": mask(chunk.text), "ts": _dt(chunk.ts)},
        )

    def add_alert(self, call_id: str, alert: Alert) -> None:
        self._submit(
            ("calls", call_id, "alerts", alert.id),
            {
                "level": alert.level.value,
                "message": alert.message,
                "matched_patterns": list(alert.matched_patterns),
                "ts": _dt(alert.ts),
            },
        )

    def add_action(self, call_id: str, action: OperatorAction) -> None:
        self._submit(
            ("calls", call_id, "actions", action.id),
            {"type": action.type, "note": mask(action.note), "by_uid": action.by_uid, "ts": _dt(action.ts)},
        )

    def add_risk_point(self, call_id: str, index: int, point: RiskPoint) -> None:
        self._submit(
            ("calls", call_id, "risk_history", f"p{index:05d}"),
            {"score": point.score, "ts": _dt(point.ts)},
        )

    # ------------------------------------------------------------------ load
    def load_calls(self, limit: int) -> list[tuple[Call, set[str]]]:
        """Return up to `limit` most recent calls as (Call, matched_patterns). Raises on connection errors."""
        db = self._client()
        docs = (
            db.collection("calls")
            .order_by("started_at", direction="DESCENDING")
            .limit(limit)
                    .stream()
        )
        out: list[tuple[Call, set[str]]] = []
        for doc in docs:
            try:
                out.append(self._build_call(doc))
            except Exception as exc:  # noqa: BLE001 - skip a malformed doc, keep the rest
                logger.warning("Skipping unreadable call document %s: %s", getattr(doc, "id", "?"), exc)
        return out

    def _sub(self, doc, name: str) -> list:
                return [d for d in doc.reference.collection(name).stream()]

    def _build_call(self, doc) -> tuple[Call, set[str]]:
        d = doc.to_dict() or {}

        def speaker(v: str) -> Speaker:
            return Speaker(v) if v in Speaker._value2member_map_ else Speaker.unknown

        transcript = sorted(
            (
                TranscriptChunk(id=s.id, speaker=speaker(s.to_dict().get("speaker", "")),
                                text=s.to_dict().get("text", ""), ts=_iso(s.to_dict().get("ts")) or "")
                for s in self._sub(doc, "transcript")
            ),
            key=lambda t: t.ts,
        )
        risk = sorted(
            (RiskPoint(score=int(s.to_dict().get("score", 0)), ts=_iso(s.to_dict().get("ts")) or "")
             for s in self._sub(doc, "risk_history")),
            key=lambda p: p.ts,
        )
        alerts = sorted(
            (
                Alert(id=s.id, call_id=doc.id, level=RiskLevel(s.to_dict().get("level", "high")),
                      message=s.to_dict().get("message", ""),
                      matched_patterns=list(s.to_dict().get("matched_patterns", [])),
                      ts=_iso(s.to_dict().get("ts")) or "")
                for s in self._sub(doc, "alerts")
            ),
            key=lambda a: a.ts,
        )
        actions = sorted(
            (
                OperatorAction(id=s.id, call_id=doc.id, type=s.to_dict().get("type", ""),
                               note=s.to_dict().get("note", ""), by_uid=s.to_dict().get("by_uid", ""),
                               ts=_iso(s.to_dict().get("ts")) or "")
                for s in self._sub(doc, "actions")
            ),
            key=lambda a: a.ts,
        )

        score = int(d.get("current_score", 0))
        level = d.get("current_level")
        call = Call(
            id=doc.id,
            label=d.get("label", "Untitled call"),
            source=d.get("source", "simulated"),
            status=CallStatus(d.get("status", "ended")) if d.get("status") in ("active", "ended") else CallStatus.ended,
            started_at=_iso(d.get("started_at")) or "",
            ended_at=_iso(d.get("ended_at")),
            transcript=transcript,
            risk_history=risk,
            alerts=alerts,
            actions=actions,
            current_score=score,
            current_level=RiskLevel(level) if level in RiskLevel._value2member_map_ else level_for_score(score),
            last_explanation=d.get("last_explanation", ""),
            scorer=d.get("scorer", "heuristic"),
            owner_uid=d.get("owner_uid", ""),
            owner_email=d.get("owner_email", ""),
            disposition=d.get("disposition"),
        )
        return call, set(d.get("matched_patterns", []))


repo = FirestoreRepo()

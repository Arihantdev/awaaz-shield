"""
Call store: the live, in-memory working set of calls, plus a tiny pub/sub so the
websocket layer can broadcast updates to every connected dashboard client.

Persistence: when Firestore persistence is enabled (see persistence.py) every change is also
written to Firestore in the background, and saved calls are loaded back at startup. Memory stays
the source of truth for the live dashboard; Firestore is the durable record. If Firestore is
unavailable the app keeps working from memory.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Callable

from .config import settings
from .models import Alert, Call, CallStatus, OperatorAction, RiskPoint, TranscriptChunk, _now
from .persistence import repo

logger = logging.getLogger("awaaz.store")

_VERDICTS = ("flagged", "escalated", "dismissed")
_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def signals_for(matched) -> list[str]:
    """Map matched phrases to their tactic category (e.g. 'kyc_scam'); unknown phrases (custom/Claude) stay as-is."""
    from .risk.patterns import PATTERNS
    from .risk.rules import RULE_CATEGORY

    by_phrase = {**RULE_CATEGORY, **{p.phrase: p.category for p in PATTERNS}}
    return sorted({by_phrase.get(m, m) for m in matched})


class CallStore:
    def __init__(self) -> None:
        self._calls: dict[str, Call] = {}
        self._subscribers: list[Callable[[dict], None]] = []
        self._category_memory: dict[str, set[str]] = {}
        self._participants: dict[str, set[str]] = {}  # call id -> uids that joined (in memory; the owner is on the call)
        self._operators: set[str] = set()  # uids of signed-in people whose email is in OPERATOR_EMAILS
        self._lock = threading.RLock()

    # ---- access control ----
    def add_participant(self, call_id: str, uid: str) -> None:
        with self._lock:
            self._participants.setdefault(call_id, set()).add(uid)

    def mark_operator(self, uid: str) -> None:
        with self._lock:
            self._operators.add(uid)

    def is_operator(self, uid: str) -> bool:
        return uid in self._operators

    def can_access(self, call: Call | None, uid: str) -> bool:
        """Owner and joined participants, plus operators for calls that were escalated to them.
        Calls with no recorded owner (old data) stay visible."""
        if call is None:
            return False
        if not settings.RESTRICT_CALL_ACCESS or not call.owner_uid:
            return True
        if call.owner_uid == uid or uid in self._participants.get(call.id, ()):
            return True
        return call.shared_with_operators and uid in self._operators

    def can_access_id(self, call_id: str, uid: str) -> bool:
        return self.can_access(self._calls.get(call_id), uid)

    def get_for(self, call_id: str, uid: str) -> Call | None:
        """The call, or None when it does not exist OR the person has no access (callers answer 404 either way)."""
        call = self._calls.get(call_id)
        return call if self.can_access(call, uid) else None

    def list_calls_for(self, uid: str) -> list[Call]:
        return [c for c in self.list_calls() if self.can_access(c, uid)]

    # ---- subscriptions (used by the websocket router) ----
    def subscribe(self, callback: Callable[[dict], None]) -> None:
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable[[dict], None]) -> None:
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    def _publish(self, event: dict) -> None:
        for cb in list(self._subscribers):
            cb(event)

    # ---- calls ----
    def create_call(self, label: str | None, source: str, owner_uid: str = "", owner_email: str = "") -> Call:
        call = Call(label=label or "Untitled call", source=source, owner_uid=owner_uid, owner_email=owner_email)
        with self._lock:
            self._calls[call.id] = call
            self._category_memory[call.id] = set()
        repo.save_call(call, set())
        self._publish({"type": "call_created", "call": call.model_dump()})
        return call

    def get(self, call_id: str) -> Call | None:
        return self._calls.get(call_id)

    def list_calls(self) -> list[Call]:
        with self._lock:
            calls = list(self._calls.values())
        return sorted(calls, key=lambda c: c.started_at, reverse=True)

    def set_notice_given(self, call_id: str) -> Call | None:
        """Record that the "this call is relayed and analysed" notice was shown to and accepted by both parties."""
        call = self._calls.get(call_id)
        if not call:
            return None
        if not call.notice_given:
            call.notice_given = True
            repo.save_call(call, self._category_memory.get(call_id, set()))
            self._publish({"type": "call_updated", "call": call.model_dump()})
        return call

    def end_call(self, call_id: str) -> Call | None:
        call = self._calls.get(call_id)
        if not call:
            return None
        call.status = CallStatus.ended
        call.ended_at = _now()
        repo.save_call(call, self._category_memory.get(call_id, set()))
        self._publish({"type": "call_updated", "call": call.model_dump()})
        return call

    def end_for_risk(self, call_id: str, limit: int) -> Call | None:
        """Awaaz Shield cut this call because its risk score went above `limit`: escalate it to the operators and end it."""
        call = self._calls.get(call_id)
        if not call:
            return None
        score = call.current_score
        with self._lock:
            call.ended_reason = "auto_risk"
            call.ended_threshold = limit
        self.record_action(
            call_id, "escalated",
            f"Ended automatically by Awaaz Shield: the risk score reached {score}, above the limit of {limit}. Sent to an operator.",
            by_uid="system",
        )
        ended = self.end_call(call_id)
        self._publish({"type": "auto_ended", "call_id": call_id, "score": score, "limit": limit})
        return ended

    # ---- deletion ----
    def can_delete(self, call: Call | None, uid: str) -> bool:
        """Only the person who started a call may delete it (joined people may not erase the owner's record)."""
        if call is None or not self.can_access(call, uid):
            return False
        return call.owner_uid == uid or not call.owner_uid

    def delete_call(self, call_id: str) -> bool:
        """Remove a call from memory AND from saved storage. Returns False when there is no such call.

        The saved copy is queued for deletion first: if that fails this raises and nothing is removed, so a call is never
        reported deleted while its saved copy survives. Clients are told before it disappears (their access check needs the call)."""
        with self._lock:
            if call_id not in self._calls:
                return False
            repo.delete_call(call_id)
            self._publish({"type": "call_deleted", "call_id": call_id})
            self._calls.pop(call_id, None)
            self._category_memory.pop(call_id, None)
            self._participants.pop(call_id, None)
        return True

    def delete_calls_of(self, uid: str) -> tuple[int, int]:
        """Delete every ENDED call this person started. Calls still in progress are left alone. Returns (deleted, skipped_active)."""
        with self._lock:
            mine = [c for c in self._calls.values() if self.can_delete(c, uid)]
        deleted = skipped = 0
        for c in mine:
            if c.status == CallStatus.active:
                skipped += 1
            elif self.delete_call(c.id):
                deleted += 1
        return deleted, skipped

    def purge_older_than(self, days: int) -> int:
        """Retention: delete ended calls that ended more than `days` days ago, in memory and in saved storage. 0 = off."""
        if days <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)

        def when(c: Call) -> datetime | None:
            raw = c.ended_at or c.started_at
            try:
                dt = datetime.fromisoformat(raw)
            except (TypeError, ValueError):
                return None
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

        with self._lock:
            old = [c.id for c in self._calls.values() if c.status == CallStatus.ended and (when(c) or cutoff) < cutoff]
        count = sum(1 for cid in old if self.delete_call(cid))
        already = set(old)
        try:  # older calls that were never loaded back into memory still sit in saved storage
            for cid in repo.expired_call_ids(cutoff):
                if cid not in self._calls and cid not in already:
                    repo.delete_call(cid)
                    count += 1
        except Exception as exc:  # noqa: BLE001 - storage down: the sweep simply runs again later
            logger.warning("Retention sweep could not read saved calls: %s", exc)
        if count:
            logger.info("Retention: deleted %d call(s) older than %d day(s)", count, days)
        return count

    def record_action(self, call_id: str, action_type: str, note: str, by_uid: str = "") -> OperatorAction | None:
        call = self._calls.get(call_id)
        if not call:
            return None
        if action_type == "escalated":
            call.shared_with_operators = True  # from now on operators can see it, even after later verdicts
        action = OperatorAction(call_id=call_id, type=action_type, note=note, by_uid=by_uid)
        call.actions.append(action)
        repo.add_action(call_id, action)
        if action_type in _VERDICTS or action_type == "restored":
            # "restored" takes a call back out of Operator history / Flagged: it has no verdict again
            call.disposition = None if action_type == "restored" else action_type
            repo.save_call(call, self._category_memory.get(call_id, set()))
            self._publish({"type": "call_updated", "call": call.model_dump()})
        self._publish({"type": "action_recorded", "call_id": call_id, "action": action.model_dump()})
        return action

    def add_transcript_and_score(self, call_id: str, chunk: TranscriptChunk) -> Call | None:
        from .risk.engine import assess

        call = self._calls.get(call_id)
        if not call:
            return None

        previous_level = call.current_level
        call.transcript.append(chunk)
        full_text = " ".join(t.text for t in call.transcript)

        previous_categories = self._category_memory.get(call_id, set())
        assessment = assess(full_text, previous_categories, turns=call.transcript)

        call.current_score = assessment.score
        call.current_level = assessment.level
        call.last_explanation = assessment.explanation
        call.scorer = assessment.scorer
        point = RiskPoint(score=assessment.score)
        call.risk_history.append(point)

        # Track matched phrases seen so the next turn can report *new* signals only.
        self._category_memory[call_id] = previous_categories | set(assessment.matched_patterns)
        call.signals = signals_for(self._category_memory[call_id])

        repo.add_transcript(call_id, chunk)
        repo.add_risk_point(call_id, len(call.risk_history) - 1, point)

        # Alert only when risk ESCALATES into (or further within) high/critical - not on every
        # line once a call is already at that level.
        alert = None
        if assessment.level.value in ("high", "critical") and _RANK[assessment.level.value] > _RANK[previous_level.value]:
            alert = Alert(
                call_id=call_id,
                level=assessment.level,
                message=assessment.explanation,
                matched_patterns=assessment.matched_patterns,
                signals=call.signals,
            )
            call.alerts.append(alert)
            repo.add_alert(call_id, alert)

        repo.save_call(call, self._category_memory[call_id])

        if alert:
            self._publish({"type": "alert", "call_id": call_id, "alert": alert.model_dump()})
        self._publish({"type": "call_updated", "call": call.model_dump()})
        return call

    # ---- persistence: load saved calls at startup ----
    def load_from_persistence(self) -> int:
        """Load recent calls from Firestore into memory. Returns how many were loaded. Never raises."""
        if not repo.enabled:
            return 0
        try:
            loaded = repo.load_calls(settings.FIRESTORE_LOAD_LIMIT)
        except Exception as exc:  # noqa: BLE001 - Firestore down/unconfigured must not stop the app
            logger.warning("Could not load saved calls from Firestore: %s", exc)
            return 0

        count = 0
        for call, matched in loaded:
            with self._lock:
                if call.id in self._calls:  # already created live in this process
                    continue
                if call.status == CallStatus.active:
                    # Nobody is feeding a call that was left open across a restart: close it.
                    call.status = CallStatus.ended
                    call.ended_at = call.transcript[-1].ts if call.transcript else call.started_at
                    repo.save_call(call, matched)
                call.signals = signals_for(matched)
                self._calls[call.id] = call
                self._category_memory[call.id] = set(matched)
            self._publish({"type": "call_created", "call": call.model_dump()})
            count += 1
        logger.info("Loaded %d saved call(s) from Firestore", count)
        return count

    def load_from_persistence_async(self) -> None:
        if repo.enabled:
            threading.Thread(target=self.load_from_persistence, name="firestore-loader", daemon=True).start()

    # ---- demo tooling ----
    def reset(self) -> None:
        """Clears the LIVE view only. Anything already saved in Firestore is kept."""
        with self._lock:
            self._calls.clear()
            self._category_memory.clear()
            self._participants.clear()
        self._publish({"type": "demo_reset"})

    def analytics(self, uid: str | None = None) -> dict:
        with self._lock:
            calls = [c for c in self._calls.values() if uid is None or self.can_access(c, uid)]
        active = [c for c in calls if c.status == CallStatus.active]
        high_risk_alerts = sum(
            1 for c in calls for a in c.alerts if a.level.value in ("high", "critical")
        )
        avg_score = round(sum(c.current_score for c in calls) / len(calls), 1) if calls else 0.0
        return {
            "monitored_calls": len(calls),
            "active_calls": len(active),
            "high_risk_alerts": high_risk_alerts,
            "average_risk_score": avg_score,
        }


store = CallStore()

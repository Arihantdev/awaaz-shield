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
        self._lock = threading.RLock()

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

    def record_action(self, call_id: str, action_type: str, note: str, by_uid: str = "") -> OperatorAction | None:
        call = self._calls.get(call_id)
        if not call:
            return None
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
        self._publish({"type": "demo_reset"})

    def analytics(self) -> dict:
        with self._lock:
            calls = list(self._calls.values())
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

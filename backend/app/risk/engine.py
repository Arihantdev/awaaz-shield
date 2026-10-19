"""
The single entry point the rest of the app calls to score a call. Decides
Claude vs. heuristic, and guarantees a RiskAssessment always comes back —
network/parsing failures from Claude fall back to the heuristic scorer
rather than bubbling up and breaking the ingestion pipeline mid-call.
"""
import logging

from . import heuristic
from ..config import settings
from ..models import RiskAssessment

logger = logging.getLogger("awaaz.risk_engine")


def labelled_text(turns) -> str:
    """Transcript with who said what, so a scorer can tell the caller's demands from the agent's replies."""
    return "\n".join(f"{'Agent' if getattr(t.speaker, 'value', t.speaker) == 'agent' else 'Caller'}: {t.text}" for t in turns)


def assess(full_text: str, previous_categories: set[str] | None = None, turns=None) -> RiskAssessment:
    if settings.claude_configured:
        try:
            from . import claude_scorer
            return claude_scorer.score_transcript(labelled_text(turns) if turns else full_text)
        except Exception as exc:  # noqa: BLE001 - any failure here must degrade, not crash
            logger.warning("Claude scoring failed, falling back to heuristic: %s", exc)

    if turns:
        return heuristic.score_turns(turns, previous_categories)
    return heuristic.score_transcript(full_text, previous_categories)

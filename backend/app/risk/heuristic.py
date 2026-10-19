"""
Deterministic, fully offline risk scorer. This is the default and the
fallback: it never calls out to the network, so the demo always works
even with zero API keys configured.

Approach:
  1. Scan the full transcript-so-far for pattern matches (patterns.py).
  2. Sum matched weights with diminishing returns per category (the 4th
     "otp_request" hit shouldn't be worth as much as the 1st) so repeating
     one phrase can't alone drive the score to 100.
  3. Add a multi-category escalation bonus — a real vishing call almost
     always combines authority impersonation + urgency + a request for
     money/credentials, so seeing several distinct categories together is
     itself a strong signal.
  4. Clamp to 0-100 and derive level/explanation/new_signals from it.
"""
import math
import re

from . import rules
from .patterns import PATTERNS
from ..models import RiskAssessment, level_for_score


def _contains(text: str, phrase: str) -> bool:
    """Whole-word/phrase match, so 'trai' doesn't fire inside 'train'."""
    return re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", text) is not None


def _diminishing(total_weight: int, hits: int) -> float:
    """Each extra hit in the same category counts for less."""
    if hits <= 0:
        return 0.0
    # First hit counts full weight on average, further hits decay.
    avg_weight = total_weight / hits
    return avg_weight * (1 + math.log(hits))


def _collect(texts: list[str]):
    """Match the phrase bank and the shape rules sentence by sentence. Warnings and advice are skipped.

    Returns (labels per category, evidence weights per category, all matched labels). A phrase and a rule
    that fire on the same sentence are the same evidence, so a category keeps one weight per sentence."""
    category_hits: dict[str, list[str]] = {}
    evidence: dict[str, dict[tuple[int, int], int]] = {}
    matched: list[str] = []

    def hit(category: str, label: str, weight: int, where: tuple[int, int]) -> None:
        if label not in category_hits.setdefault(category, []):
            category_hits[category].append(label)
            matched.append(label)
        slot = evidence.setdefault(category, {})
        slot[where] = max(slot.get(where, 0), weight)

    for ti, raw in enumerate(texts):
        for si, sentence in enumerate(rules.sentences(rules.normalise(raw))):
            if rules.WARNING.search(sentence):
                continue
            for p in PATTERNS:
                if _contains(sentence, p.phrase):
                    hit(p.category, p.phrase, p.weight, (ti, si))
            for category, label, weight, rx in rules.RULES:
                if rx.search(sentence):
                    hit(category, label, weight, (ti, si))
    weights = {c: sorted(v.values(), reverse=True) for c, v in evidence.items()}
    return category_hits, weights, matched


# Tactics that, next to a request for secrets or money, make the request far more likely to be a scam.
_PRETEXT = {"authority_impersonation", "kyc_scam", "account_block_threat", "courier_scam",
            "digital_arrest", "lottery_scam", "family_emergency", "remote_access",
            "advance_fee_scam", "wrong_transfer_scam"}


def score_turns(turns, previous_categories: set[str] | None = None) -> RiskAssessment:
    """Score a call from its transcript chunks. Only the caller's words are evidence: whatever the
    agent says (questions, repeating a code back, quoting a warning) is not a scam signal."""
    texts = [t.text for t in turns if getattr(getattr(t, "speaker", None), "value", getattr(t, "speaker", "")) != "agent"]
    return _score(texts, previous_categories)


def score_transcript(full_text: str, previous_categories: set[str] | None = None) -> RiskAssessment:
    return _score([full_text], previous_categories)


def _score(texts: list[str], previous_categories: set[str] | None) -> RiskAssessment:
    previous_categories = previous_categories or set()
    category_hits, weights_by_cat, matched_phrases = _collect(texts)

    if not category_hits:
        return RiskAssessment(
            score=0,
            level=level_for_score(0),
            matched_patterns=[],
            new_signals=[],
            explanation="No known scam-call patterns detected yet in this transcript.",
            recommended_action="Continue monitoring.",
            scorer="heuristic",
        )

    raw = 0.0
    for category in category_hits:
        ws = weights_by_cat[category]
        part = _diminishing(sum(ws), len(ws))
        # Asking for money with no other scam tactic around it is usually just talk about money.
        if category == "payment_request" and len(category_hits) == 1:
            part *= 0.6
        raw += part

    # Multi-category escalation: real vishing scripts stack tactics.
    distinct = len(category_hits)
    if distinct >= 2:
        raw *= 1 + 0.12 * (distinct - 1)

    # Asking for secrets or money while also claiming authority / threatening is the core scam shape.
    asks = {"otp_request", "payment_request"} & set(category_hits)
    pretext = _PRETEXT & set(category_hits)
    if asks and pretext:
        raw += 20
    elif asks and any(w >= 18 for w in weights_by_cat.get("urgency_pressure", [])):
        raw += 10  # a demand for money/secrets plus "tell no one" / "don't hang up" even with no official pretext

    score = max(0, min(100, round(raw)))
    level = level_for_score(score)

    # previous_categories holds previously matched labels; map them to categories.
    seen_categories = {p.category for p in PATTERNS if p.phrase in previous_categories}
    seen_categories |= {rules.RULE_CATEGORY[m] for m in previous_categories if m in rules.RULE_CATEGORY}
    new_categories = set(category_hits) - seen_categories
    new_signals = [f"New signal category detected: {c.replace('_', ' ')}" for c in sorted(new_categories)]

    explanation = _explain(category_hits, score)
    recommended_action = _recommend(level)

    return RiskAssessment(
        score=score,
        level=level,
        matched_patterns=sorted(set(matched_phrases)),
        new_signals=new_signals,
        explanation=explanation,
        recommended_action=recommended_action,
        scorer="heuristic",
    )


def _weight_of(category: str, phrase: str) -> int:
    for p in PATTERNS:
        if p.category == category and p.phrase == phrase:
            return p.weight
    return 10


def _explain(category_hits: dict[str, list[str]], score: int) -> str:
    cats = ", ".join(c.replace("_", " ") for c in sorted(category_hits))
    return (
        f"Detected signals consistent with: {cats}. "
        f"Combined pattern strength and category overlap put this call's risk at {score}/100."
    )


def _recommend(level) -> str:
    from ..models import RiskLevel
    return {
        RiskLevel.low: "Continue monitoring.",
        RiskLevel.medium: "Flag for review; advise the caller to verify independently before acting.",
        RiskLevel.high: "Surface a high-risk alert; recommend the agent/caller stop sharing information.",
        RiskLevel.critical: "Escalate immediately; recommend ending the call and verifying via an official channel.",
    }[level]

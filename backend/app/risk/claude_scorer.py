"""
Claude-backed scorer. Same output contract as heuristic.score_transcript so
the rest of the app can swap between them without caring which one ran.

If the API call fails or returns something we can't parse, the caller
(engine.py) is expected to fall back to the heuristic scorer rather than
crash the ingestion pipeline — a flaky network call should never take the
detector offline mid-call.
"""
import json

from anthropic import Anthropic

from ..config import settings
from ..models import RiskAssessment, level_for_score

SYSTEM_PROMPT = """You are the real-time risk-scoring engine inside Awaaz \
Shield, a financial fraud-call / vishing detection tool used in India. You \
are given the transcript of an in-progress phone call (caller and agent \
turns, possibly mixed English/Hindi/Hinglish) and must assess how likely it \
is that the caller is running a social-engineering scam (fake bank official, \
KYC-update scam, OTP/credential theft, courier or customs impersonation, \
"digital arrest" intimidation, account-blocking threats, remote-access-app \
requests, lottery/prize scams, or similar).

Respond with ONLY a JSON object, no prose before or after, no markdown \
fences, matching exactly this shape:
{
  "score": <integer 0-100, 0=no concern, 100=near-certain active scam>,
  "matched_patterns": [<short strings naming the specific tactics you saw>],
  "new_signals": [<short strings for anything newly concerning in the \
latest turns specifically, as opposed to earlier in the call>],
  "explanation": <one or two sentences, plain language, for a human \
operator skimming a dashboard>,
  "recommended_action": <one short sentence of what the operator should do \
next>
}

Calibrate conservatively: a single ambiguous phrase should not spike the \
score. Genuine bank/government calls do sometimes mention KYC or verification \
— what matters is the combination of authority claims, urgency, secrecy \
pressure, and requests for OTP/credentials/money/remote access. Score 0 and \
explain briefly if nothing concerning is present. This score is \
decision-support for a human operator, not an automatic fraud determination."""


def score_transcript(full_text: str) -> RiskAssessment:
    client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    response = client.messages.create(
        model=settings.ANTHROPIC_MODEL,
        max_tokens=600,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Transcript so far:\n\n{full_text}"}],
    )

    raw_text = "".join(block.text for block in response.content if block.type == "text").strip()
    # Defensive: strip accidental code fences even though the prompt forbids them.
    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.lower().startswith("json"):
            raw_text = raw_text[4:].strip()

    data = json.loads(raw_text)

    score = max(0, min(100, int(data["score"])))
    return RiskAssessment(
        score=score,
        level=level_for_score(score),
        matched_patterns=list(data.get("matched_patterns", [])),
        new_signals=list(data.get("new_signals", [])),
        explanation=str(data.get("explanation", "")),
        recommended_action=str(data.get("recommended_action", "")),
        scorer="claude",
    )

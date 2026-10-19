"""
Shared data shapes. These are the contract between the risk engine, the
call store, the REST routes, and the websocket broadcasts — keeping them
in one place means the heuristic and Claude scorers can be swapped freely
without the rest of the app noticing.
"""
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def _id() -> str:
    return uuid.uuid4().hex[:8]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RiskLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


def level_for_score(score: int) -> RiskLevel:
    from .config import settings  # local import: config must stay importable without the models

    medium, high, critical = settings.risk_thresholds
    if score >= critical:
        return RiskLevel.critical
    if score >= high:
        return RiskLevel.high
    if score >= medium:
        return RiskLevel.medium
    return RiskLevel.low


class EvaluateRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class Evaluation(BaseModel):
    """What the risk-evaluator chat returns. score/level are None when there is no evidence at all."""
    score: Optional[int] = None
    level: Optional[RiskLevel] = None
    basis: str  # "transcript" | "transcript+user_text" | "user_text" | "none"
    basis_note: str
    answer: str
    explanation: str = ""
    warning_signs: list[str] = Field(default_factory=list)
    recommended_steps: list[str] = Field(default_factory=list)
    transcript_lines: int = 0
    scorer: str = "heuristic"
    disclaimer: str


class CallStatus(str, Enum):
    active = "active"
    ended = "ended"


class Speaker(str, Enum):
    caller = "caller"
    agent = "agent"
    unknown = "unknown"


class TranscriptChunk(BaseModel):
    id: str = Field(default_factory=_id)
    speaker: Speaker = Speaker.unknown
    text: str
    ts: str = Field(default_factory=_now)


class Alert(BaseModel):
    signals: list[str] = Field(default_factory=list)  # scam tactics seen when the alert was raised
    id: str = Field(default_factory=_id)
    call_id: str
    level: RiskLevel
    message: str
    matched_patterns: list[str] = Field(default_factory=list)
    ts: str = Field(default_factory=_now)


class RiskPoint(BaseModel):
    ts: str = Field(default_factory=_now)
    score: int


class OperatorAction(BaseModel):
    id: str = Field(default_factory=_id)
    call_id: str
    type: str  # "flagged" | "escalated" | "dismissed" | "restored" | "note"
    note: str = ""
    by_uid: str = ""
    ts: str = Field(default_factory=_now)


class RiskAssessment(BaseModel):
    """Uniform output contract for BOTH the heuristic and Claude scorers."""
    score: int
    level: RiskLevel
    matched_patterns: list[str] = Field(default_factory=list)
    new_signals: list[str] = Field(default_factory=list)
    explanation: str
    recommended_action: str = ""
    scorer: str = "heuristic"  # "heuristic" | "claude"


class Call(BaseModel):
    id: str = Field(default_factory=_id)
    label: str = "Untitled call"
    source: str = "simulated"  # "simulated" | "microphone"
    status: CallStatus = CallStatus.active
    started_at: str = Field(default_factory=_now)
    ended_at: Optional[str] = None
    transcript: list[TranscriptChunk] = Field(default_factory=list)
    risk_history: list[RiskPoint] = Field(default_factory=list)
    alerts: list[Alert] = Field(default_factory=list)
    actions: list[OperatorAction] = Field(default_factory=list)
    current_score: int = 0
    current_level: RiskLevel = RiskLevel.low
    last_explanation: str = ""
    scorer: str = "heuristic"
    owner_uid: str = ""
    owner_email: str = ""
    disposition: Optional[str] = None  # last operator verdict: flagged | escalated | dismissed
    notice_given: bool = False  # phone calls: the "this call is analysed" notice was issued to both parties
    signals: list[str] = Field(default_factory=list)  # scam tactic categories seen so far (for linking similar calls)
    ended_reason: Optional[str] = None  # "auto_risk": Awaaz Shield cut the call because the score went too high
    ended_threshold: Optional[int] = None  # the limit that was crossed
    shared_with_operators: bool = False  # escalated: operators may see this call (set once, never cleared)


class CreateCallRequest(BaseModel):
    label: Optional[str] = None
    source: str = "simulated"


class IngestRequest(BaseModel):
    text: str
    speaker: Speaker = Speaker.caller


class ActionRequest(BaseModel):
    type: str
    note: str = ""


class AddPatternRequest(BaseModel):
    category: str
    phrase: str
    weight: int = 15
    language: str = "en"  # "en" | "hi"

"""
Centralized settings. Everything is read from the environment (via .env in
development) so no secret ever lives in source. Every integration is
optional — the app degrades to its offline/demo behavior when a value is
missing, and `status()` tells the frontend exactly what's live vs. stubbed
so the UI can say so honestly instead of silently pretending.
"""
import os
from dotenv import load_dotenv

load_dotenv()
try:
    import certifi
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except ImportError:
    pass

def _bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    APP_SECRET_KEY: str = os.getenv("APP_SECRET_KEY", "dev-secret-change-me")
    SESSION_COOKIE_NAME: str = os.getenv("SESSION_COOKIE_NAME", "awaaz_session")
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()
    ]

    FIREBASE_ENABLED: bool = _bool("FIREBASE_ENABLED", False)
    # Set false only for testing when verification emails are not arriving (not for production).
    REQUIRE_EMAIL_VERIFIED: bool = _bool("REQUIRE_EMAIL_VERIFIED", True)
    FIREBASE_SERVICE_ACCOUNT_PATH: str = os.getenv(
        "FIREBASE_SERVICE_ACCOUNT_PATH", "./firebase-service-account.json"
    )

    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")

    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")

    CONSENT_VERSION: str = os.getenv("CONSENT_VERSION", "2026-10-v1")
    CONSENT_LOG_PATH: str = os.getenv("CONSENT_LOG_PATH", "./data/consents.jsonl")
    DEEPGRAM_LANGUAGE: str = os.getenv("DEEPGRAM_LANGUAGE", "multi")
    DEEPGRAM_MODEL: str = os.getenv("DEEPGRAM_MODEL", "nova-3")
    # Words Deepgram should listen for harder (Nova-3 "keyterm prompting"): comma separated. Empty turns it off.
    DEEPGRAM_KEYTERMS: str = os.getenv(
        "DEEPGRAM_KEYTERMS",
        "OTP,KYC,UPI,UPI PIN,CVV,Aadhaar,PAN,RBI,SBI,HDFC,ICICI,Axis Bank,Kotak,Paytm,PhonePe,Google Pay,AnyDesk,TeamViewer,"
        "digital arrest,cyber crime,CBI,TRAI,safe account,customs,debit card,credit card,net banking,KBC,income tax",
    )
    DEEPGRAM_ENDPOINTING_MS: int = int(os.getenv("DEEPGRAM_ENDPOINTING_MS", "500"))  # silence that closes a phrase
    DEEPGRAM_URL: str = os.getenv("DEEPGRAM_URL", "wss://api.deepgram.com/v1/listen")

    # Risk bands: a score at or above each value is in that band (below RISK_MEDIUM_MIN is low).
    # Must be ascending integers within 1-100, otherwise the defaults below are used.
    RISK_MEDIUM_MIN: int = int(os.getenv("RISK_MEDIUM_MIN", "30"))
    RISK_HIGH_MIN: int = int(os.getenv("RISK_HIGH_MIN", "55"))
    RISK_CRITICAL_MIN: int = int(os.getenv("RISK_CRITICAL_MIN", "80"))

    # When true (recommended), a call is visible only to the person who started it and people who joined it.
    RESTRICT_CALL_ACCESS: bool = _bool("RESTRICT_CALL_ACCESS", True)
    # Cap on risk-evaluator questions per person per minute (protects Claude spend).
    EVALUATOR_RATE_PER_MINUTE: int = int(os.getenv("EVALUATOR_RATE_PER_MINUTE", "20"))

    # Dev-mode login (any email, no password) exists only so the app runs without Firebase on your own computer.
    # A public server must set ALLOW_DEV_LOGIN=false: then, without Firebase, nobody can sign in instead of everybody.
    ALLOW_DEV_LOGIN: bool = _bool("ALLOW_DEV_LOGIN", True)

    # Delete calls (and their transcripts) this many days after they end. 0 = keep until a person deletes them.
    RETENTION_DAYS: int = int(os.getenv("RETENTION_DAYS", "0"))

    # Session cookie. COOKIE_SECURE: "auto" (secure whenever the request arrived over https, also behind a proxy that
    # sends X-Forwarded-Proto), "true" or "false". COOKIE_SAMESITE: lax (default, same-site web/PWA), or none (needs https;
    # only for a separately hosted frontend such as an Android app that bundles the page).
    COOKIE_SECURE: str = os.getenv("COOKIE_SECURE", "auto").strip().lower()
    COOKIE_SAMESITE: str = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()
    # Folder holding the built frontend (frontend/dist). When it exists, the backend serves the web app too,
    # so one address covers the page, the API and the call sockets.
    FRONTEND_DIST: str = os.getenv("FRONTEND_DIST", "")

    # Firestore persistence (only active when Firebase itself is configured).
    FIRESTORE_ENABLED: bool = _bool("FIRESTORE_ENABLED", True)
    FIRESTORE_LOAD_LIMIT: int = int(os.getenv("FIRESTORE_LOAD_LIMIT", "50"))
    FIRESTORE_MASK_NUMBERS: bool = _bool("FIRESTORE_MASK_NUMBERS", True)

    @property
    def risk_thresholds(self) -> tuple[int, int, int]:
        """(medium, high, critical) minimum scores. Invalid configuration falls back to 30/55/80."""
        t = (self.RISK_MEDIUM_MIN, self.RISK_HIGH_MIN, self.RISK_CRITICAL_MIN)
        if all(isinstance(v, int) and 1 <= v <= 100 for v in t) and t[0] < t[1] < t[2]:
            return t
        return (30, 55, 80)

    @property
    def claude_configured(self) -> bool:
        return bool(self.ANTHROPIC_API_KEY)

    @property
    def firebase_configured(self) -> bool:
        return self.FIREBASE_ENABLED and os.path.exists(self.FIREBASE_SERVICE_ACCOUNT_PATH)

    @property
    def firestore_enabled(self) -> bool:
        return self.FIRESTORE_ENABLED and self.firebase_configured

    @property
    def deepgram_keyterms(self) -> list[str]:
        return [t.strip() for t in self.DEEPGRAM_KEYTERMS.split(",") if t.strip()]

    @property
    def deepgram_configured(self) -> bool:
        return bool(self.DEEPGRAM_API_KEY)

    def status(self) -> dict:
        """What's actually live right now, for the frontend to display honestly."""
        return {
            "scoring_backend": "claude" if self.claude_configured else "heuristic",
            "firebase_auth": self.firebase_configured,
            "email_verification_required": self.REQUIRE_EMAIL_VERIFIED,
            "deepgram_stt": self.deepgram_configured,
            "firestore_persistence": self.firestore_enabled,
            "dev_mode_auth": (not self.firebase_configured) and self.ALLOW_DEV_LOGIN,
            "risk_thresholds": dict(zip(("medium", "high", "critical"), self.risk_thresholds)),
            "call_access_restricted": self.RESTRICT_CALL_ACCESS,
            "retention_days": max(0, self.RETENTION_DAYS),
        }


settings = Settings()

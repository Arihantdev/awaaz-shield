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

    # Firestore persistence (only active when Firebase itself is configured).
    FIRESTORE_ENABLED: bool = _bool("FIRESTORE_ENABLED", True)
    FIRESTORE_LOAD_LIMIT: int = int(os.getenv("FIRESTORE_LOAD_LIMIT", "50"))
    FIRESTORE_MASK_NUMBERS: bool = _bool("FIRESTORE_MASK_NUMBERS", True)

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
            "dev_mode_auth": not self.firebase_configured,
        }


settings = Settings()

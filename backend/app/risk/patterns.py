"""
The scam pattern bank. Each entry is a (category, phrase, weight, language)
tuple. Weights are additive signal strength, not final scores — the engine
in heuristic.py turns matches into a 0-100 score with diminishing returns
and an escalation bonus for multiple categories firing together.

Phrases are matched as lowercase substrings against the running transcript,
so Hinglish entries are written the way they're actually typed/transcribed
(Roman script), not in Devanagari — that's what a live STT feed produces.

This bank is meant to be extended live during a demo via the /demo/patterns
endpoint, so `PATTERNS` is a plain mutable list, not a frozen constant.
"""
from dataclasses import dataclass, field


@dataclass
class Pattern:
    category: str
    phrase: str
    weight: int
    language: str = "en"


PATTERNS: list[Pattern] = [
    # --- Authority impersonation ---
    Pattern("authority_impersonation", "this is from the bank", 12, "en"),
    Pattern("authority_impersonation", "rbi", 18, "en"),
    Pattern("authority_impersonation", "reserve bank of india", 18, "en"),
    Pattern("authority_impersonation", "cyber crime department", 20, "en"),
    Pattern("authority_impersonation", "income tax department", 16, "en"),
    Pattern("authority_impersonation", "trai", 14, "en"),
    Pattern("authority_impersonation", "mujhe bank se bol raha hoon", 15, "hi"),
    Pattern("authority_impersonation", "police se bol raha hoon", 18, "hi"),

    # --- KYC-update scam ---
    Pattern("kyc_scam", "kyc update", 20, "en"),
    Pattern("kyc_scam", "kyc expire", 20, "en"),
    Pattern("kyc_scam", "kyc verification", 18, "en"),
    Pattern("kyc_scam", "aapka kyc", 20, "hi"),
    Pattern("kyc_scam", "kyc complete karna hai", 20, "hi"),
    Pattern("kyc_scam", "kyc pending hai", 18, "hi"),

    # --- Account-blocking threats ---
    Pattern("account_block_threat", "account will be blocked", 22, "en"),
    Pattern("account_block_threat", "account has been suspended", 18, "en"),
    Pattern("account_block_threat", "card will be blocked", 20, "en"),
    Pattern("account_block_threat", "account block ho jayega", 22, "hi"),
    Pattern("account_block_threat", "aapka account band", 20, "hi"),
    Pattern("account_block_threat", "24 ghante mein block", 20, "hi"),

    # --- OTP / credential theft ---
    Pattern("otp_request", "share the otp", 30, "en"),
    Pattern("otp_request", "tell me the otp", 30, "en"),
    Pattern("otp_request", "otp bata do", 30, "hi"),
    Pattern("otp_request", "otp batao", 30, "hi"),
    Pattern("otp_request", "cvv number", 28, "en"),
    Pattern("otp_request", "pin number batao", 28, "hi"),
    Pattern("otp_request", "enter your atm pin", 28, "en"),
    Pattern("otp_request", "card number aur expiry", 26, "hi"),

    # --- Remote access / app install ---
    Pattern("remote_access", "install anydesk", 26, "en"),
    Pattern("remote_access", "install teamviewer", 26, "en"),
    Pattern("remote_access", "download this app", 18, "en"),
    Pattern("remote_access", "screen share kar do", 24, "hi"),

    # --- Courier / customs impersonation ---
    Pattern("courier_scam", "customs department", 18, "en"),
    Pattern("courier_scam", "parcel has been seized", 20, "en"),
    Pattern("courier_scam", "illegal items in your parcel", 22, "en"),
    Pattern("courier_scam", "aapka parcel pakda gaya", 20, "hi"),
    Pattern("courier_scam", "courier mein drugs mile", 24, "hi"),
    Pattern("courier_scam", "fedex", 10, "en"),

    # --- "Digital arrest" / law-enforcement intimidation ---
    Pattern("digital_arrest", "digital arrest", 30, "en"),
    Pattern("digital_arrest", "you are under investigation", 22, "en"),
    Pattern("digital_arrest", "non-bailable warrant", 26, "en"),
    Pattern("digital_arrest", "aapke khilaaf warrant", 26, "hi"),
    Pattern("digital_arrest", "video call pe raho", 16, "hi"),

    # --- Urgency / isolation pressure ---
    Pattern("urgency_pressure", "act immediately", 14, "en"),
    Pattern("urgency_pressure", "do not disconnect the call", 18, "en"),
    Pattern("urgency_pressure", "don't tell anyone", 20, "en"),
    Pattern("urgency_pressure", "kisi ko mat batana", 20, "hi"),
    Pattern("urgency_pressure", "call mat kaato", 18, "hi"),
    Pattern("urgency_pressure", "last warning", 14, "en"),

    # --- Payment / transfer request ---
    Pattern("payment_request", "transfer the amount", 20, "en"),
    Pattern("payment_request", "pay the processing fee", 22, "en"),
    Pattern("payment_request", "google pay karo", 22, "hi"),
    Pattern("payment_request", "paisa bhejo", 20, "hi"),
    Pattern("payment_request", "refundable security deposit", 18, "en"),

    # --- Lottery / prize scam ---
    Pattern("lottery_scam", "you have won a lottery", 22, "en"),
    Pattern("lottery_scam", "congratulations you have won", 18, "en"),
    Pattern("lottery_scam", "aapka lottery laga hai", 22, "hi"),
    Pattern("lottery_scam", "claim your prize", 16, "en"),
]


def add_pattern(category: str, phrase: str, weight: int, language: str = "en") -> Pattern:
    p = Pattern(category=category, phrase=phrase.lower().strip(), weight=weight, language=language)
    PATTERNS.append(p)
    return p


def reset_to_defaults(defaults: list[Pattern]) -> None:
    PATTERNS.clear()
    PATTERNS.extend(defaults)


# Snapshot of the built-in bank, used by /demo/reset to undo anything added live.
DEFAULT_PATTERNS: list[Pattern] = list(PATTERNS)

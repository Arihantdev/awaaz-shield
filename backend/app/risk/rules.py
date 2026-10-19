"""
Pattern-based signal rules for the offline scorer.

The original phrase bank (patterns.py) only fires on exact wording. Real callers (and speech-to-text)
vary the wording, so these rules match the *shape* of a tactic instead: an ask-verb close to a
credential noun ("tell me the OTP", "please share the one time password"), a threat noun close to a
blocking verb ("your number will be disconnected"), and so on. Rules run per sentence on normalised text,
which is also how warnings ("we will never ask you to share the OTP") are recognised and ignored.

Each rule: (category, label, weight, regex). `label` is what is reported as the matched pattern and
`category` is the tactic shown in the UI, so labels are registered in RULE_CATEGORY for signals_for().
"""
import re

# ---------------------------------------------------------------- normalisation

_DEVANAGARI = {
    "ओटीपी": "otp", "केवाईसी": "kyc", "बैंक": "bank", "पुलिस": "police", "अकाउंट": "account",
    "ब्लॉक": "block", "अरेस्ट": "arrest", "पार्सल": "parcel", "बताइए": "batao", "बताओ": "batao",
    "बताएं": "batao", "सीबीआई": "cbi", "आधार": "aadhaar", "पिन": "pin", "सीवीवी": "cvv",
    "लॉटरी": "lottery", "इनाम": "prize", "वारंट": "warrant", "डिजिटल": "digital",
}
_SPACED = [  # speech-to-text often spells acronyms letter by letter
    (r"\bo\W?t\W?p\b", "otp"), (r"\bk\W?y\W?c\b", "kyc"), (r"\bc\W?v\W?v\b", "cvv"),
    (r"\bu\W?p\W?i\b", "upi"), (r"\bp\W?i\W?n\b", "pin"), (r"\bs\W?b\W?i\b", "sbi"),
    (r"\bh\W?d\W?f\W?c\b", "hdfc"), (r"\bi\W?c\W?i\W?c\W?i\b", "icici"), (r"\bt\W?r\W?a\W?i\b", "trai"),
    (r"\br\W?b\W?i\b", "rbi"), (r"\bc\W?b\W?i\b", "cbi")
]
_SPACED = [(re.compile(p), r) for p, r in _SPACED]


def normalise(text: str) -> str:
    t = text.lower().replace("’", "'").replace("‘", "'")
    for dev, rep in _DEVANAGARI.items():
        t = t.replace(dev, f" {rep} ")
    for rx, rep in _SPACED:
        t = rx.sub(rep, t)
    t = re.sub(r"[\"“”()\[\]]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?;])\s+|\n+", text)
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------- warnings

# A sentence like this is advice or a warning, not a demand: nothing in it counts.
WARNING = re.compile(
    r"\b(never|will not|won't|do not|don't|dont|should not|shouldn't|nahi|kabhi nahi)\s+(ever\s+)?"
    r"(ask|asks|share|give|disclose|reveal|bata\w*|maang\w*|puch\w*)\b[^.]{0,40}?\b"
    r"(otp|pin|cvv|password|code|details|card|anyone|anybody|kisi|even)\b"
    r"|\b(beware|be careful|be alert|awareness|scammers?|fraudsters?|stay safe|safety tip|remember we)\b"
    r"|\bnever (share|give|disclose|reveal|ask)\b"
    r"|\bwill ever (ask|call|request|demand)\b|\bpretend\w* to be\b|\breport (it|this|such)\b.{0,20}\b(on|at|to)\b|\b(1930|one nine three zero)\b",
)

# ---------------------------------------------------------------- rules

_ASK = r"(?:share|sharing|tell|telling|give|giving|send|sending|read|provide|providing|say|enter|entering|type|forward|daal\w*|dalo|fill|submit|bata\w*|batao|batana|dijiye|de\s?do|de\s?dijiye|bol\w*)"
_CRED = (
    r"(?:otp|one[- ]time[- ]password|verification code|security code|"
    r"(?:\d+|four|five|six|seven|eight|nine|ten)[ -]digit (?:code|number|pin)|"
    r"code (?:that )?(?:you )?(?:just )?(?:received|got|came|has come)|code\s+(?:aayega|aaya|aaye|ayega|aata)|"
    r"6 digit|pass ?code)"
)
_CARD = (
    r"(?:cvv|card number|expiry(?: date)?|atm pin|debit card pin|upi pin|mpin|m-pin|"
    r"net ?banking (?:password|id|login)|internet banking|login password|aadhaar number|pan number|"
    r"card details|bank details|bank account details|account number|password)"
)
_THREAT_NOUN = r"(?:account|card|sim|number|connection|wallet|service|policy|pan|fastag|visa|passport|licence|license)"
_THREAT_VERB = r"(?:blocked|suspended|disconnected|deactivated|frozen|freeze|restricted|cut|terminated|closed|barred|cancelled|canceled|deleted)"
_AGENCY = (
    r"(?:bank|sbi|hdfc|icici|axis|kotak|pnb|paytm|phonepe|trai|customs|cbi|police|crime branch|cyber ?crime|"
    r"income tax|electricity board|customer care|narcotics|dhl|fedex|rbi|reserve bank|insurance|"
    r"telecom|department|ministry|court|enforcement directorate)"
)

RULES: list[tuple[str, str, int, re.Pattern]] = []


def _r(category: str, label: str, weight: int, pattern: str) -> None:
    RULES.append((category, label, weight, re.compile(pattern)))


# OTP / credential theft
_r("otp_request", "asks for an OTP / code", 30, rf"\b{_ASK}\b.{{0,45}}\b{_CRED}\b")
_r("otp_request", "asks for an OTP / code", 30, rf"\b{_CRED}\b.{{0,30}}\b(?:bata\w*|batao|batana|share|tell me|read out|read it|give me|send me|dijiye)\b")
_r("otp_request", "asks for card / PIN / password", 28, rf"\b{_ASK}\b.{{0,45}}\b{_CARD}\b")
_r("otp_request", "asks for card / PIN / password", 28, rf"\b{_CARD}\b.{{0,40}}\b(?:bata\w*|batao|batana|dijiye|share|tell me|read out)\b")

# Fear of losing the account / service
_r("account_block_threat", "threatens to block or disconnect", 22,
   rf"\b{_THREAT_NOUN}\b.{{0,40}}\b(?:will be|would be|gets|get|is being|being|going to be|is going to be|is getting)\b.{{0,15}}\b{_THREAT_VERB}\b")
_r("account_block_threat", "threatens to block or disconnect", 20, r"\b(?:block|band|bandh|suspend|freeze|disconnect)\s*(?:ho\s*(?:jayega|jaayega|jaega|jayegi|sakta)|hone\s*wala|kar\s*(?:denge|dunga|diya jayega))\b")
_r("account_block_threat", "threatens to block or disconnect", 18, rf"\b{_THREAT_VERB}\b.{{0,25}}\b(?:within|in) (?:\w+ )?(?:hours?|minutes?|24)\b")

# KYC pretext
_r("kyc_scam", "KYC pretext", 20,
   r"\bkyc\b.{0,30}\b(?:pending|expire\w*|incomplete|updat\w+|verif\w+|not done|suspend\w*|complete\w*|karna|karo)\b")
_r("kyc_scam", "KYC pretext", 20, r"\b(?:updat\w+|complet\w+|verify|expiring|expired)\b.{0,20}\bkyc\b")

# Pretending to be someone official
_r("authority_impersonation", "claims to be bank / agency staff", 12,
   rf"\b(?:calling|speaking|this is|i am|i'm|main|mai|hum)\b.{{0,50}}\b(?:from|at|se|of)\b.{{0,25}}\b{_AGENCY}\b")
_r("authority_impersonation", "claims to be bank / agency staff", 15, r"\b(?:bank|police|cbi|trai|rbi|customs|income tax)\s+se\s+(?:bol|baat|call)\w*")
_r("authority_impersonation", "names a government agency", 16,
   r"\b(?:crime branch|cyber ?crime|cbi|narcotics|enforcement directorate|income tax department|trai|rbi|reserve bank of india|supreme court)\b")
_r("authority_impersonation", "officer-style authority claim", 14,
   r"\b(?:inspector|sub[- ]inspector|constable|officer|commissioner)\b.{0,70}\b(?:case|warrant|arrest|against you|laundering|complaint on your|your name)\b")

# Law-enforcement intimidation
_r("digital_arrest", "digital arrest / video-call confinement", 30, r"\b(?:digital|virtual) arrest\b|\bhouse arrest\b")
_r("digital_arrest", "stay-on-video-call demand", 16, r"\b(?:stay|remain|raho|rehna)\b.{0,15}\bvideo call\b|\bvideo call\b.{0,20}\b(?:stay|raho|rehna|connect)\b|\bconnect\b.{0,20}\bvideo call\b")
_r("digital_arrest", "warrant or arrest threat", 26,
   r"\b(?:non[- ]bailable warrant|arrest warrant|warrant (?:in|against|has been)|warrant\b.{0,15}\byour name|(?:will|are going to|shall) be arrested|you are (?:under )?arrest|aapke khilaaf)\b")
_r("digital_arrest", "case / investigation threat", 22,
   r"\b(?:case (?:has been )?(?:registered |filed )?against you|under investigation|money laundering|involved in (?:illegal|a crime|criminal)|illegal (?:activity|activities|transactions?))\b")
_r("digital_arrest", "drugs / contraband claim", 16, r"\b(?:drugs?|narcotics|mdma|contraband|passports? and)\b")

# Courier / customs
_r("courier_scam", "parcel seized or illegal", 22,
   r"\b(?:parcel|package|courier|consignment|shipment)\b.{0,50}\b(?:seized|intercepted|held|detained|stopped|withheld|stuck|confiscated|pakda|illegal|drugs?|contraband|mdma|blocked)\b")
_r("courier_scam", "customs department claim", 18, r"\bcustoms (?:department|officer|duty|clearance)\b|\bcustoms\b.{0,20}\b(?:stopped|held|seized|detained|withheld)\b")
_r("courier_scam", "parcel in your name", 16, r"\bnaam par\b.{0,25}\b(?:parcel|courier)\b")

# Pressure and secrecy
_r("urgency_pressure", "secrecy demand", 20, r"\b(?:do not|don't|dont|never)\s+(?:tell|inform|discuss|mention)\b.{0,15}\b(?:anyone|anybody|family|mummy|papa|mom|dad|others|police)\b|\bkisi ko (?:mat|nahi) bata\w*|\bmat batana\b")
_r("urgency_pressure", "do-not-hang-up demand", 18, r"\b(?:do not|don't|dont)\s+(?:disconnect|cut|hang up|end)\b.{0,10}\bcall\b|\bcall mat kaat\w*|\bstay on (?:the )?(?:call|line)\b|\bdisconnect mat\b")
_r("urgency_pressure", "urgency wording", 8,
   r"\b(?:immediately|right now|urgent\w*|within (?:the next )?(?:\w+ )?(?:hours?|minutes?)|today itself|tonight|last warning|abhi|turant|jaldi|act now)\b")

# Money
_r("payment_request", "asks to transfer / pay money", 20,
   r"\b(?:transfer|send|pay|deposit|remit)\b.{0,40}\b(?:the amount|amount|money|savings|funds|fee|charges?|penalty|deposit|rupees|rs\.?|lakh|thousand|crore|payment)\b")
_r("payment_request", "safe-account transfer", 30, r"\b(?:safe|secure|verification|rbi|government|holding) account\b")
_r("payment_request", "upfront fee demand", 24, r"\b(?:registration|processing|gst|clearance|release|customs|insurance|activation|verification|bail) (?:fee|fees|charges?|tax|amount)\b")
_r("payment_request", "refund / cashback via UPI", 24,
   r"\b(?:refund|cashback|reward)\b.{0,70}\b(?:upi|google ?pay|gpay|phonepe|paytm|pin|link)\b|\benter (?:your )?upi\b")
_r("payment_request", "asks for money urgently (family-emergency style)", 22,
   r"\b(?:send|transfer)\b.{0,20}\b(?:money|amount|paisa|paise)\b.{0,25}\b(?:urgent\w*|immediately|right now|abhi)\b")
_r("payment_request", "asks to send money (Hinglish)", 20, r"\b(?:paisa|paise|amount|rupaye)\s+(?:bhej|transfer|de)\w*")

# Prize / lottery
_r("lottery_scam", "claims you won a prize", 22, r"\b(?:you have|you've|you are|you were|aapne)\s+(?:just\s+)?(?:won|selected|chosen)\b|\blucky (?:draw|winner)\b|\bkbc\b|\blottery\b")
_r("lottery_scam", "prize claim", 16, r"\bclaim (?:your|the) (?:prize|amount|reward|gift|cashback)\b|\bcongratulations\b")

# Remote access / links
_r("remote_access", "asks to install remote-control app", 26,
   r"\b(?:install|download|open|use|start)\b.{0,30}\b(?:anydesk|any desk|teamviewer|team viewer|quick ?support|rustdesk|ammyy|airdroid|screen ?share|remote)\b")
_r("remote_access", "asks to install an app / update", 18, r"\b(?:install|download)\b.{0,25}\b(?:this|the|our|an?)\s*(?:app|apk|update|software|application)\b|\binstall the update\b")
_r("remote_access", "asks to click a link", 16, r"\b(?:click|tap|open)\b.{0,15}\b(?:link|url)\b|\blink\b.{0,25}\b(?:sending|sent|whatsapp)\b|\bwhatsapp\b.{0,20}\blink\b|\blink\b.{0,25}\b(?:bhej\w*|send\w*)\b")

# Relative-in-trouble impersonation
_r("family_emergency", "relative-in-trouble pretext", 22,
   r"\b(?:i am|i'm|main|mai)\b.{0,15}\b(?:in (?:big |deep |serious |a lot of )?trouble|in an accident|had an accident|in hospital|in jail|arrested)\b|\b(?:had|met with) an accident\b")

# ---- additions after the REALISTIC eval set (STT-style calls, new scam families) ----
_r("account_block_threat", "claims it has already been blocked", 18,
   rf"\b{_THREAT_NOUN}\b.{{0,25}}\bhas been (?:blocked|suspended|deactivated|frozen)\b.{{0,30}}\b(?:due to|because|as)\b")
_r("account_block_threat", "penalty threat", 16, r"\bpenalty\b.{0,30}\b(?:charged|imposed|levied|will be)\b")
_r("account_block_threat", "suspicious-transaction pretext", 14, r"\bsuspicious (?:transaction|activity|login)s?\b")
_r("kyc_scam", "KYC pretext", 20, r"\bpending kyc\b|\bkyc (?:is )?(?:due|lapsed|not updated)\b.{0,40}\b(?:block|suspend|restrict|penalty|link|immediately|today)\w*")
_r("authority_impersonation", "claims to be a bank manager / officer", 12, r"\b(?:bank|branch) (?:manager|officer|executive)\b")
_r("authority_impersonation", "claims a reward programme of a bank", 10, r"\b(?:sbi|hdfc|icici|axis|kotak|pnb)\s+(?:rewards?|cashback|offers?)\b")

# Advance-fee scams: jobs/tasks, investments, loans, gifts. Money first, "returns" later.
_r("advance_fee_scam", "job / task-for-money pretext", 22,
   r"\b(?:part[- ]time|work from home|online) (?:job|work)\b|\bper task\b|\bearn\b.{0,30}\b(?:per (?:task|day|video|like)|daily)\b|\blike (?:youtube )?videos\b")
_r("advance_fee_scam", "guaranteed returns / no risk", 26,
   r"\bguaranteed (?:returns?|profit|income)\b|\b(?:\d+|\w+) percent (?:per|a|every) (?:month|week|day)\b|\bno risk\b|\b(?:hundred|100) percent (?:safe|sure|guaranteed)\b|\bdouble your (?:money|investment)\b")
_r("advance_fee_scam", "pay-first-get-money-later", 24,
   r"\b(?:fee|charges?|deposit|payment|jama)\b.{0,40}\b(?:pehle|first|before)\b|\b(?:pehle|first)\b.{0,20}\b(?:fee|charges?|deposit|payment|jama)\b|\bsecurity deposit\b")
_r("advance_fee_scam", "returned later with commission / profit", 18,
   r"\b(?:returned|refunded|refundable|wapas)\b.{0,30}\b(?:commission|profit|interest|returns|after|baad)\b")
_r("advance_fee_scam", "loan approved, fee needed", 20,
   r"\bloan\b.{0,30}\b(?:approv\w+|sanction\w*|mil\s*jayega|passed)\b")
_r("advance_fee_scam", "send money into a trading / merchant account", 18, r"\b(?:trading|merchant|demat|investment) account\b")
_r("payment_request", "asks to pay fee / deposit (Hinglish)", 20, r"\b(?:fee|charges|deposit|amount|paisa|paise)\s+(?:jama|bhej|transfer|de)\w*|\bjama\s+kar\w*")
_r("payment_request", "asks to send money back", 22,
   r"\b(?:send|return|transfer|give|refund|wapas)\b.{0,15}\b(?:it|the money|money|the amount|amount|paisa|paise)?\s*\bback\b|\bwapas\s+(?:bhej|kar|de)\w*")

_r("wrong_transfer_scam", "claims money was sent to you by mistake", 22,
   r"\b(?:mistakenly|by mistake|wrongly|galti se)\b.{0,40}\b(?:sent|transferred|paid|credited|bhej\w*|chala gaya)\b|\bwrong (?:transfer|number|payment)\b.{0,30}\b(?:return|back|wapas)\b")

_r("remote_access", "sends an APK / app file", 22, r"\bapk\b|\b(?:\w+ )?\.apk\b")
_r("lottery_scam", "reward points about to expire", 18, r"\breward points?\b.{0,60}\b(?:expire\w*|redeem|worth|lapse\w*)\b")

# ---- additions after the REALISTIC2 run (unseen calls exposed these gaps) ----
_r("account_block_threat", "login with credentials demand", 28,
   rf"\blog ?in\b.{{0,20}}\b(?:with|using)\b.{{0,25}}\b{_CARD}\b")
_r("kyc_scam", "government-scheme pretext", 18,
   r"\b(?:pm kisan|kisht|subsidy|scholarship|pension|ration card|aadhaar link)\b.{0,70}\b(?:ruk\w*|stopped|pending|blocked|link|nahi hai|not linked)\b")
_r("family_emergency", "relative hurt or in custody (third person)", 24,
   r"\b(?:your|aapka|aapke)\s+(?:son|daughter|husband|wife|brother|sister|father|mother|beta|beti|papa|mummy|nephew|relative)\b.{0,60}\b(?:accident|hospital|arrested|custody|kidnap\w*|critical|serious)\b")
_r("payment_request", "medical / bail payment demand", 20,
   r"\b(?:deposit|pay|send|transfer)\b.{0,50}\b(?:operation|surgery|treatment|bail)\b|\b(?:operation|surgery|bail)\b.{0,40}\b(?:deposit|pay|send|transfer)\b")
_r("payment_request", "asks for gift cards / vouchers", 28,
   r"\b(?:buy|purchase|get|send|read|share|give)\b.{0,30}\b(?:gift|google play|itunes|steam|amazon pay) (?:cards?|vouchers?|codes?)\b|\bgift cards?\b.{0,30}\b(?:codes?|numbers?)\b")
_r("authority_impersonation", "claims to be a company's security / support team", 14,
   r"\bthis is\b.{0,15}\b(?:amazon|flipkart|microsoft|google|apple|netflix|paytm|phonepe)\b.{0,15}\b(?:security|support|customer care|fraud|helpdesk|team)\b")
_r("account_block_threat", "alleges a hacked / unauthorised order", 16,
   r"\b(?:hacked|fraudulent|unauthori[sz]ed|fake) (?:order|transaction|purchase|login|account|documents?)\b")
_r("urgency_pressure", "do-not-hang-up demand", 18, r"\b(?:do not|don't|dont) hang up\b")
_r("digital_arrest", "case-registration threat", 22, r"\bcase (?:will be|shall be|would be|gets)\s+(?:registered|filed)\b|\btaken into custody\b|\bno lawyer\b")
_r("lottery_scam", "free-offer pretext", 18, r"\bfree (?:recharge|gift|data|laptop|mobile|ration)\b")
_r("advance_fee_scam", "romance / gift-from-abroad pretext", 18, r"\bsaw your profile\b.{0,100}\b(?:gift|parcel|money|invest\w*|send)\b")


RULE_CATEGORY: dict[str, str] = {label: cat for cat, label, _w, _rx in RULES}

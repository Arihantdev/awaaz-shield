# Speakerphone test: two voices on one microphone

Goal: check transcript accuracy and speaker separation with the new Deepgram settings.

## Setup
1. `npm run dev`, open http://localhost:5173, sign in, start a call.
2. Pick the microphone, tick **Two voices on this audio**, set language (try **auto** first, then **English India** for script A).
3. Press **Start streaming**. **The agent must speak first**: the first voice heard is labelled agent.
4. Two people if possible (one reads AGENT lines, one reads CALLER lines). Alone, change your voice/pitch and pause 1 s between speakers.
5. If roles come out reversed, press **Swap** (it only affects later lines).
6. Speak at normal pace, about 50 cm from the laptop mic, in a quiet room first. Repeat once with a fan/TV on.

## Script A: English (expect critical)
AGENT: Hello, this is the fraud department of State Bank. Am I speaking with Mr. Sharma?
CALLER: Yes, speaking.
AGENT: Sir, we detected a suspicious transaction on your debit card. Your account will be blocked in thirty minutes.
CALLER: Oh no, what should I do?
AGENT: For KYC verification, please share the OTP that you will receive on your phone right now.
CALLER: I got a code, it is four eight two nine one six.
AGENT: Thank you. Also install AnyDesk so our officer can secure your account, and do not tell anyone.

## Script B: Hinglish (expect high or critical)
AGENT: Namaste sir, main RBI office se bol raha hoon. Aapke Aadhaar se ek illegal parcel pakda gaya hai.
CALLER: Kya? Mera koi parcel nahi hai.
AGENT: Sir, yeh cyber crime ka case hai. Aapko abhi digital arrest mein rehna hoga, kisi ko call mat kijiye.
CALLER: Main kya karun?
AGENT: Apne paise safe account mein transfer kijiye, aur UPI PIN bata dijiye verification ke liye.

## Script C: Normal call (expect low, no alert)
AGENT: Good afternoon, this is HDFC Bank customer care. Your new debit card has been dispatched.
CALLER: Okay, when will it reach?
AGENT: Within five working days. Please never share your OTP or PIN with anyone, including us.
CALLER: Understood, thank you.

## What to record
Copy the dashboard transcript and fill one row per wrong line:

| Script | Spoken (what was said) | Transcript (what app showed) | Language (En/Hi/Hinglish) | Speaker label right? | Quiet / noisy |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Also note: final risk score and level per script, the line where the alert fired (score >= 55), whether Swap was needed,
and whether any phrase was cut mid-sentence (then try DEEPGRAM_ENDPOINTING_MS=700 in backend/.env).

## How to use the results
- Names/terms misheard (OTP, KYC, bank names): add them to DEEPGRAM_KEYTERMS.
- Hindi words mangled: compare language = auto vs English India vs Hindi.
- Good wrong-vs-right lines can become cases in backend/eval/risk_cases.py.

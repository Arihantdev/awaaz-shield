# Awaaz Shield

A local prototype that turns speech into a live transcript and scores it for financial-scam signals, such as fake bank staff, KYC threats, OTP theft, courier impersonation, and digital-arrest intimidation.

Risk scores support a decision; they do not prove fraud.

## Quick start (one command)

Requirements: Node.js 18+ and Python 3.10+.

```bash
npm install      # first time only: installs the launcher and the frontend dependencies
npm run dev      # starts the FastAPI backend and the React frontend together
```

Then open **http://localhost:5173**. The backend runs at http://127.0.0.1:8000 (API docs at `/docs`, live status at `/api/status`, WebSocket at `/ws/dashboard`). Sign in with any email in local development mode.

`npm run dev` first runs a preflight (`scripts/setup.mjs`) that:

- creates `backend/.env` and `frontend/.env.local` from the safe `.example` files if they are missing (existing files are never overwritten),
- creates `backend/.venv` and installs `backend/requirements.txt` when needed,
- installs any missing frontend packages,
- stops with a clear message if port 8000 or 5173 is already in use, or if Firebase is enabled but its key file is missing.

Press **Ctrl+C once** to stop both servers. If either server exits or crashes, the other is stopped too and the log line shows which one failed (`[api]` or `[web]`). It works on macOS, Linux and Windows; the older `start.sh` / `start.bat` launchers still work.

Other commands: `npm run setup` (preflight only), `npm run build` (production frontend build), `npm test` (backend scripts + frontend unit tests).

Custom ports: `BACKEND_PORT=8001 FRONTEND_PORT=5174 npm run dev`, then add `http://localhost:5174` to `CORS_ORIGINS` in `backend/.env`. Set `VITE_HOST=true` to expose the dev server on your network.

## Using it

Press **Start monitoring**, then use the microphone (Chrome or Edge) or type the lines a caller says. Each line is scored 0-100 with the scam tactics it matched. Demo calls are labelled as such; no phone line is connected.

## Live call audio (Deepgram), e.g. a WhatsApp call

Put your key in `backend/.env` (`DEEPGRAM_API_KEY=...`) and restart `npm run dev`. The key stays on the server.
Open an active call and use **Live call audio** under the message box: pick a source and press **Start streaming**.

- **Speakerphone:** source "Audio input", default device. The laptop mic hears the caller.
- **Cleaner (WhatsApp Desktop on a Mac):** install the free BlackHole 2ch driver, then in *Audio MIDI Setup* make a
  *Multi-Output Device* (your speakers + BlackHole) and set it as the system output while on the call. In the app
  choose "BlackHole 2ch" as the audio input. You hear the call as normal and the app hears the caller directly.
  On Windows use VB-Cable the same way.
- **Browser tab audio:** pick a Chrome tab and tick "Share tab audio" (works for calls that run in a browser tab).

Only the caller's voice reaches the app in the cable setup, so lines are labelled "Caller" (use the speaker menu to
change it). Get consent before recording or transcribing anyone. `test_stt.py` tests the relay against a stand-in
for Deepgram; real accuracy depends on your key, model (`DEEPGRAM_MODEL`) and language (`DEEPGRAM_LANGUAGE`).

## In-app voice calls (two people, Awaaz Shield in the middle)

Open **Voice call** in the side menu (or go to `/call`). One person taps **Start a call** and gets a 6-character code; the other opens the app on their own device, taps **Join a call** and enters it (or opens the invite link). Both must read and accept the notice that the call is relayed and checked for scams. Until **both** have accepted, the server neither relays nor transcribes any audio.

How it works: each browser sends its microphone to the backend as 16 kHz 16-bit PCM over `/ws/voice/{code}`. The backend forwards each side to the other and streams each side to its own Deepgram connection, so every phrase becomes a transcript line (the person who started the call is the "caller", the person who joined is the "agent") and is scored like every other call. The person who joined sees a warning on screen if the call turns high-risk. The operator dashboard shows the call live. Needs `DEEPGRAM_API_KEY` for transcripts; without it the call still works but is not transcribed (the screen says so).

This is a call between two people who both use Awaaz Shield. It is **not** a way to intercept an ordinary phone call or a call to a phone number: that needs a telephone provider and an Indian business registration, which this project does not have.

### Two phones (or phone + laptop)

A microphone only works on `https://` pages or `localhost`, so a phone cannot use `http://192.168...`. The simplest fix is one https tunnel to the dev server, which also forwards the API and the call audio to the backend:

```
npm run dev:share                      # backend + frontend, exposed on your network, API routed through the frontend
cloudflared tunnel --url http://localhost:5173     # or: ngrok http 5173
```

Open the `https://....` address the tunnel prints on both devices, sign in on each (use two different accounts, or the same account on two devices) and start / join a call. In `dev:share` mode the browser talks only to that one address, so no CORS or cookie settings need changing. Use headphones, otherwise the speaker is heard by the microphone.

Tested here: the server side (`backend/test_voice.py`) and the audio maths (`frontend/src/lib/pcm.test.js`). **Not tested yet on real hardware:** microphone capture, playback and call quality on a phone, the tunnel steps above, and Deepgram accuracy on live speech. Also not handled yet: reconnecting a dropped call (a dropped person has to join again with the code) and more than two people.

## Current scope

The prototype includes live dashboard updates, browser microphone transcription, heuristic English/Hindi/Hinglish scoring, optional Claude scoring, optional Firebase authentication and Firestore persistence.

This archive contains no carrier integration: no Twilio, Exotel or other telephone provider is implemented or configured, and no provider capabilities are claimed. Calls between two people who both use the app (see above) are the supported way to feed a live call into the scorer, alongside the microphone, a virtual audio cable and a browser tab.

## Configuration

`backend/.env.example` and `frontend/.env.example` are safe templates. Add only the optional credentials you use; never add credentials to the repository or a shared ZIP. Firebase web config (`VITE_FIREBASE_*`) is public client configuration; secrets such as the service-account JSON stay in `backend/` only.

More detail is in [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

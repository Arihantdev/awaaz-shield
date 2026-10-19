# Awaaz Shield — Frontend

React + Vite live-monitoring dashboard.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:5173. Make sure the backend is running at
http://localhost:8000 first (see `backend/README.md`) — with no `.env.local`
changes, login uses the backend's dev-mode path, so you can get the whole
dashboard running before touching Firebase at all.

## Wiring up real Firebase login

1. Finish step 2 in `backend/README.md` first (enable Email/Password auth,
   drop the service-account JSON, set `FIREBASE_ENABLED=true`).
2. In the Firebase console: Project settings > General > Your apps >
   **Add app > Web**. Copy the config object it gives you.
3. Fill in `.env.local`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
4. Restart `npm run dev`. The Login page automatically switches from the
   dev-mode box to real Firebase email/password sign-in, registration
   (with an email-verification step), and password reset, as soon as
   both the frontend config above AND the backend's `FIREBASE_ENABLED`
   are true — see the `useRealAuth` check in `src/pages/Login.jsx`.

## How a demo call flows, end to end

1. `DemoControls` → `POST /api/calls` creates a call.
2. Typing a line (or using the mic button) → `POST /api/calls/:id/ingest`
   → backend scores it → broadcasts `call_updated` (and `alert` if the
   score crosses "high") over `/ws/dashboard`.
3. `Dashboard.jsx` is subscribed to that socket and re-renders the call
   list, risk sparkline, and alert feed live — no polling.

## Project layout

```
src/
  firebase.js        guarded Firebase client init (no-ops if unconfigured)
  api.js               REST calls to the backend (cookie-based session)
  ws.js                  dashboard websocket client with auto-reconnect
  context/AuthContext.jsx  tracks the BACKEND session, not just Firebase state
  pages/
    Login.jsx          real Firebase auth OR dev-mode login, picked automatically
    Dashboard.jsx         wires everything together
  components/
    TopBar.jsx          brand, live analytics strip, connection dot, logout
    CallList.jsx          sidebar of monitored calls
    CallDetailPanel.jsx     transcript, risk timeline, alerts, operator actions
    RiskBadge.jsx / RiskSparkline.jsx    shared risk-display pieces
    MicCapture.jsx          browser SpeechRecognition mic input
    DemoControls.jsx          new call / reset demo / add a pattern live
```

## Honest limitation: microphone input

`MicCapture.jsx` uses the browser's built-in `SpeechRecognition` (Chrome/
Edge only) — it works today with no setup, but it is **not** Deepgram.
Real-time Deepgram streaming needs the audio proxied through the backend
so the API key never reaches the browser; see `backend/README.md`
"Where to go from here" for the concrete plan before claiming Deepgram
support in a demo pitch.

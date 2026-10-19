# Testing report: mobile, evaluator chat and deployment work

Date: 2026-10-19. Branch: `mobile-app`. This lists what was actually run and what was not. Nothing here is marked as passed unless it was run.

## Passed (run in a Linux sandbox, not on a Mac)

**Backend scripts (Python 3.10, fresh virtualenv, Firebase off): 7 of 7 pass**

| Script | Covers |
|---|---|
| `smoke_test.py` | login, calls, scoring, alerts, operator actions, restore, reset |
| `test_persistence.py` | Firestore writer, 12 threads sharing one Firebase client |
| `test_stt.py` | Deepgram relay against a stand-in server: speaker separation, swap, keyterms, language, phrase timing |
| `test_voice.py` | two-person in-app call, consent, audio forwarding |
| `test_evaluator.py` (new) | evaluator answers and basis labels, no score without evidence, negation, the call is never changed, configurable bands, who can see which call (two users), dashboard socket filtering, rate limit |
| `test_delete.py` (new) | delete one call (owner only, 404/403/409), delete all of my ended calls, active calls kept, other people's calls untouched, saved Firestore copy removed after queued saves, a failed delete leaves the call in place (503), live `call_deleted` event only to people who could see it, retention purge |
| `test_deploy.py` (new) | cookie flags behind https, SameSite fallback, dev login switch, security headers, serving the web app, `/api` 404s, path traversal |
| `eval_risk.py` | scorer accuracy: same results as in the Final Report (16/16, 8/8, 5/5 scams alerted, 0 false alerts on the labelled sets) |

**Frontend:** production build succeeds; 33 of 33 unit tests pass.

**Browser run (headless Chromium, the real backend serving the built app on one port):** 28 checks pass at desktop (1280 px) and phone (390 px, iPhone user agent): sign in and consent; sample calls; evaluator chat answers with its basis and disclaimer; the answer opens at its top; History and Settings; no sideways scrolling; 16 px inputs and 44 px buttons on the phone; no console errors; manifest, iPhone splash image, service worker and security headers served; session cookie is HttpOnly, SameSite=Lax and persistent; iPhone install steps shown.

**Delete controls in the browser (10 more checks, desktop):** delete one call from History, delete all my ended calls (a call still in progress is kept and the server agrees), Settings delete-all with its confirmation and message, deleting from the call panel removes it from the list live, no page errors. Checked at 390 px by screenshot only.

**Android project:** generated with Capacitor 8.5.3. `cap sync` verified in both modes (deployed-address mode and bundled mode), and an `http://` address is refused. The manifest, strings and launcher background parse as valid XML.

## NOT verified

| Not tested | Why it matters |
|---|---|
| **Building the APK** | No JDK or Android SDK in the sandbox. Run `npm run android:apk` after installing Android Studio (MOBILE.md). |
| **Running on a real Android phone** | microphone permission prompt inside the app, call audio, screen-awake behavior. |
| **Running on a real iPhone** | Add to Home Screen, launch screen, microphone inside the installed app, wake lock. Only the page code and tags were checked, with an iPhone user agent in Chromium. |
| **Docker image / Render deployment** | Docker is not available in the sandbox, so the Dockerfile and `render.yaml` were never built or run. The same behavior was tested by running the backend directly with the built web app. Whether Render passes `VITE_FIREBASE_*` as build arguments is unconfirmed. |
| **Real Firebase sign-in, verification email, Firestore** | needs your Firebase project (and the authorized-domain step in DEPLOYMENT.md). |
| **Live Deepgram speech-to-text** | the sandbox has no key. The relay was tested against a stand-in server only. Accuracy of the new keyterm/language settings still needs your speakerphone test (SPEAKERPHONE_TEST.md). |
| **Claude-worded evaluator answers** | needs an Anthropic key. Only the offline answers were tested; the Claude path falls back to them on any error. |
| **Two real phones in one call, over the internet** | the call logic was tested in-process only. |
| **Your Mac** | `npm test` and `npm run dev` on macOS, GPU effects on real hardware. |
| **Other languages** | the new screens have English text only; Hindi and the other six show English there. |

## Known limitations

- Ordinary mobile-network (SIM) calls cannot be monitored on Android or iPhone (MOBILE.md).
- The microphone usually stops when the screen locks or the app goes to the background.
- Call participants are remembered in memory only: after a server restart a guest loses access to a call (the owner keeps it).
- "Reset demo" still clears every call for every signed-in person.
- Deleting works in the app (History, Settings, the call panel). The delete tests ran against a fake Firestore, not your real project, so try one delete against the real database after deploying. Retention is off unless you set `RETENTION_DAYS`.
- Calls and call codes live in one server's memory: run one instance only.
- The evaluator's reading of what a person types is rule-based and can miss wording it has not seen. Its score for typed text is labelled unverified.

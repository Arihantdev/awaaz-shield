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

**Phone interface (new):** the app now has two separate interfaces. Narrow screens (and phones held sideways) get a phone layout with a bottom tab bar (Home, Calls, Voice, History, Settings), a Home screen showing what needs attention, and each call opening full screen. Laptops keep the existing layout. Checked in headless Chromium with an iPhone 13 profile: 14 checks pass, including the correct layout for each screen size, five tabs, a call opening and going back, no sideways scrolling on any of the five screens, and no page errors. I looked at screenshots of every phone screen. Not tested on a real phone. Settings has a Layout switch (Automatic, Phone, Laptop) in case the wrong one appears.

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
| **Translation quality** | all seven languages now cover every screen, but the new text is machine-written. A native speaker should read it. |

## Automatic call cut (risk above 75)

- `backend/test_autoend.py` (42 checks, in `npm run test:backend`): calm call not cut; the first alarming caller line only warns both people, and a cut needs `AUTO_END_LINES` (default 2) lines, later ones counting only if they match a scam pattern; guest lines never count; scam call cut once; both sides told with the reason; call ended, escalated once and shared with operators; operator gets `auto_ended`; ordinary user gets 404; operator cannot delete; limit can be turned off; demo calls never cut.
- Browser test (Chromium, fake Deepgram, fake microphone): operator on a laptop, caller and guest on phone-sized screens, plus an ordinary user. every check passed (about 35, including the warning before the cut). The operator sees the toast, the Auto-ended/Escalated tags and the detail banner; the ordinary user sees nothing.
- Not tested: two real phones over the internet, live Deepgram audio, real Firebase sign-in for operators.

## Languages and cold start

- Browser test: all seven non-English languages render the home page title and the settings page with no leftover English headings. Key check: no missing or duplicate keys in any language file.
- Cold start: with the first 5 `/api/auth/me` calls forced to fail with 503, the page shows the "waking up" message and then lands in the app, still signed in. Frontend unit tests: 33 passed.
- Not tested: a real Render sleep and wake, and the GitHub keep-awake workflow (it runs only on GitHub, and only if the repo is public).

## Known limitations

- False positives: one alarming line now only warns, and two are needed to cut (`AUTO_END_LINES=1` restores cut-at-once). A real bank or police officer who uses the same words as a scammer can still be cut; the rules cannot tell them apart. Tune or disable with `AUTO_END_SCORE`.
- Operators only see escalated calls, and the auto-cut applies to in-app voice calls only.

- Ordinary mobile-network (SIM) calls cannot be monitored on Android or iPhone (MOBILE.md).
- The microphone usually stops when the screen locks or the app goes to the background.
- Call participants are remembered in memory only: after a server restart a guest loses access to a call (the owner keeps it).
- "Reset demo" still clears every call for every signed-in person.
- Deleting works in the app (History, Settings, the call panel). The delete tests ran against a fake Firestore, not your real project, so try one delete against the real database after deploying. Retention is off unless you set `RETENTION_DAYS`.
- Calls and call codes live in one server's memory: run one instance only.
- The evaluator's reading of what a person types is rule-based and can miss wording it has not seen. Its score for typed text is labelled unverified.

# Deploying the backend (and the web app)

One server does everything: the backend serves the API, the call sockets **and** the built web app from a single https address. That is what phones need (secure microphone access, one origin, no cross-site cookie problems).

> **Before you put it on the internet**
> 1. Turn on real sign-in (Firebase) and set `ALLOW_DEV_LOGIN=false`. Dev-mode login lets anyone in with just an email address; it exists only for your own computer.
> 2. Rotate any key that was ever pasted into a chat (the Firebase service-account key in particular).
> 3. Run **one** instance only. Calls and call codes live in the server's memory.

## Option A: Render (simple, free tier available)

1. Push the project to a GitHub repository (secrets are already git-ignored: `.env`, `firebase-service-account.json`).
2. On render.com: New > **Blueprint**, pick the repository. It reads `render.yaml` and builds the `Dockerfile`.
3. In the Render dashboard fill the secrets the blueprint asks for: `DEEPGRAM_API_KEY`, optionally `ANTHROPIC_API_KEY`, and the four `VITE_FIREBASE_*` values (public identifiers from Firebase console > Project settings > Your apps).
4. Add the Firebase service-account key as a **Secret File** named `firebase-service-account.json` (Render mounts it at `/etc/secrets/firebase-service-account.json`, which `render.yaml` already points to).
5. Set `CORS_ORIGINS` to your real address, for example `https://awaaz-shield.onrender.com`.
6. In the Firebase console > Authentication > Settings > **Authorized domains**, add the Render domain. Without this, sign-in fails on the deployed site.
7. Open `https://<your-service>/api/status`. You should see `firebase_auth: true`, `dev_mode_auth: false`, and `deepgram_stt: true`.

Free-tier notes: the service sleeps when idle (the first open takes a while) and a restart drops calls that are only in memory. Saved calls are kept in Firestore (`FIRESTORE_ENABLED=true`, the default when Firebase is on).

*Whether Render passes the `VITE_FIREBASE_*` values to the Docker build as build arguments was not verified. If the login page says Firebase is not configured, build the image yourself with `--build-arg` (Option B) or check Render's Docker build-argument settings.*

## Option B: any Docker host (Fly.io, Railway, a VPS...)

```bash
docker build -t awaaz-shield \
  --build-arg VITE_FIREBASE_API_KEY=... --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
  --build-arg VITE_FIREBASE_PROJECT_ID=... --build-arg VITE_FIREBASE_APP_ID=... .
docker run -p 8000:8000 --env-file backend/.env \
  -e ALLOW_DEV_LOGIN=false -e CORS_ORIGINS=https://your.domain \
  -v /path/to/firebase-service-account.json:/etc/secrets/firebase-service-account.json:ro \
  -e FIREBASE_ENABLED=true -e FIREBASE_SERVICE_ACCOUNT_PATH=/etc/secrets/firebase-service-account.json \
  awaaz-shield
```

Put it behind https (the platform's proxy, Caddy or nginx). The container already trusts the proxy's `X-Forwarded-Proto` so cookies are marked Secure.

## Option C: without Docker

```bash
cd frontend && VITE_SAME_ORIGIN=true npm run build && cd ..
cd backend && pip install -r requirements.txt
ALLOW_DEV_LOGIN=false CORS_ORIGINS=https://your.domain \
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
```

When `frontend/dist` exists the backend serves it automatically (or set `FRONTEND_DIST`).

## Settings (backend environment)

| Variable | Purpose | Default |
|---|---|---|
| `APP_SECRET_KEY` | Signs session cookies. Use a long random value. | dev value, **change it** |
| `CORS_ORIGINS` | Addresses allowed to call the API (your public address). | `http://localhost:5173` |
| `FIREBASE_ENABLED`, `FIREBASE_SERVICE_ACCOUNT_PATH` | Real sign-in and saved calls. | off |
| `ALLOW_DEV_LOGIN` | Email-only dev login. **false on any public server.** | `true` |
| `REQUIRE_EMAIL_VERIFIED` | Require the emailed verification link. | `true` |
| `DEEPGRAM_API_KEY` | Live speech-to-text (stays on the server). | empty |
| `ANTHROPIC_API_KEY` | Optional: Claude words the evaluator's answers and scores calls. | empty |
| `RISK_MEDIUM_MIN`, `RISK_HIGH_MIN`, `RISK_CRITICAL_MIN` | Score bands. Ascending, 1 to 100. | `30`, `55`, `80` |
| `RESTRICT_CALL_ACCESS` | A call is visible only to its owner and people who joined it. | `true` |
| `EVALUATOR_RATE_PER_MINUTE` | Questions per person per minute. | `20` |
| `COOKIE_SECURE` | `auto` (Secure over https), `true` or `false`. | `auto` |
| `RETENTION_DAYS` | Automatically delete ended calls this many days after they started (checked hourly). `0` keeps them until a person deletes them. Also deletes the saved copy in Firestore. | `0` |
| `AUTO_END_SCORE` | In-app voice calls are ended automatically when the caller's risk score goes above this number (1-99), and the call is escalated to operators. `0` turns the auto-cut off. | `75` |
| `OPERATOR_EMAILS` | Comma-separated emails of operators. They see calls that were escalated (including auto-ended ones), can record a verdict, and cannot delete. Needs real Firebase sign-in; dev-login lets anyone claim an email. | empty |
| `COOKIE_SAMESITE` | `lax`, or `none` for a separately hosted app (needs https). | `lax` |
| `FRONTEND_DIST` | Folder with the built web app. | `frontend/dist` if built |
| `DEEPGRAM_LANGUAGE`, `DEEPGRAM_MODEL`, `DEEPGRAM_KEYTERMS`, `DEEPGRAM_ENDPOINTING_MS` | Speech-to-text tuning. | see `.env` |

## Checking a deployment

- `GET /api/health` returns `{"ok": true}`.
- `GET /api/status` shows what is really on (Firebase, speech-to-text, scoring, risk bands, access rules).
- Sign in, load the sample calls, and ask the evaluator a question.
- Then try a two-phone call and the Android/iPhone steps in MOBILE.md.

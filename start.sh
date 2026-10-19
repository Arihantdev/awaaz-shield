#!/usr/bin/env bash
# Awaaz Shield - one-command local launcher: backend (FastAPI) + frontend (Vite).
#
#   bash start.sh        # from the awaaz-shield folder
#
# First run sets everything up (Python venv, pip install, npm install); later runs just start.
# Press Ctrl+C once to stop both servers.
#
# On the first run, this script creates local config files from the safe examples.

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# ---------- pre-flight checks ----------
command -v python3 >/dev/null 2>&1 || { echo "[!!] python3 not found. Install Python 3.10+."; exit 1; }
command -v npm     >/dev/null 2>&1 || { echo "[!!] npm not found. Install Node.js 18+."; exit 1; }
if [ ! -f "$ROOT/backend/.env" ]; then cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"; fi
if [ ! -f "$ROOT/frontend/.env.local" ]; then cp "$ROOT/frontend/.env.example" "$ROOT/frontend/.env.local"; fi
if grep -qi '^FIREBASE_ENABLED=true' "$ROOT/backend/.env" && [ ! -f "$ROOT/backend/firebase-service-account.json" ]; then
  echo "[!!] FIREBASE_ENABLED=true but backend/firebase-service-account.json is missing."; exit 1
fi

# ---------- backend setup (first run only) ----------
if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "[..] first run: creating Python venv and installing backend dependencies..."
  [ -d "$ROOT/backend/.venv" ] || python3 -m venv "$ROOT/backend/.venv" || exit 1
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt" || { echo "[!!] pip install failed"; exit 1; }
fi

# ---------- frontend setup (first run only) ----------
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[..] first run: installing frontend dependencies..."
  (cd "$ROOT/frontend" && npm install --no-audit --no-fund) || { echo "[!!] npm install failed"; exit 1; }
fi

# ---------- start both ----------
BACK_PID=""; FRONT_PID=""
cleanup() {
  trap - INT TERM EXIT
  echo; echo "[..] stopping backend and frontend..."
  for p in $BACK_PID $FRONT_PID; do
    pkill -P "$p" 2>/dev/null
    kill "$p" 2>/dev/null
  done
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM EXIT

echo "[..] backend  -> http://localhost:$BACKEND_PORT   (API docs: /docs, status: /api/status)"
(cd "$ROOT/backend" && exec "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 0.0.0.0 --reload --port "$BACKEND_PORT") &

echo "[..] frontend -> http://localhost:$FRONTEND_PORT"
(cd "$ROOT/frontend" && exec npm run dev -- --port "$FRONTEND_PORT" --strictPort) &
FRONT_PID=$!

echo "[ok] open http://localhost:$FRONTEND_PORT  -  Ctrl+C stops everything."

while kill -0 "$BACK_PID" 2>/dev/null && kill -0 "$FRONT_PID" 2>/dev/null; do
  sleep 1
done
echo "[!!] one of the servers stopped - shutting down the other."

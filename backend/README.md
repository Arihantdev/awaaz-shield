# Awaaz Shield backend

FastAPI service for authentication, call/session storage, risk scoring, and live dashboard updates.

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

On Windows, activate with `.venv\Scripts\activate`. Open http://localhost:8000/docs for the API reference.

With the example configuration, the service uses its offline heuristic scorer and development login. `python smoke_test.py` checks login, call creation, transcript ingestion, scoring, alerts, analytics, and reset without starting a server.

## Optional configuration

Set `ANTHROPIC_API_KEY` to enable Claude scoring. Set the Firebase variables and provide a service-account JSON outside version control to enable Firebase authentication and Firestore persistence. See `.env.example` for the full set of supported values.

## Microphone and future telephony

The browser microphone prototype sends recognized text to `POST /api/calls/{call_id}/ingest`. It does not upload or retain raw microphone audio in this application.

No telephony provider is configured in this backend. A future Exotel adapter should authenticate its webhook and map provider events into the existing call creation, transcript ingestion, and end-call interfaces after Exotel confirms the account's real-time audio capabilities.

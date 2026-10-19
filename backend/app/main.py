from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import analytics, auth_routes, calls, consent, demo, stt, voice, ws
from .store import store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load previously saved calls from Firestore in the background (no-op if persistence is off).
    store.load_from_persistence_async()
    yield
    # On shutdown, give queued Firestore writes a moment to finish so the last lines are not lost.
    from .persistence import repo
    repo.flush(5)


app = FastAPI(title="Awaaz Shield API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(calls.router)
app.include_router(demo.router)
app.include_router(analytics.router)
app.include_router(ws.router)
app.include_router(stt.router)
app.include_router(voice.router)
app.include_router(consent.router)


@app.get("/api/status")
def status():
    """What's actually live right now — the frontend uses this to show
    honest badges ('Claude scoring: on/off', 'Firebase: on/off') instead
    of claiming capabilities that aren't configured."""
    return settings.status()


@app.get("/api/health")
def health():
    return {"ok": True}

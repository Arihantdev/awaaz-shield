import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

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


# ------------------------------------------------------------------ safe defaults for every response
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response


# ------------------------------------------------------------------ serve the built web app (optional)
def _frontend_dir() -> str | None:
    """frontend/dist (or FRONTEND_DIST) when it has been built. Then one address serves the page, the API and the sockets."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = settings.FRONTEND_DIST or os.path.join(here, "..", "..", "frontend", "dist")
    candidate = os.path.abspath(candidate)
    return candidate if os.path.isfile(os.path.join(candidate, "index.html")) else None


_DIST = _frontend_dir()

if _DIST:
    @app.get("/{path:path}", include_in_schema=False)
    def web_app(path: str):
        # API and socket paths that did not match a route must stay real 404s, not the web page
        if path.startswith(("api/", "ws/")) or path in ("api", "ws"):
            return JSONResponse({"detail": "Not found."}, status_code=404)
        target = os.path.abspath(os.path.join(_DIST, path))
        if path and target.startswith(_DIST + os.sep) and os.path.isfile(target):
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {"Cache-Control": "no-cache"}
            return FileResponse(target, headers=headers)
        return FileResponse(os.path.join(_DIST, "index.html"), headers={"Cache-Control": "no-cache"})  # single-page app routes

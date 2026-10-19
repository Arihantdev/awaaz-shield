"""Run with: python test_deploy.py (inside the backend venv).
Covers what a hosted deployment relies on: cookie flags behind https, security headers, serving the built web app."""
import os
import tempfile

# a tiny fake "built frontend" so the backend serves a web app (must exist before the app is imported)
dist = tempfile.mkdtemp(prefix="awaaz-dist-")
os.makedirs(os.path.join(dist, "assets"))
open(os.path.join(dist, "index.html"), "w").write("<!doctype html><title>Awaaz</title><div id=root></div>")
open(os.path.join(dist, "assets", "app-abc123.js"), "w").write("console.log('hi')")
open(os.path.join(dist, "sw.js"), "w").write("// sw")
secret_outside = os.path.join(os.path.dirname(dist), "awaaz-secret.txt")
open(secret_outside, "w").write("TOP SECRET")
os.environ["FRONTEND_DIST"] = dist
os.environ.setdefault("FIREBASE_ENABLED", "false")

from starlette.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402


def expect(cond, msg):
    print(f"[{'OK ' if cond else 'FAIL'}] {msg}")
    if not cond:
        raise SystemExit(1)


client = TestClient(app)

# ---- security headers on API and page responses
r = client.get("/api/health")
expect(r.status_code == 200 and r.json() == {"ok": True}, "API still answers with the web app mounted")
expect(r.headers.get("x-content-type-options") == "nosniff" and r.headers.get("x-frame-options") == "DENY", "security headers are set")
expect("microphone=(self)" in r.headers.get("permissions-policy", ""), "microphone is allowed for this site only")
expect("strict-transport-security" not in r.headers, "no HSTS over plain http")
r = client.get("/api/health", headers={"x-forwarded-proto": "https"})
expect("strict-transport-security" in r.headers, "HSTS when the request came in over https (behind a proxy)")

# ---- serving the web app
r = client.get("/")
expect(r.status_code == 200 and "<div id=root>" in r.text and r.headers["cache-control"] == "no-cache", "/ serves index.html (no-cache)")
r = client.get("/history")
expect(r.status_code == 200 and "<div id=root>" in r.text, "a client route (/history) gets index.html for the single-page app")
r = client.get("/assets/app-abc123.js")
expect(r.status_code == 200 and "immutable" in r.headers["cache-control"], "hashed assets are cached long")
r = client.get("/sw.js")
expect(r.status_code == 200 and r.headers["cache-control"] == "no-cache", "the service worker is never cached long")
r = client.get("/api/does-not-exist")
expect(r.status_code == 404 and r.headers["content-type"].startswith("application/json"), "unknown /api path is a real 404, not the web page")
r = client.get("/ws/nothing")
expect(r.status_code == 404, "unknown /ws path is a real 404")
traversal = client.get("/..%2fawaaz-secret.txt")
expect("TOP SECRET" not in traversal.text, "path traversal does not leak files outside the web app")
traversal = client.get("/assets/../../awaaz-secret.txt")
expect("TOP SECRET" not in traversal.text, "path traversal via /assets does not leak files either")
r = client.get("/api/calls")
expect(r.status_code == 401, "API still requires sign-in")

# ---- session cookie flags
def login(**headers):
    return TestClient(app).post("/api/auth/dev-login", json={"email": "x@example.com"}, headers=headers).headers.get("set-cookie", "")

c = login()
expect("HttpOnly" in c and "samesite=lax" in c.lower() and "secure" not in c.lower() and "Max-Age" in c, "plain http: HttpOnly, SameSite=Lax, not Secure, lasts beyond the browser session")
c = login(**{"x-forwarded-proto": "https"})
expect("secure" in c.lower() and "samesite=lax" in c.lower(), "behind an https proxy: cookie is Secure")

saved = (settings.COOKIE_SECURE, settings.COOKIE_SAMESITE)
settings.COOKIE_SAMESITE = "none"
c = login()
expect("samesite=lax" in c.lower(), "SameSite=None without https falls back to Lax (browsers would drop it)")
c = login(**{"x-forwarded-proto": "https"})
expect("samesite=none" in c.lower() and "secure" in c.lower(), "SameSite=None + Secure works for a separately hosted app")
settings.COOKIE_SECURE, settings.COOKIE_SAMESITE = "false", "lax"
expect("secure" not in login(**{"x-forwarded-proto": "https"}).lower(), "COOKIE_SECURE=false is respected")
settings.COOKIE_SECURE, settings.COOKIE_SAMESITE = saved

settings.ALLOW_DEV_LOGIN = False
r = TestClient(app).post("/api/auth/dev-login", json={"email": "x@example.com"})
expect(r.status_code == 403 and "set-cookie" not in r.headers, "ALLOW_DEV_LOGIN=false: nobody can sign in without Firebase")
expect(client.get("/api/status").json()["dev_mode_auth"] is False, "status tells the page dev login is off")
settings.ALLOW_DEV_LOGIN = True

lo = TestClient(app)
lo.post("/api/auth/dev-login", json={"email": "x@example.com"})
expect(lo.get("/api/auth/me").status_code == 200, "signed in")
lo.post("/api/auth/logout")
expect(lo.get("/api/auth/me").status_code == 401, "logout clears the session")

print("\nALL DEPLOYMENT TESTS PASSED")

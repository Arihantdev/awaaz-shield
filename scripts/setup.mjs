// Preflight for `npm run dev` (also runnable alone: `npm run setup`).
// Idempotent: creates local config from the safe examples, builds the Python venv, installs missing dependencies,
// and refuses to start if a required port is already taken, so nothing is left half-running.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BACKEND, BACKEND_PORT, FRONTEND, FRONTEND_PORT, IS_WIN, ROOT, VENV_DIR, VENV_PY,
  fail, findPython, log, portInUse, readEnvFile, run, sha, warn,
} from "./lib.mjs";

const portsOnly = process.argv.includes("--ports-only");

// ---- Node ----
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) fail(`Node.js ${process.versions.node} is too old.`, "Install Node.js 18 or newer from https://nodejs.org");

if (!portsOnly) {
  // ---- local config (never overwrites an existing file) ----
  const envPairs = [
    [path.join(BACKEND, ".env.example"), path.join(BACKEND, ".env")],
    [path.join(FRONTEND, ".env.example"), path.join(FRONTEND, ".env.local")],
  ];
  for (const [example, target] of envPairs) {
    if (!existsSync(target) && existsSync(example)) {
      copyFileSync(example, target);
      log(`created ${path.relative(ROOT, target)} from the example (add your own keys there if you use them)`);
    }
  }

  // ---- Firebase sanity (matches the old launcher's check) ----
  const be = readEnvFile(path.join(BACKEND, ".env"));
  if (/^(1|true|yes|on)$/i.test(be.FIREBASE_ENABLED || "")) {
    const key = path.resolve(BACKEND, be.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json");
    if (!existsSync(key)) {
      fail("FIREBASE_ENABLED=true but the service-account file is missing.", `Expected: ${path.relative(ROOT, key)}\nAdd the file, or set FIREBASE_ENABLED=false in backend/.env to use dev-mode login.`);
    }
  }

  // ---- backend: venv + dependencies ----
  const req = path.join(BACKEND, "requirements.txt");
  const stamp = path.join(VENV_DIR, ".requirements.sha256");
  let venvOk = existsSync(VENV_PY) && run(VENV_PY, ["-c", "import sys"]).status === 0;
  if (!venvOk) {
    const py = findPython();
    if (!py) fail("Python 3.10 or newer was not found.", "Install it from https://www.python.org/downloads/ and make sure `python3` (or `py -3` on Windows) works in a new terminal.");
    log(`creating Python virtual environment in backend/.venv (${py.join(" ")})`);
    const r = spawnSync(py[0], [...py.slice(1), "-m", "venv", "--clear", VENV_DIR], { stdio: "inherit" });
    if (r.status !== 0) fail("Could not create the Python virtual environment.", "On Debian/Ubuntu you may need: sudo apt install python3-venv");
    venvOk = true;
  }
  const want = sha(req);
  const have = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "";
  const importable = run(VENV_PY, ["-c", "import fastapi, uvicorn, anthropic, firebase_admin, itsdangerous, dotenv, websockets"]).status === 0;
  if (have !== want || !importable) {
    log("installing backend dependencies (first run takes a minute)...");
    const r = spawnSync(VENV_PY, ["-m", "pip", "install", "-q", "--disable-pip-version-check", "-r", req], { stdio: "inherit" });
    if (r.status !== 0) fail("pip could not install the backend dependencies.", "Check your internet connection, then run `npm run setup` again.");
    writeFileSync(stamp, want);
  }

  // ---- frontend dependencies ----
  const pkg = JSON.parse(readFileSync(path.join(FRONTEND, "package.json"), "utf8"));
  const wanted = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const missing = wanted.filter((d) => !existsSync(path.join(FRONTEND, "node_modules", ...d.split("/"))));
  if (missing.length) {
    log(`installing frontend dependencies (${missing.length} missing)...`);
    const r = spawnSync(IS_WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: FRONTEND, stdio: "inherit", shell: IS_WIN });
    if (r.status !== 0) fail("npm could not install the frontend dependencies.", "Check your internet connection, then run `npm run setup` again.");
  }
}

// ---- ports ----
const taken = [];
if (await portInUse(BACKEND_PORT)) taken.push(["backend (FastAPI)", BACKEND_PORT, "BACKEND_PORT"]);
if (await portInUse(FRONTEND_PORT)) taken.push(["frontend (Vite)", FRONTEND_PORT, "FRONTEND_PORT"]);
if (taken.length) {
  const lines = taken.map(([n, p, v]) => `- port ${p} (${n}) is already in use`).join("\n");
  const who = IS_WIN ? "netstat -ano | findstr :PORT" : "lsof -i :PORT";
  fail("Cannot start: a required port is busy.", `${lines}\nA previous run may still be going. Find it with \`${who}\` and stop it,\nor pick other ports, e.g. BACKEND_PORT=8001 FRONTEND_PORT=5174 npm run dev\n(then also add the new frontend origin to CORS_ORIGINS in backend/.env).`);
}
if (BACKEND_PORT !== 8000 || FRONTEND_PORT !== 5173) {
  warn(`custom ports: make sure CORS_ORIGINS in backend/.env contains http://localhost:${FRONTEND_PORT}`);
}
log("ready.");

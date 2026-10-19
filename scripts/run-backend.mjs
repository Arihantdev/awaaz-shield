// Starts the FastAPI backend with the project's virtualenv. Cross-platform; exits with uvicorn's exit code.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { BACKEND, BACKEND_HOST, BACKEND_PORT, VENV_PY } from "./lib.mjs";

if (!existsSync(VENV_PY)) {
  console.error("[backend] Python virtualenv not found. Run `npm run setup` first.");
  process.exit(1);
}
const shown = BACKEND_HOST === "0.0.0.0" ? "localhost" : BACKEND_HOST;
console.log(`[backend] starting on http://${shown}:${BACKEND_PORT}  (API docs: /docs, status: /api/status, WebSocket: /ws/dashboard)`);
const child = spawn(VENV_PY, ["-m", "uvicorn", "app.main:app", "--host", BACKEND_HOST, "--port", String(BACKEND_PORT), "--reload"], {
  cwd: BACKEND,
  stdio: "inherit",
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("error", (e) => { console.error(`[backend] could not start: ${e.message}`); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));

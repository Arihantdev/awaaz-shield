// Starts the Vite dev server using the frontend's own installed Vite (no shell, works on macOS/Linux/Windows).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BACKEND_PORT, FRONTEND, FRONTEND_PORT } from "./lib.mjs";

const vite = path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(vite)) {
  console.error("[frontend] Vite is not installed. Run `npm run setup` first.");
  process.exit(1);
}
const env = { ...process.env };
// Only when the backend port was changed: point the browser app at it (an explicit VITE_API_BASE_URL still wins).
if (BACKEND_PORT !== 8000 && !env.VITE_API_BASE_URL) env.VITE_API_BASE_URL = `http://localhost:${BACKEND_PORT}`;
// `npm run dev:share`: expose the app on the network and route API + sockets through the dev server, so ONE https tunnel
// (see "Two phones" in the README) is enough for a phone to log in, call and be heard.
if (process.argv.includes("--share")) {
  env.VITE_SAME_ORIGIN = "true";
  env.VITE_HOST = "true";
}
const child = spawn(process.execPath, [vite, "--port", String(FRONTEND_PORT), "--strictPort"], { cwd: FRONTEND, stdio: "inherit", env });
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("error", (e) => { console.error(`[frontend] could not start: ${e.message}`); process.exit(1); });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 0 : 1)));

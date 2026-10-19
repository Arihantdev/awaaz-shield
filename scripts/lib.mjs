// Shared helpers for the launcher scripts. Cross-platform (macOS, Linux, Windows); no machine-specific paths.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = path.join(ROOT, "backend");
export const FRONTEND = path.join(ROOT, "frontend");
export const IS_WIN = process.platform === "win32";

export const BACKEND_HOST = process.env.BACKEND_HOST || "127.0.0.1";
export const BACKEND_PORT = Number(process.env.BACKEND_PORT || 8000);
export const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 5173);

export const VENV_DIR = path.join(BACKEND, ".venv");
export const VENV_PY = IS_WIN ? path.join(VENV_DIR, "Scripts", "python.exe") : path.join(VENV_DIR, "bin", "python");

const tag = (t, c) => (process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t);
export const log = (m) => console.log(`${tag("[setup]", "36")} ${m}`);
export const warn = (m) => console.warn(`${tag("[setup] !", "33")} ${m}`);
export function fail(m, hint) {
  console.error(`\n${tag("[setup] ERROR", "31")} ${m}`);
  if (hint) console.error(`        ${hint.split("\n").join("\n        ")}`);
  console.error("");
  process.exit(1);
}

export function sha(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Run a command without a shell; returns the spawnSync result. */
export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

/** Find a Python >= 3.10 on PATH. Returns [cmd, ...prefixArgs] or null. */
export function findPython() {
  const candidates = IS_WIN ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  for (const [cmd, ...pre] of candidates) {
    const r = run(cmd, [...pre, "-c", "import sys;print('%d.%d'%sys.version_info[:2])"]);
    if (r.status === 0) {
      const [maj, min] = r.stdout.trim().split(".").map(Number);
      if (maj > 3 || (maj === 3 && min >= 10)) return [cmd, ...pre];
    }
  }
  return null;
}

/** True if something already accepts connections on the port (IPv4 or IPv6 loopback). */
export function portInUse(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      const done = (v) => { s.destroy(); resolve(v); };
      s.setTimeout(600, () => done(false));
      s.once("connect", () => done(true));
      s.once("error", () => done(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}

/** Minimal KEY=VALUE reader for backend/.env (only used for a few preflight checks). */
export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

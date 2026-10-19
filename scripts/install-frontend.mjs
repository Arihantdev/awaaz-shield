// Runs after the root `npm install`: installs the frontend's dependencies too.
import { spawnSync } from "node:child_process";
import { FRONTEND, IS_WIN } from "./lib.mjs";

if (process.env.AWAAZ_SKIP_FRONTEND_INSTALL) process.exit(0);
const r = spawnSync(IS_WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: FRONTEND, stdio: "inherit", shell: IS_WIN });
process.exit(r.status ?? 1);

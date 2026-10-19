// Runs the backend regression scripts (incl. the risk-scoring evaluation) with the project's virtualenv (cross-platform).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { BACKEND, VENV_PY } from "./lib.mjs";

if (!existsSync(VENV_PY)) {
  console.error("Python virtualenv not found. Run `npm run setup` first.");
  process.exit(1);
}
let code = 0;
for (const file of ["smoke_test.py", "test_persistence.py", "test_stt.py", "test_voice.py", "test_evaluator.py", "test_deploy.py", "eval_risk.py"]) {
  console.log(`\n=== ${file} ===`);
  const r = spawnSync(VENV_PY, [file], { cwd: BACKEND, stdio: "inherit" });
  if (r.status !== 0) code = r.status ?? 1;
}
process.exit(code);

// Regenerates the characterization baselines under test/baseline/.
//
// Cross-platform wrapper: the baselines are produced by the normal unit-test
// run with UPDATE_CHARACTERIZATION=1, and `VAR=value cmd` is not portable to
// the cmd.exe shell npm uses on Windows.
//
// Regenerating is an explicit, reviewable act. The resulting diff under
// test/baseline/ IS the observable behaviour change; a non-empty diff requires
// explicit review and justification.

import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", "test/unit/characterization-*.test.js"],
  { stdio: "inherit", env: { ...process.env, UPDATE_CHARACTERIZATION: "1" } }
);

process.exit(result.status ?? 1);

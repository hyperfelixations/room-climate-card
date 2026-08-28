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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHARACTERIZATION_DIR = path.join(ROOT, "test", "characterization");

export function discoverCharacterizationTests(directory = CHARACTERIZATION_DIR) {
  const tests = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (tests.length === 0) {
    throw new Error(`characterize:update: no characterization tests found under ${directory}`);
  }
  return tests;
}

export function main(args = process.argv.slice(2)) {
  const tests = discoverCharacterizationTests();
  if (args.includes("--list")) {
    for (const file of tests) console.log(path.relative(ROOT, file).replaceAll(path.sep, "/"));
    return 0;
  }
  const result = spawnSync(process.execPath, ["--test", ...tests], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, UPDATE_CHARACTERIZATION: "1" },
  });
  return result.status ?? 1;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  process.exit(main());
}

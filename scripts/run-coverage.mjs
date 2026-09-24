// Executes the four coverage layers with one instrumented build and delegates source-map
// normalization/reporting to merge-coverage.mjs. The ordinary reviewable bundle is restored
// before exit, including after failure, so coverage never poisons a later pipeline `*:run`.
// Commands are spawned without a shell so paths, environment values and failures retain
// their exact meaning on Windows and POSIX. See internal dev doc §4 "Coverage in vier Schichten".

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const COVERAGE = path.join(ROOT, "coverage");

// The Node layers, each one c8 run over its tests. Every Node test directory belongs to exactly
// one layer or to UNMEASURED_TEST_DIRECTORIES (test/architecture/coverage-layers.test.js).
export const COVERAGE_LAYERS = Object.freeze([
  Object.freeze({ name: "unit", tests: Object.freeze(["test/unit/**/*.test.js"]) }),
  Object.freeze({ name: "bundle", tests: Object.freeze(["test/component/**/*.test.js", "test/known-issues.test.js"]) }),
  Object.freeze({
    name: "surface",
    tests: Object.freeze([
      "test/contract/*.test.js",
      "test/property/*.test.js",
      "test/characterization/*.test.js",
      "test/fixtures/*.test.js",
    ]),
  }),
]);
export const BROWSER_LAYER = "browser";
export const UNMEASURED_TEST_DIRECTORIES = Object.freeze({
  architecture: "reads sources and scripts as text; it never executes the card",
});

// Fixed for every Node layer run: the artifact tests judge dist/ without its coverage source
// map, property runs use their default counts and seeds, and nothing rewrites a baseline or
// writes a report. `null` removes a variable inherited from the shell.
export const NODE_LAYER_ENV = Object.freeze({
  ROOM_CLIMATE_CARD_COVERAGE_ARTIFACT: "1",
  ROOM_CLIMATE_CARD_FUZZ_CASES: null,
  ROOM_CLIMATE_CARD_FUZZ_SEED: null,
  ROOM_CLIMATE_CARD_METAMORPHIC_CASES: null,
  ROOM_CLIMATE_CARD_METAMORPHIC_SEED: null,
  ROOM_CLIMATE_CARD_DISCOVERY_CASES: null,
  ROOM_CLIMATE_CARD_DISCOVERY_SEED: null,
  ROOM_CLIMATE_CARD_PROPERTY_REPORT_DIR: null,
  UPDATE_CHARACTERIZATION: null,
});

// c8 reports the src/ modules a test imports directly. It drops the vm-evaluated dist bundle
// (--include applies before remapping, and --exclude-after-remap marks every bundled line
// covered), so merge-coverage.mjs remaps the bundle from the raw V8 files kept in `v8/`.
export function c8Args(directory, tests) {
  return [
    "--report-dir", directory,
    "--temp-directory", `${directory}/v8`,
    "--reporter=json",
    "--all",
    "--include=src/**/*.js",
    process.execPath,
    "--test",
    ...tests,
  ];
}

function run(script, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    const error = new Error(`${path.relative(ROOT, script)} exited with status ${result.status ?? 1}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

export function runWithRestoredArtifact(coverageWork, restoreArtifact) {
  let coverageFailure = null;
  try {
    coverageWork();
  } catch (error) {
    coverageFailure = error;
  }
  try {
    restoreArtifact();
  } catch (restoreFailure) {
    if (coverageFailure) {
      throw new AggregateError(
        [coverageFailure, restoreFailure],
        "coverage failed and the ordinary bundle could not be restored",
      );
    }
    throw restoreFailure;
  }
  if (coverageFailure) throw coverageFailure;
}

function main() {
  if (path.dirname(COVERAGE) !== ROOT || path.basename(COVERAGE) !== "coverage") {
    throw new Error(`refusing to clear unexpected coverage path ${COVERAGE}`);
  }
  fs.rmSync(COVERAGE, { recursive: true, force: true });

  const rollup = path.join(ROOT, "node_modules", "rollup", "dist", "bin", "rollup");
  runWithRestoredArtifact(
    () => {
      run(rollup, ["-c"], { ROOM_CLIMATE_CARD_COVERAGE: "1" });

      const c8 = path.join(ROOT, "node_modules", "c8", "bin", "c8.js");
      for (const layer of COVERAGE_LAYERS) {
        run(c8, c8Args(`coverage/raw-${layer.name}`, layer.tests), NODE_LAYER_ENV);
      }

      run(path.join(ROOT, "node_modules", "@playwright", "test", "cli.js"), ["test", "--project=chromium"], {
        ROOM_CLIMATE_CARD_BROWSER_COVERAGE: "1",
        ROOM_CLIMATE_CARD_BROWSER_COVERAGE_DIR: path.join(COVERAGE, "browser", "raw"),
      });
      run(path.join(ROOT, "scripts", "merge-coverage.mjs"), []);
    },
    () => run(rollup, ["-c"], { ROOM_CLIMATE_CARD_COVERAGE: null }),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  try {
    main();
  } catch (error) {
    console.error(`Coverage runner failed: ${error.message}`);
    const failures = error instanceof AggregateError ? error.errors : [error];
    process.exitCode = failures.find((failure) => Number.isInteger(failure?.exitCode))?.exitCode ?? 1;
  }
}

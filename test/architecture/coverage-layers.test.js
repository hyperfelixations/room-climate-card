"use strict";

// Which tests `npm run coverage` measures, and how. Every Node test directory belongs to exactly
// one coverage layer or is named as unmeasured with its reason, so no directory can silently
// fall out of the measurement again. The layer runs keep the raw V8 files the bundle is remapped
// from and run with a fixed environment, so a developer's shell cannot change what is measured.
// Boundary: what the merge does with the layers is coverage-merge.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const TEST_DIR = path.join(ROOT, "test");

let coverage;
test.before(async () => {
  coverage = await import("../../scripts/run-coverage.mjs");
});

const toPosix = (file) => path.relative(ROOT, file).split(path.sep).join("/");

// Every directory under test/ that holds a Node test file, as a repository-relative path.
function nodeTestDirectories(directory = TEST_DIR, found = new Set()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "browser" || entry.name === "baseline" || entry.name === "node_modules") continue;
      nodeTestDirectories(full, found);
    } else if (entry.name.endsWith(".test.js")) {
      found.add(toPosix(directory));
    }
  }
  return found;
}

const filesOf = (patterns) => patterns.flatMap((pattern) => fs.globSync(pattern, { cwd: ROOT }).map((file) => file.split(path.sep).join("/")));

test("every Node test file is measured by exactly one layer or sits in a directory named as unmeasured", () => {
  const measured = new Map();
  for (const layer of coverage.COVERAGE_LAYERS) {
    for (const file of filesOf(layer.tests)) {
      assert.ok(!measured.has(file), `${file} is measured by both ${measured.get(file)} and ${layer.name}`);
      measured.set(file, layer.name);
    }
  }
  const unmeasured = Object.keys(coverage.UNMEASURED_TEST_DIRECTORIES).map((directory) => `test/${directory}`);
  const orphans = [];
  for (const directory of nodeTestDirectories()) {
    for (const name of fs.readdirSync(path.join(ROOT, directory)).filter((entry) => entry.endsWith(".test.js"))) {
      const file = `${directory}/${name}`;
      const inUnmeasured = unmeasured.includes(directory);
      if (measured.has(file) && inUnmeasured) orphans.push(`${file} is measured although ${directory} is named unmeasured`);
      if (!measured.has(file) && !inUnmeasured) orphans.push(`${file} belongs to no coverage layer`);
    }
  }
  assert.deepEqual(orphans, [], orphans.join("\n"));
});

test("the layers are unit, bundle and surface, each reaching tests, and only architecture is unmeasured", () => {
  assert.deepEqual(coverage.COVERAGE_LAYERS.map((layer) => layer.name), ["unit", "bundle", "surface"]);
  assert.ok(Object.isFrozen(coverage.COVERAGE_LAYERS));
  for (const layer of coverage.COVERAGE_LAYERS) {
    for (const pattern of layer.tests) assert.ok(filesOf([pattern]).length > 0, `${layer.name}: ${pattern} matches no test`);
  }
  assert.deepEqual(Object.keys(coverage.UNMEASURED_TEST_DIRECTORIES), ["architecture"]);
  assert.ok(coverage.UNMEASURED_TEST_DIRECTORIES.architecture.trim(), "an unmeasured directory says why");
  assert.equal(coverage.BROWSER_LAYER, "browser");
});

// c8 drops the vm-evaluated bundle (--include applies before remapping), and with
// --exclude-after-remap it marks every bundled line covered; merge-coverage.mjs remaps the
// bundle from the raw V8 files instead, so they have to be kept where it reads them.
test("each layer run reports src/ directly and keeps its raw V8 files for the bundle remap", () => {
  const args = coverage.c8Args("coverage/raw-bundle", ["test/component/**/*.test.js"]);
  assert.equal(args[args.indexOf("--temp-directory") + 1], "coverage/raw-bundle/v8");
  assert.ok(!args.includes("--exclude-after-remap"), "c8's own remap of the bundle over-reports every line");
  assert.ok(args.includes("--include=src/**/*.js"));
  assert.ok(args.includes("--all"));
  assert.deepEqual(args.slice(args.indexOf("--test") + 1), ["test/component/**/*.test.js"]);
});

test("the layer runs use a fixed environment: the coverage artifact flag set, run-shaping variables removed", () => {
  const env = coverage.NODE_LAYER_ENV;
  assert.equal(env.ROOM_CLIMATE_CARD_COVERAGE_ARTIFACT, "1");
  for (const name of [
    "ROOM_CLIMATE_CARD_FUZZ_CASES",
    "ROOM_CLIMATE_CARD_FUZZ_SEED",
    "ROOM_CLIMATE_CARD_METAMORPHIC_CASES",
    "ROOM_CLIMATE_CARD_METAMORPHIC_SEED",
    "ROOM_CLIMATE_CARD_DISCOVERY_CASES",
    "ROOM_CLIMATE_CARD_DISCOVERY_SEED",
    "ROOM_CLIMATE_CARD_PROPERTY_REPORT_DIR",
    "UPDATE_CHARACTERIZATION",
  ]) {
    assert.ok(Object.hasOwn(env, name) && env[name] === null, `${name} must be removed for the layer runs`);
  }
});

// Read from the whole test tree, so a new run-shaping variable cannot slip past the list above.
const NOT_RUN_SHAPING = {
  TZ: "every test that needs it assigns it itself",
  PORT: "the browser harness's static server",
  ROOM_CLIMATE_CARD_BROWSER_COVERAGE: "the Chromium layer, set by run-coverage.mjs for Playwright",
  ROOM_CLIMATE_CARD_BROWSER_COVERAGE_DIR: "the Chromium layer, set by run-coverage.mjs for Playwright",
};

test("every environment variable a test reads is either fixed for the layer runs or known not to shape them", () => {
  const names = new Set();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "baseline" && !entry.name.endsWith("-snapshots")) walk(full);
      } else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(full, "utf8");
        for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)|read(?:Count|Seed)\("([A-Z0-9_]+)"/g)) names.add(match[1] || match[2]);
      }
    }
  };
  walk(TEST_DIR);
  const unhandled = [...names].filter((name) => !Object.hasOwn(coverage.NODE_LAYER_ENV, name) && !Object.hasOwn(NOT_RUN_SHAPING, name));
  assert.deepEqual(unhandled.sort(), [], `set or remove these in NODE_LAYER_ENV: ${unhandled.join(", ")}`);
});

"use strict";

// The checks merge-coverage.mjs runs before it reports a number, tested on synthetic Istanbul
// maps: every layer covers the whole src/ inventory, every layer that loads the bundle really
// executed bundle-only modules, and the merged map meets its floor. Also the one place the
// coverage build of dist/ is told apart from the shipped artifact (shippedSource()).
// Boundary: which tests feed which layer is coverage-layers.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createCoverageMap } = require("istanbul-lib-coverage");
const { shippedSource, COVERAGE_MAP_TRAILER } = require("../helpers/shipped-source.js");

const ROOT = path.join(__dirname, "..", "..");

let merge;
test.before(async () => {
  merge = await import("../../scripts/merge-coverage.mjs");
});

// One file with `executed` of its `statements` statements hit and `calls` calls of its one function.
function fileCoverage(relative, { statements = 2, executed = statements, calls = executed ? 1 : 0, functions = 1 } = {}) {
  const file = path.join(ROOT, ...relative.split("/"));
  const statementMap = {};
  const s = {};
  for (let index = 0; index < statements; index++) {
    statementMap[index] = { start: { line: index + 1, column: 0 }, end: { line: index + 1, column: 1 } };
    s[index] = index < executed ? 1 : 0;
  }
  const fnMap = {};
  const f = {};
  for (let index = 0; index < functions; index++) {
    const loc = { start: { line: 1, column: index }, end: { line: 1, column: index + 1 } };
    fnMap[index] = { name: `fn${index}`, decl: loc, loc, line: 1 };
    f[index] = calls;
  }
  return { path: file, statementMap, s, fnMap, f, branchMap: {}, b: {} };
}

function mapOf(entries) {
  const map = createCoverageMap({});
  for (const entry of entries) map.addFileCoverage(entry);
  return map;
}

const SENTINELS = ["src/index.js", "src/element/room-climate-card.js"];
const executedBundle = () => mapOf(SENTINELS.map((file) => fileCoverage(file)));

// ------------------------------------------------------------------ execution guard --

test("the bundle-only modules are the execution sentinels, checked in every layer that loads the bundle", () => {
  assert.deepEqual([...merge.BUNDLE_SENTINELS], SENTINELS);
  assert.deepEqual([...merge.BUNDLE_LAYERS], ["bundle", "surface", "browser"]);
});

test("a layer that loads the bundle and executed it passes", () => {
  assert.doesNotThrow(() => merge.enforceExecution({ unit: mapOf([]), bundle: executedBundle(), surface: executedBundle(), browser: executedBundle() }));
});

// The unit layer never loads the bundle, so its zero is expected and not checked.
test("a bundle layer that never executed a bundle-only module fails, naming layer and file", () => {
  const blind = mapOf([fileCoverage("src/index.js", { executed: 0 }), fileCoverage("src/element/room-climate-card.js")]);
  assert.throws(
    () => merge.enforceExecution({ unit: mapOf([]), bundle: blind, surface: executedBundle(), browser: executedBundle() }),
    (error) => {
      assert.match(error.message, /bundle/);
      assert.match(error.message, /src\/index\.js/);
      assert.doesNotMatch(error.message, /surface|browser/);
      return true;
    }
  );
  const absent = mapOf([fileCoverage("src/index.js")]);
  assert.throws(() => merge.enforceExecution({ unit: mapOf([]), bundle: executedBundle(), surface: absent, browser: executedBundle() }), /surface[\s\S]*src\/element\/room-climate-card\.js/);
});

// What c8's own remap of the vm bundle (--exclude-after-remap) produces: every line counted as
// executed and not one function mapped. Every bundle layer creates cards, so the element module
// always has a called function.
test("a layer that counts statements but called no function of the card element is over-reporting", () => {
  const overReported = mapOf([fileCoverage("src/index.js", { functions: 0 }), fileCoverage("src/element/room-climate-card.js", { functions: 0 })]);
  assert.throws(
    () => merge.enforceExecution({ unit: mapOf([]), bundle: overReported, surface: executedBundle(), browser: executedBundle() }),
    /bundle coverage called no function of src\/element\/room-climate-card\.js/
  );
  const uncalled = mapOf([fileCoverage("src/index.js"), fileCoverage("src/element/room-climate-card.js", { calls: 0 })]);
  assert.throws(() => merge.enforceExecution({ unit: mapOf([]), bundle: executedBundle(), surface: uncalled, browser: executedBundle() }), /surface coverage called no function/);
});

// ------------------------------------------------------------------------ inventory --

test("every layer and the merge must cover the whole src/ inventory, the fourth layer included", () => {
  const inventory = ["src/a.js", "src/b.js"];
  const full = () => mapOf(inventory.map((file) => fileCoverage(file)));
  const layers = { unit: full(), bundle: full(), surface: full(), browser: full() };
  assert.doesNotThrow(() => merge.enforceInventories(layers, full(), inventory));
  const short = { ...layers, surface: mapOf([fileCoverage("src/a.js")]) };
  assert.throws(() => merge.enforceInventories(short, full(), inventory), /surface coverage does not cover the src\/ inventory[\s\S]*missing from surface:\s*src\/b\.js/);
});

// -------------------------------------------------------------------------- floor --

test("the merged floor is enforced metric by metric", () => {
  const floor = merge.MERGED_THRESHOLDS;
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    assert.ok(Number.isInteger(floor[metric]) && floor[metric] >= 75 && floor[metric] <= 100, `${metric}: ${floor[metric]}`);
  }
  assert.ok(Object.isFrozen(floor));
  const half = mapOf([fileCoverage("src/a.js", { statements: 4, executed: 2 })]);
  assert.throws(() => merge.enforceThresholds(half, { statements: 60 }), /statements: 50% < 60%/);
  assert.doesNotThrow(() => merge.enforceThresholds(half, { statements: 50 }));
});

// ------------------------------------------------------------ artifact vs measurement build --

test("the shipped artifact is the file itself outside a coverage build", () => {
  const source = "/* banner */\n(function () {\n})();\n";
  assert.equal(shippedSource(source, false), source);
  const withTrailer = `${source}${COVERAGE_MAP_TRAILER}eyJ2IjozfQ==\n`;
  assert.equal(shippedSource(withTrailer, false), withTrailer, "outside coverage a source map stays visible to the artifact tests");
});

test("inside a coverage build exactly the one appended inline map is removed", () => {
  const source = "/* banner */\n(function () {\n})();\n";
  assert.equal(shippedSource(`${source}${COVERAGE_MAP_TRAILER}eyJ2IjozfQ==\n`, true), source);
  assert.equal(shippedSource(`${source}${COVERAGE_MAP_TRAILER}eyJ2IjozfQ==`, true), source);
  assert.throws(() => shippedSource(source, true), /no inline source map/);
  assert.throws(() => shippedSource(`${COVERAGE_MAP_TRAILER}a\n${source}${COVERAGE_MAP_TRAILER}b\n`, true), /more than one/);
  assert.throws(() => shippedSource(`${source}${COVERAGE_MAP_TRAILER}a\n// after\n`, true), /last line/);
});

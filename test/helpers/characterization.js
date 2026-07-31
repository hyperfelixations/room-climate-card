"use strict";

// Characterization ("golden master") harness. Its purpose is to pin the current
// observable behaviour of room-climate-card.js as committed baseline files.
//
// The existing unit suite asserts INTENDED behaviour (a human wrote down what
// should happen). These baselines assert ACTUAL behaviour verbatim — every
// number, every whitespace character of the rendered markup, every byte of
// the emitted CSS. That is deliberately over-specified: during a pure
// an unintended change is exactly what must fail, even when it
// would look harmless to a behavioural assertion.
//
// Visual/layout contracts are NOT duplicated here — test/browser/
// visual-golden.spec.js already owns them with real Chromium screenshots,
// and jsdom has no layout engine at all (getBoundingClientRect() is always
// zero). This harness covers the contracts that demonstrably had no
// verbatim coverage for the frozen flat DTO, the shadow-DOM markup,
// the generated CSS, the custom-element/HACS registration, the exact
// diagnostic strings, and the wall-clock carousel timing.
//
// Determinism requirements (all three are load-bearing):
//   1. TZ is pinned to UTC before anything constructs an Intl formatter —
//      _formatTime() renders range_entity timestamps in LOCAL time, so an
//      unpinned TZ would make the baselines machine-dependent. node:test
//      runs every test file in its own process, so this assignment is
//      scoped to the characterization files that require this helper.
//   2. Date.now() is frozen inside the jsdom realm — _slideTiming() derives
//      the CSS animation-delay from wall-clock time, and that value ends up
//      in the captured markup.
//   3. Object keys are sorted and non-JSON values (functions, ±Infinity,
//      NaN, -0, undefined) get explicit textual markers before serialization.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTestEnvironment } = require("./load-card.jsdom.js");

// Fixed wall clock for every capture. 1750000000000 = 2025-06-15T14:26:40Z.
// Chosen only for being a round, reproducible constant; the card's phase math
// is `Date.now() % cycleMs`, so any fixed value works as long as it never
// changes again.
const FROZEN_NOW_MS = 1750000000000;

const BASELINE_DIR = path.join(__dirname, "..", "baseline");
const UPDATE_BASELINES = process.env.UPDATE_CHARACTERIZATION === "1";

// One jsdom realm with the card loaded and its clock frozen. Same contract as
// createTestEnvironment() (see load-card.jsdom.js), plus the frozen clock and
// a console recorder.
function createFrozenEnvironment() {
  const env = createTestEnvironment();
  env.window.Date.now = () => FROZEN_NOW_MS;
  return env;
}

// Records everything the card writes to console.warn/console.error inside the
// jsdom realm. Returns a handle with the collected lines and a restore().
function recordConsole(env) {
  const view = env.window;
  const original = { warn: view.console.warn, error: view.console.error };
  const warnings = [];
  const errors = [];
  view.console.warn = (...args) => warnings.push(args.map(String).join(" "));
  view.console.error = (...args) => errors.push(args.map(String).join(" "));
  return {
    warnings,
    errors,
    restore() {
      view.console.warn = original.warn;
      view.console.error = original.error;
    },
  };
}

// Rewrites a value into something JSON can represent losslessly-enough for a
// baseline diff, with a stable key order. Cross-realm safe: only Object.keys/
// Array.isArray are used, never instanceof.
function normalizeForBaseline(value) {
  if (typeof value === "function") return "[Function]";
  if (value === undefined) return "[undefined]";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "[NaN]";
    if (value === Infinity) return "[Infinity]";
    if (value === -Infinity) return "[-Infinity]";
    if (Object.is(value, -0)) return "[-0]";
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeForBaseline);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalizeForBaseline(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(normalizeForBaseline(value), null, 2)}\n`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Splits the single <style> block out of the shadow root's markup. The CSS is
// pinned separately and in full by characterization-styles.test.js; carrying
// its ~30 KB into every DOM baseline as well would make those files unusable
// for review, so the markup baseline references it by digest instead.
function captureShadowMarkup(el) {
  const html = el.shadowRoot.innerHTML;
  const open = html.indexOf("<style>");
  const close = html.indexOf("</style>");
  if (open === -1 || close === -1) {
    return { markup: html, css: "", cssSha256: null };
  }
  const css = html.slice(open + "<style>".length, close);
  const markup = `${html.slice(0, open)}<style>[[css sha256:${sha256(css)}]]</style>${html.slice(close)}`;
  return { markup, css, cssSha256: sha256(css) };
}

function baselinePath(name) {
  return path.join(BASELINE_DIR, name);
}

function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const max = Math.max(expectedLines.length, actualLines.length);
  for (let i = 0; i < max; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      return [
        `first difference at line ${i + 1}:`,
        `  baseline: ${JSON.stringify(expectedLines[i])}`,
        `  current : ${JSON.stringify(actualLines[i])}`,
      ].join("\n");
    }
  }
  return "files differ only in trailing content length";
}

// Compares `actual` against the committed baseline file, or (re)writes it when
// UPDATE_CHARACTERIZATION=1. Regenerating baselines is an explicit, reviewable
// act: the diff of test/baseline/ IS the behaviour change.
function expectBaseline(name, actual) {
  const file = baselinePath(name);
  if (UPDATE_BASELINES) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual, "utf8");
    return;
  }
  if (!fs.existsSync(file)) {
    assert.fail(
      `Missing characterization baseline "${name}".\n` +
        `Generate it once with: npm run characterize:update`
    );
  }
  const expected = fs.readFileSync(file, "utf8");
  if (expected === actual) return;
  assert.fail(
    `Characterization baseline "${name}" changed.\n` +
      `${firstDifference(expected, actual)}\n\n` +
      `If (and only if) this change is intended, regenerate with:\n` +
      `  npm run characterize:update\n` +
      `and review the resulting diff in test/baseline/.`
  );
}

module.exports = {
  FROZEN_NOW_MS,
  BASELINE_DIR,
  UPDATE_BASELINES,
  createFrozenEnvironment,
  recordConsole,
  normalizeForBaseline,
  stableStringify,
  sha256,
  captureShadowMarkup,
  expectBaseline,
};

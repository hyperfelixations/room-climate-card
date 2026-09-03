"use strict";

// Characterization ("golden master") harness: pins the current observable behaviour of
// room-climate-card.js as committed baseline files, verbatim down to whitespace and CSS
// bytes, so an unintended change during a refactor fails even when a behavioural assertion
// would let it pass. Visual/layout contracts live in test/browser/visual-golden.spec.js
// instead; jsdom has no layout engine. Contract: see internal dev doc §4 "Baseline- und
// Golden-Vertrag".
//
// Determinism requirements, all load-bearing:
//   1. TZ is pinned to UTC before any Intl formatter is built — timestamps render in local
//      time, so an unpinned TZ makes baselines machine-dependent. node:test runs each file
//      in its own process, so this assignment stays scoped to the characterization files.
//   2. Date.now() is frozen in the jsdom realm — the CSS animation-delay is derived from
//      wall-clock time and ends up in the captured markup.
//   3. Object keys are sorted and non-JSON values get explicit textual markers before
//      serialization.
process.env.TZ = "UTC";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTestEnvironment } = require("./load-card.jsdom.js");
const { normalizeForBaseline, stableStringify } = require("./baseline-serialization.js");

// Fixed wall clock for every capture (2025-06-15T14:26:40Z). The card's phase math is
// `Date.now() % cycleMs`, so any fixed value works as long as it never changes again.
const FROZEN_NOW_MS = 1750000000000;

const BASELINE_DIR = path.join(__dirname, "..", "baseline");
const UPDATE_BASELINES = process.env.UPDATE_CHARACTERIZATION === "1";

// createTestEnvironment() plus a frozen clock.
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

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Splits the single <style> block out of the shadow markup. The CSS is pinned in full by
// characterization-styles.test.js; the markup baseline references it by digest so the DOM
// baselines stay reviewable.
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

// Compares `actual` against the committed baseline, or rewrites it when
// UPDATE_CHARACTERIZATION=1. The diff of test/baseline/ is the behaviour change.
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

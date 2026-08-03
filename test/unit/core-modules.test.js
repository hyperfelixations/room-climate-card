"use strict";

// Direct unit tests for src/core/* — the layer with no project-internal
// dependencies.
//
// These primitives are tested through their owning modules rather than the custom
// element (numbers.parseNumericState(), color.rgba(), ...), which meant every assertion about
// them also dragged in jsdom, a shadow root and a full config/hass pair. They
// are pure functions and are tested as such here: no DOM, no card instance,
// no build artifact.
//
// The suite is CommonJS while src/ is ESM (see src/package.json), so the
// modules are pulled in with dynamic import() in a before hook.

const test = require("node:test");
const assert = require("node:assert/strict");


let numbers;
let text;
let color;
let easing;
let metadata;

test.before(async () => {
  color = await import("../../src/core/color.js");
  numbers = await import("../../src/core/numbers.js");
  text = await import("../../src/core/text.js");
  easing = await import("../../src/core/easing.js");
  metadata = await import("../../src/core/card-metadata.js");
});

// ---------------------------------------------------------------- numbers --

test("parseNumericState() accepts the numeric shapes Home Assistant actually delivers", () => {
  const { parseNumericState } = numbers;
  assert.equal(parseNumericState("21.5"), 21.5);
  assert.equal(parseNumericState("21,5"), 21.5, "comma decimal separator");
  assert.equal(parseNumericState(21.5), 21.5, "already a number");
  assert.equal(parseNumericState("  -3.25  "), -3.25, "surrounding whitespace");
  assert.equal(parseNumericState("+7"), 7);
  assert.equal(parseNumericState(".5"), 0.5);
  assert.equal(parseNumericState("1e3"), 1000, "exponent notation");
  assert.equal(parseNumericState("0"), 0);
});

test("parseNumericState() rejects every non-measurement, including numeric-looking garbage", () => {
  const { parseNumericState } = numbers;
  for (const invalid of ["", "unknown", "unavailable", "none", "null", "undefined", "UNAVAILABLE"]) {
    assert.equal(parseNumericState(invalid), null, `state "${invalid}"`);
  }
  // parseFloat() would return 25 and 12 here — the whole reason for the strict
  // format check.
  assert.equal(parseNumericState("25 °C"), null, "a unit suffix must not be silently dropped");
  assert.equal(parseNumericState("12abc"), null);
  assert.equal(parseNumericState("1.2.3"), null);
  assert.equal(parseNumericState("Infinity"), null);
  assert.equal(parseNumericState("NaN"), null);
  assert.equal(parseNumericState(null), null);
  assert.equal(parseNumericState(undefined), null);
  assert.equal(parseNumericState({}), null);
});

test("isUnavailableState() distinguishes HA absence sentinels from malformed values", () => {
  const { isUnavailableState } = numbers;
  for (const unavailable of [undefined, null, "", " unknown ", "UNAVAILABLE", "none", "null", "undefined"]) {
    assert.equal(isUnavailableState(unavailable), true, JSON.stringify(unavailable));
  }
  for (const invalid of ["not-a-number", "NaN", "25 °C", {}, 21]) {
    assert.equal(isUnavailableState(invalid), false, JSON.stringify(invalid));
  }
});

test("parseConfigNumber() refuses the type coercions Number() would allow", () => {
  const { parseConfigNumber } = numbers;
  assert.equal(parseConfigNumber(3), 3);
  assert.equal(parseConfigNumber("3"), 3);
  assert.equal(parseConfigNumber(" -2.5 "), -2.5);
  // Number(true) === 1 — a typo'd `room_columns: true` must not become 1.
  assert.equal(parseConfigNumber(true), null);
  assert.equal(parseConfigNumber(false), null);
  assert.equal(parseConfigNumber(null), null);
  assert.equal(parseConfigNumber([]), null);
  assert.equal(parseConfigNumber("3px"), null);
  assert.equal(parseConfigNumber("1e3"), null, "config values use plain decimal notation only");
  assert.equal(parseConfigNumber(Infinity), null);
  assert.equal(parseConfigNumber(NaN), null);
});

test("clamp() and percentInRange() map values onto a bounded scale", () => {
  const { clamp, percentInRange } = numbers;
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);

  assert.equal(percentInRange(20, 20, 30), 0);
  assert.equal(percentInRange(25, 20, 30), 50);
  assert.equal(percentInRange(30, 20, 30), 100);
  assert.equal(percentInRange(15, 20, 30), 0, "below the scale clamps, never goes negative");
  assert.equal(percentInRange(35, 20, 30), 100, "above the scale clamps");
  assert.equal(percentInRange(25, 20, 20), 0, "a degenerate scale must not divide by zero");
});

test("floorToStep()/ceilToStep() round outwards on a step grid, including negatives", () => {
  const { floorToStep, ceilToStep } = numbers;
  assert.equal(floorToStep(21.4, 1), 21);
  assert.equal(ceilToStep(21.4, 1), 22);
  assert.equal(floorToStep(-3.2, 1), -4);
  assert.equal(ceilToStep(-3.2, 1), -3);
  assert.equal(floorToStep(812, 200), 800);
  assert.equal(ceilToStep(812, 200), 1000);
  assert.equal(floorToStep(20, 5), 20, "an exact multiple stays put");
  assert.equal(ceilToStep(20, 5), 20);
});

// ------------------------------------------------------------------- text --

test("escapeHtml() neutralizes every character that could break out of markup", () => {
  const { escapeHtml } = text;
  assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
  assert.equal(escapeHtml("plain"), "plain");
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(null), "", "null renders as empty, never as \"null\"");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(21.5), "21.5");
  assert.equal(escapeHtml("a&b&c"), "a&amp;b&amp;c", "every occurrence, not just the first");
});

test("UNAVAILABLE_TEXT is the single presentation sentinel for absent measurements", () => {
  assert.equal(text.UNAVAILABLE_TEXT, "--");
});

test("isTwoUpperLetterLabel() accepts exactly two Unicode uppercase letters", () => {
  const { isTwoUpperLetterLabel } = text;
  assert.equal(isTwoUpperLetterLabel("WZ"), true);
  assert.equal(isTwoUpperLetterLabel("KÜ"), true, "non-ASCII uppercase counts");
  assert.equal(isTwoUpperLetterLabel("ЖК"), true, "Cyrillic uppercase counts");
  assert.equal(isTwoUpperLetterLabel("wz"), false);
  assert.equal(isTwoUpperLetterLabel("Wz"), false);
  assert.equal(isTwoUpperLetterLabel("W"), false);
  assert.equal(isTwoUpperLetterLabel("WZG"), false);
  assert.equal(isTwoUpperLetterLabel("W1"), false);
  assert.equal(isTwoUpperLetterLabel(""), false);
});

test("isTwoUpperLetterLabel() is stateless across repeated calls", () => {
  // Regression guard: a shared regex with a /g flag would alternate between
  // true and false here because of lastIndex.
  const { isTwoUpperLetterLabel } = text;
  for (let i = 0; i < 5; i++) assert.equal(isTwoUpperLetterLabel("WZ"), true, `call ${i + 1}`);
});

// ------------------------------------------------------------------ color --

test("isHexColor() accepts all four CSS hex lengths and nothing else", () => {
  const { isHexColor } = color;
  for (const valid of ["#abc", "#abcd", "#aabbcc", "#aabbccdd", "#ABC", "#AABBCC"]) {
    assert.equal(isHexColor(valid), true, valid);
  }
  for (const invalid of ["abc", "#ab", "#abcde", "#abcdefg", "red", "rgb(1,2,3)", "", "#", "#ghi"]) {
    assert.equal(isHexColor(invalid), false, JSON.stringify(invalid));
  }
});

test("isHexColor() is stateless across repeated calls", () => {
  const { isHexColor } = color;
  for (let i = 0; i < 5; i++) assert.equal(isHexColor("#aabbcc"), true, `call ${i + 1}`);
});

test("rgba() applies the requested alpha to every accepted colour form", () => {
  const { rgba } = color;
  assert.equal(rgba("#aabbcc", 0.5), "rgba(170,187,204,0.5)");
  assert.equal(rgba("#abc", 0.5), "rgba(170,187,204,0.5)", "3-digit expands");
  assert.equal(rgba("#abcd", 0.5), "rgba(170,187,204,0.5)", "4-digit ignores its own alpha");
  assert.equal(rgba("#aabbccdd", 0.5), "rgba(170,187,204,0.5)", "8-digit ignores its own alpha");
  assert.equal(rgba("#000000", 0.2), "rgba(0,0,0,0.2)");
  assert.equal(rgba("#ffffff", 1), "rgba(255,255,255,1)");
});

test("rgba() passes through already-transparent inputs and CSS variables", () => {
  const { rgba } = color;
  assert.equal(rgba("rgb(1,2,3)", 0.5), "rgb(1,2,3)", "an rgb() input keeps its own definition");
  assert.equal(rgba("rgba(1,2,3,0.9)", 0.5), "rgba(1,2,3,0.9)");
  assert.equal(
    rgba("var(--primary-color)", 0.2),
    "color-mix(in srgb, var(--primary-color) 20%, transparent)",
    "a CSS variable cannot be parsed, so transparency is expressed in CSS"
  );
});

test("rgba() degrades to an opaque-safe fallback for unusable input", () => {
  const { rgba } = color;
  assert.equal(rgba("nonsense", 0.3), "rgba(255,255,255,0.3)");
  assert.equal(rgba("#abcde", 0.3), "rgba(255,255,255,0.3)");
  assert.equal(rgba(null, 0.3), "rgba(255,255,255,0.3)");
  assert.equal(rgba(undefined, 0.3), "rgba(255,255,255,0.3)");
  assert.equal(rgba(42, 0.3), "rgba(255,255,255,0.3)");
});

// ----------------------------------------------------------------- easing --

test("the slide easing curve, its CSS spelling and its inversion stay in lockstep", () => {
  const { SLIDE_EASING, SLIDE_EASING_CSS, A11Y_FLIP_TIME_FRACTION, timeFractionForEasedProgress } = easing;
  assert.deepEqual({ ...SLIDE_EASING }, { x1: 0.45, y1: 0, x2: 0.16, y2: 1 });
  assert.equal(Object.isFrozen(SLIDE_EASING), true);
  assert.equal(SLIDE_EASING_CSS, "cubic-bezier(0.45,0,0.16,1)");
  assert.equal(
    A11Y_FLIP_TIME_FRACTION,
    timeFractionForEasedProgress(SLIDE_EASING, 0.5),
    "the exported constant must be the inversion of the exported curve"
  );
});

test("cubicBezierPoint() is anchored at both endpoints", () => {
  const { cubicBezierPoint, SLIDE_EASING } = easing;
  assert.deepEqual(cubicBezierPoint(SLIDE_EASING, 0), { x: 0, y: 0 });
  assert.deepEqual(cubicBezierPoint(SLIDE_EASING, 1), { x: 1, y: 1 });
});

test("timeFractionForEasedProgress() inverts the curve monotonically", () => {
  const { timeFractionForEasedProgress, cubicBezierPoint, SLIDE_EASING } = easing;
  let previous = -Infinity;
  for (const target of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    const t = timeFractionForEasedProgress(SLIDE_EASING, target);
    assert.ok(t > previous, `time fraction must increase with eased progress (target ${target})`);
    assert.ok(t >= 0 && t <= 1, `time fraction stays inside [0,1] (target ${target})`);
    previous = t;
  }
});

test("the spatial midpoint is far earlier than the temporal midpoint", () => {
  // The whole point of inverting the curve: at 50% of the visual motion only
  // ~35.4% of the slide's time has passed. Using 0.5 here was the original
  // accessibility bug.
  const { A11Y_FLIP_TIME_FRACTION } = easing;
  assert.ok(Math.abs(A11Y_FLIP_TIME_FRACTION - 0.35375) < 0.001, `got ${A11Y_FLIP_TIME_FRACTION}`);
  assert.ok(A11Y_FLIP_TIME_FRACTION < 0.5);
});

// --------------------------------------------------------------- metadata --

test("card metadata matches the package version", () => {
  const packageJson = require("../../package.json");
  assert.equal(metadata.CARD_TYPE, "room-climate-card");
  assert.equal(metadata.CARD_NAME, "Room Climate Card");
  assert.equal(metadata.CARD_VERSION, packageJson.version);
});

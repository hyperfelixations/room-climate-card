"use strict";

// Built-in classification boundaries, probed just below, on, and just above every
// threshold: a > vs >= error moves a reading one tier without moving it far. The colour
// helpers belong here too — HEX_COLOR_PATTERN accepts 3/4/6/8-digit hex and _rgba() must
// handle each length, both reached through the tier-to-colour path.
// Boundary: colour maths on its own is unit/domain/; here it runs through classification.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Import the owning module directly so each test names its actual subject.
let color;

let env;
let el;

test.before(async () => {
  internals = await loadCardInternals();
  color = await import("../../../src/core/color.js");
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card");
});
test.after(() => {
  env.cleanupAll();
});

// ---- HEX_COLOR_PATTERN via _getEntityClassification() ----

function classificationFor(valueColor) {
  env.document.body.appendChild(el);
  el.hass = mkHass({ "sensor.x": mkState("sensor.x", 22, { value_color: valueColor, value_level: "Test" }) });
  const result = internals.entityClassification(el, "sensor.x");
  el.remove();
  return result;
}

test("value_color: valid hex lengths (3/4/6/8) are accepted", () => {
  assert.equal(classificationFor("#abc").color, "#abc");
  assert.equal(classificationFor("#abcd").color, "#abcd");
  assert.equal(classificationFor("#aabbcc").color, "#aabbcc");
  assert.equal(classificationFor("#aabbccdd").color, "#aabbccdd");
});

test("value_color: invalid hex lengths (5/7) invalidate the complete entity classification", () => {
  assert.equal(classificationFor("#aabbc"), null); // 5
  assert.equal(classificationFor("#aabbccd"), null); // 7
});

test("value_color: non-hex garbage invalidates the complete entity classification (style injection attempt)", () => {
  assert.equal(classificationFor("red; color:black"), null);
  assert.equal(classificationFor("javascript:alert(1)"), null);
});

test("value_color: case-insensitive hex is accepted", () => {
  assert.equal(classificationFor("#ABCDEF").color, "#ABCDEF");
});

// ---- _rgba() ----

test("_rgba(): 3-digit hex expands correctly", () => {
  assert.equal(color.rgba("#fff", 0.5), "rgba(255,255,255,0.5)");
  assert.equal(color.rgba("#f00", 0.3), "rgba(255,0,0,0.3)");
});

test("_rgba(): 6-digit hex parses correctly", () => {
  assert.equal(color.rgba("#ff0000", 0.3), "rgba(255,0,0,0.3)");
  assert.equal(color.rgba("#00ff00", 1), "rgba(0,255,0,1)");
});

test("_rgba(): 4-digit hex uses only the RGB part, ignores the embedded alpha nibble", () => {
  assert.equal(color.rgba("#f00f", 0.3), "rgba(255,0,0,0.3)");
});

test("_rgba(): 8-digit hex uses only the RGB part, ignores the embedded alpha byte", () => {
  assert.equal(color.rgba("#ff0000ff", 0.3), "rgba(255,0,0,0.3)");
  assert.equal(color.rgba("#ff000000", 0.3), "rgba(255,0,0,0.3)", "even a fully-transparent embedded alpha is ignored — contract is 'this color at the given opacity'");
});

test("_rgba(): invalid length (5/7 digit) falls back to opaque-white rgba", () => {
  assert.equal(color.rgba("#aabbc", 0.5), "rgba(255,255,255,0.5)");
});

test("_rgba(): rgb()/rgba() input passes through unchanged", () => {
  assert.equal(color.rgba("rgb(1,2,3)", 0.5), "rgb(1,2,3)");
  assert.equal(color.rgba("rgba(1,2,3,0.9)", 0.5), "rgba(1,2,3,0.9)");
});

test("_rgba(): CSS var() input becomes a color-mix() expression", () => {
  assert.equal(color.rgba("var(--my-color)", 0.25), "color-mix(in srgb, var(--my-color) 25%, transparent)");
});

test("_rgba(): non-string input falls back to opaque-white rgba", () => {
  assert.equal(color.rgba(null, 0.5), "rgba(255,255,255,0.5)");
  assert.equal(color.rgba(undefined, 0.5), "rgba(255,255,255,0.5)");
  assert.equal(color.rgba(42, 0.5), "rgba(255,255,255,0.5)");
});

// ---- Built-in profile boundaries, all 4 modes, via _roomTone()/_avgTone() ----

function toneLabel(value, metricType) {
  return internals.fallbackTone(el, value, metricType).label;
}

// Tiers match top-to-bottom by descending `min`, first `value >= tier.min` wins
// (`value > tier.min` for pm25's exclusive table). A tier's own min belongs to that tier:
// temperature 23 starts "Slightly warm", so "Optimal" is 21 <= value < 23.
test("temperature thresholds: boundary values classify into the documented tiers", () => {
  assert.equal(toneLabel(21, "temperature"), "Optimal");
  assert.equal(toneLabel(22.99, "temperature"), "Optimal");
  assert.equal(toneLabel(20.99, "temperature"), "Slightly cool");
  assert.equal(toneLabel(23, "temperature"), "Slightly warm");
  assert.equal(toneLabel(24, "temperature"), "Warm");
  assert.equal(toneLabel(28, "temperature"), "Very hot");
  assert.equal(toneLabel(27.99, "temperature"), "Hot");
  assert.equal(toneLabel(16, "temperature"), "Cold");
  assert.equal(toneLabel(15.99, "temperature"), "Very cold");
});

test("humidity thresholds: boundary values classify into the documented tiers", () => {
  assert.equal(toneLabel(50, "humidity"), "Optimal");
  assert.equal(toneLabel(57.99, "humidity"), "Optimal");
  assert.equal(toneLabel(58, "humidity"), "Slightly humid");
  assert.equal(toneLabel(75, "humidity"), "Critically humid");
  assert.equal(toneLabel(74.99, "humidity"), "Too humid");
});

test("co2 thresholds: boundary values classify into the documented tiers (value must be > 0, see invalidWhen below)", () => {
  assert.equal(toneLabel(2000, "co2"), "Critical");
  assert.equal(toneLabel(1999.99, "co2"), "Very high");
  assert.equal(toneLabel(1, "co2"), "Optimal");
  assert.equal(toneLabel(799.99, "co2"), "Optimal");
  assert.equal(toneLabel(800, "co2"), "Slightly elevated");
});

test("co2 invalidWhen: a negative reading classifies as an invalid reading, not 'Optimal'", () => {
  assert.notEqual(toneLabel(-5, "co2"), "Optimal");
  assert.equal(toneLabel(0, "co2"), "Optimal", "zero ppm is a possible concentration, so it takes its tier like any other");
});

test("a pm25 threshold belongs to its own tier, like every other built-in profile's", () => {
  assert.equal(toneLabel(0, "pm25"), "Optimal");
  assert.equal(toneLabel(9999, "pm25"), "Critical");
  assert.equal(toneLabel(50, "pm25"), "Critical", "the threshold itself is the tier it names");
  assert.equal(toneLabel(49.99, "pm25"), "Very high");
});

test("pm25 invalidWhen: negative readings classify as invalid, and 0 like any other reading", () => {
  assert.notEqual(toneLabel(-1, "pm25"), "Optimal");
  assert.equal(toneLabel(0, "pm25"), "Optimal", "0 µg/m³ is what clean air reads");
});

test("temperature invalidWhen: below absolute zero classifies as invalid, the limit itself does not", () => {
  assert.notEqual(toneLabel(-274, "temperature"), toneLabel(-273.15, "temperature"));
  assert.equal(toneLabel(-274, "temperature"), toneLabel(-1000, "temperature"), "everything past the limit is one answer");
});

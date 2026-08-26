"use strict";

// _parseNum() uses strict numeric parsing so junk such as "25 °C" or "12abc"
// cannot be accepted through a numeric prefix. The matrix covers
// unknown/unavailable/none/null/empty, "12abc", "25 °C",
// "1,5", ".5", "1e3", "1.", whitespace.
//
// _parseNum() is only reachable indirectly (through _getNum()/_getAttrNum(),
// which need a hass/entity), so these tests drive it through a minimal
// average-entity config rather than calling a private method directly —
// this also exercises the exact code path a real Home Assistant state
// update goes through.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function parseAsAvg(rawState) {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", rawState, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  env.cleanup(el);
  return data.empty ? null : data.average.value;
}

test("invalid states are rejected: unknown/unavailable/none/null/undefined/empty", () => {
  for (const raw of ["unknown", "unavailable", "none", "null", "undefined", ""]) {
    assert.equal(parseAsAvg(raw), null, `state "${raw}" must be treated as invalid`);
  }
});

test("comma decimal separator is accepted", () => {
  assert.equal(parseAsAvg("21,5"), 21.5);
});

test("dot decimal separator is accepted", () => {
  assert.equal(parseAsAvg("21.5"), 21.5);
});

test("leading-dot decimals are accepted (.5)", () => {
  assert.equal(parseAsAvg(".5"), 0.5);
});

test("scientific notation is accepted (1e3)", () => {
  assert.equal(parseAsAvg("1e3"), 1000);
});

test("a bare trailing dot is rejected (1.)", () => {
  assert.equal(parseAsAvg("1."), null);
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(parseAsAvg("  21.5  "), 21.5);
});

test("a numeric prefix followed by junk is rejected, not silently truncated (12abc)", () => {
  assert.equal(parseAsAvg("12abc"), null);
});

test("a numeric value followed by a unit suffix is rejected (25 °C)", () => {
  assert.equal(parseAsAvg("25 °C"), null);
});

test("a plain integer state is accepted", () => {
  assert.equal(parseAsAvg("22"), 22);
});

test("a negative number is accepted where physically valid (temperature has no lower floor)", () => {
  assert.equal(parseAsAvg("-5.5"), -5.5);
});

test("a plus-signed number is accepted", () => {
  assert.equal(parseAsAvg("+3"), 3);
});

test("multiple decimal points are rejected (1.2.3)", () => {
  assert.equal(parseAsAvg("1.2.3"), null);
});

test("a number that is actually delivered as a JS number (not string) still works", () => {
  // Home Assistant sometimes delivers already-numeric attribute values;
  // states themselves are always strings, but this guards the underlying
  // _parseNum() contract that _getAttrNum() also relies on.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.min, 18);
  assert.equal(data.range.max, 24);
  env.cleanup(el);
});

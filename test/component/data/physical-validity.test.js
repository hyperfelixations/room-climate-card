"use strict";

// What a reading cannot physically BE, for each of the four measurements, and what the
// card does with one that says it anyway: excluded from the whole data pipeline (average,
// extrema, comfort counting, spread) through _isPhysicallyValid(), not merely recoloured
// grey — a faulty sensor must not pull the room average or supply a bogus "coolest room".
//
// ONE RULE ACROSS ALL FOUR: the limit itself is a reading, everything past it is not.
// A concentration of 0 and a humidity of 0 % or 100 % are legitimate; a negative
// concentration, a humidity outside 0-100 and a temperature below absolute zero are not.
//
// Temperature is the one whose limit needs converting, and that is what makes it worth its
// own cases: the profile states -273.15 in Celsius, and a card reading Fahrenheit or Kelvin
// has to reject the same PHYSICAL readings, not the same numbers.
//
// Absolute values, range state and trend rates intentionally have distinct validity rules.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { CO2, HUMIDITY, PM25, TEMPERATURE_C, TEMPERATURE_F, TEMPERATURE_K } = require("../../fixtures/attributes.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("_isPhysicallyValid: co2 below 0 is invalid, 0 and above is valid", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -1, "co2"), false);
  assert.equal(internals.isPhysicallyValid(el, 0, "co2"), true, "a concentration of zero is possible, if unusual indoors");
  assert.equal(internals.isPhysicallyValid(el, 1, "co2"), true);
  assert.equal(internals.isPhysicallyValid(el, 400, "co2"), true);
});

test("_isPhysicallyValid: pm25 < 0 is invalid, pm25 >= 0 is valid (0 is a legitimate reading)", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -1, "pm25"), false);
  assert.equal(internals.isPhysicallyValid(el, 0, "pm25"), true);
  assert.equal(internals.isPhysicallyValid(el, 12, "pm25"), true);
});

test("_isPhysicallyValid: temperature below absolute zero is invalid, everything above it is not", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -40, "temperature"), true);
  assert.equal(internals.isPhysicallyValid(el, -273.15, "temperature"), true, "the limit itself is a reading");
  assert.equal(internals.isPhysicallyValid(el, -273.16, "temperature"), false);
  assert.equal(internals.isPhysicallyValid(el, -274, "temperature"), false);
  assert.equal(internals.isPhysicallyValid(el, -1e6, "temperature"), false);
});

test("_isPhysicallyValid: humidity outside [0,100] is invalid", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -1, "humidity"), false);
  assert.equal(internals.isPhysicallyValid(el, 101, "humidity"), false);
  assert.equal(internals.isPhysicallyValid(el, 0, "humidity"), true, "0% is a legitimate (if extreme) reading");
  assert.equal(internals.isPhysicallyValid(el, 100, "humidity"), true, "100% is a legitimate (if extreme) reading");
  assert.equal(internals.isPhysicallyValid(el, 45, "humidity"), true);
});

test("a humidity room reading below 0% or above 100% is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 50, HUMIDITY),
    "sensor.r1": mkState("sensor.r1", -5, HUMIDITY), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 40, HUMIDITY),
    "sensor.r3": mkState("sensor.r3", 60, HUMIDITY),
    "sensor.r4": mkState("sensor.r4", 105, HUMIDITY), // faulty sensor
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "TooLow", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }, { name: "TooHigh", entity: "sensor.r4" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2, "only 2 of 4 rooms are physically valid");
  assert.equal(data.extremes.coolest.name, "R2");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a humidity primary (average) entity reading of -1% is rejected — falls back to the room average", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -1, HUMIDITY),
    "sensor.r1": mkState("sensor.r1", 40, HUMIDITY),
    "sensor.r2": mkState("sensor.r2", 60, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.average.source, "calculated", "the invalid -1% primary reading must not be used directly");
  assert.equal(data.average.value, 50, "falls back to the mean of the 2 valid rooms");
  env.cleanup(el);
});

test("a negative CO2 room reading is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, CO2),
    "sensor.r1": mkState("sensor.r1", -50, CO2), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 600, CO2),
    "sensor.r3": mkState("sensor.r3", 800, CO2),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ name: "Faulty", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2, "only 2 of 3 rooms are physically valid");
  assert.equal(data.extremes.coolest.name, "R2", "the faulty room must never be picked as coolest");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a CO2 room reading of exactly 0 counts, because nothing about it is impossible", () => {
  // The card judges what a reading CAN be, not whether a sensor looks healthy. A CO2
  // sensor stuck at zero is a stale reading, which is a different question with a
  // different answer, and answering it here would cost the legitimate readings too.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, CO2),
    "sensor.r1": mkState("sensor.r1", 0, CO2),
    "sensor.r2": mkState("sensor.r2", 600, CO2),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ name: "R1", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2);
  assert.equal(data.extremes.coolest.name, "R1");
  env.cleanup(el);
});

test("a negative PM2.5 room reading is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 10, PM25),
    "sensor.r1": mkState("sensor.r1", -5, PM25), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 8, PM25),
    "sensor.r3": mkState("sensor.r3", 12, PM25),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ name: "Faulty", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2);
  assert.equal(data.extremes.coolest.name, "R2");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a negative CO2 primary (average) entity reading is rejected — falls back to the room average", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -20, CO2),
    "sensor.r1": mkState("sensor.r1", 600, CO2),
    "sensor.r2": mkState("sensor.r2", 800, CO2),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.average.source, "calculated", "the invalid negative primary reading must not be used directly");
  assert.equal(data.average.value, 700, "falls back to the mean of the 2 valid rooms");
  env.cleanup(el);
});

test("all CO2 room readings physically invalid + no valid primary entity -> no-data state, not a crash or a 0/negative display", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -1, CO2),
    "sensor.r1": mkState("sensor.r1", -5, CO2),
    "sensor.r2": mkState("sensor.r2", -10, CO2),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.empty, true);
  env.cleanup(el);
});

// ==== temperature, in every unit the card reads ====
// The limit is stated once, in Celsius, on the profile. A card reading Fahrenheit or
// Kelvin has to reject the same PHYSICAL readings — which is a different set of NUMBERS,
// and the reason the limit travels as a range that gets converted rather than as a bare
// comparison against -273.15.

test("a temperature room below absolute zero is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", -300, TEMPERATURE_C), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 20, TEMPERATURE_C),
    "sensor.r3": mkState("sensor.r3", 22, TEMPERATURE_C),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "Faulty", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2, "only 2 of 3 rooms are physically valid");
  assert.equal(data.extremes.coolest.name, "R2", "-300 °C must never be picked as the coolest room");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a temperature primary below absolute zero is rejected — falls back to the room average", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -274, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 22, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.average.source, "calculated", "an impossible primary reading must not be used directly");
  assert.equal(data.average.value, 21);
  env.cleanup(el);
});

test("the absolute-zero limit is converted, so a Fahrenheit card rejects the same physical readings", () => {
  // -300 °F is -184 °C: absurdly cold for a room, and perfectly possible. A limit compared
  // against the Celsius number would throw it away, which is the mistake this guards.
  const cold = env.createCard({ entity: "sensor.avg" }, mkHass({ "sensor.avg": mkState("sensor.avg", -300, TEMPERATURE_F) }));
  assert.equal(cold._computeViewModel().empty, false, "-300 °F is above absolute zero and is a reading");
  env.cleanup(cold);

  const impossible = env.createCard({ entity: "sensor.avg" }, mkHass({ "sensor.avg": mkState("sensor.avg", -500, TEMPERATURE_F) }));
  assert.equal(impossible._computeViewModel().empty, true, "-500 °F is below absolute zero");
  env.cleanup(impossible);
});

test("a Kelvin card reads 0 K and rejects everything below it", () => {
  const zero = env.createCard({ entity: "sensor.avg" }, mkHass({ "sensor.avg": mkState("sensor.avg", 0, TEMPERATURE_K) }));
  assert.equal(zero._computeViewModel().empty, false, "0 K is the limit itself, which is a reading");
  env.cleanup(zero);

  const negative = env.createCard({ entity: "sensor.avg" }, mkHass({ "sensor.avg": mkState("sensor.avg", -1, TEMPERATURE_K) }));
  assert.equal(negative._computeViewModel().empty, true, "a negative Kelvin reading is not a temperature");
  env.cleanup(negative);
});

// Range state and trend validity: hasRange/hasRangeScale
// axis and trendValue are exempt from _isPhysicallyValid() by design (they
// are deltas/day-spans, not absolute concentration readings — see
// the range model's own comment on min/max) — DATA-02's negative-range
// concern for those is separately covered by DATA-02/DATA-03's own sign
// checks (range-and-spread.test.js), not the physical-plausibility filter.
test("a CO2 trend value is not filtered by _isPhysicallyValid() (a negative trend is a legitimate falling rate, not an invalid reading)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, CO2),
    "sensor.r1": mkState("sensor.r1", 600, CO2),
    "sensor.r2": mkState("sensor.r2", 800, CO2),
    "sensor.trend": mkState("sensor.trend", -15, { unit_of_measurement: "ppm/h" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", trend_entity: "sensor.trend", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.equal(data.trend.value, -15, "a negative trend (falling CO2) must be shown as-is, not filtered out");
  env.cleanup(el);
});

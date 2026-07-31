"use strict";

// Physically implausible CO2 (<= 0) and PM2.5 (< 0)
// readings must be excluded from the whole data pipeline (average, extrema,
// comfort counting, spread) via _isPhysicallyValid(), not just recolored
// grey — a stuck/faulty sensor must not silently pull the room average or
// pick a bogus "coolest room". Absolute values, range state and trend rates
// intentionally have distinct validity rules.
//
// Humidity below 0% or above 100% is likewise excluded by its profile.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

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

test("_isPhysicallyValid: co2 <= 0 is invalid, co2 > 0 is valid", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, 0, "co2"), false);
  assert.equal(internals.isPhysicallyValid(el, -1, "co2"), false);
  assert.equal(internals.isPhysicallyValid(el, 1, "co2"), true);
  assert.equal(internals.isPhysicallyValid(el, 400, "co2"), true);
});

test("_isPhysicallyValid: pm25 < 0 is invalid, pm25 >= 0 is valid (0 is a legitimate reading)", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -1, "pm25"), false);
  assert.equal(internals.isPhysicallyValid(el, 0, "pm25"), true);
  assert.equal(internals.isPhysicallyValid(el, 12, "pm25"), true);
});

test("_isPhysicallyValid: temperature has no invalidWhen — always valid, including very negative readings", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(internals.isPhysicallyValid(el, -40, "temperature"), true);
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
    "sensor.avg": mkState("sensor.avg", 50, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.r1": mkState("sensor.r1", -5, { device_class: "humidity", unit_of_measurement: "%" }), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 40, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.r3": mkState("sensor.r3", 60, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.r4": mkState("sensor.r4", 105, { device_class: "humidity", unit_of_measurement: "%" }), // faulty sensor
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
    "sensor.avg": mkState("sensor.avg", -1, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.r1": mkState("sensor.r1", 40, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.r2": mkState("sensor.r2", 60, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.average.source, "calculated", "the invalid -1% primary reading must not be used directly");
  assert.equal(data.average.value, 50, "falls back to the mean of the 2 valid rooms");
  env.cleanup(el);
});

test("a CO2 room reading of exactly 0 is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r1": mkState("sensor.r1", 0, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }), // stuck sensor
    "sensor.r2": mkState("sensor.r2", 600, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r3": mkState("sensor.r3", 800, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ name: "Stuck", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2, "only 2 of 3 rooms are physically valid");
  assert.equal(data.extremes.coolest.name, "R2", "the stuck 0-reading room must never be picked as coolest");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a negative PM2.5 room reading is excluded from the room average, extrema, and comfort count", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 10, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
    "sensor.r1": mkState("sensor.r1", -5, { device_class: "pm25", unit_of_measurement: "µg/m³" }), // faulty sensor
    "sensor.r2": mkState("sensor.r2", 8, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
    "sensor.r3": mkState("sensor.r3", 12, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ name: "Faulty", entity: "sensor.r1" }, { name: "R2", entity: "sensor.r2" }, { name: "R3", entity: "sensor.r3" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2);
  assert.equal(data.extremes.coolest.name, "R2");
  assert.equal(data.extremes.warmest.name, "R3");
  env.cleanup(el);
});

test("a CO2 primary (average) entity reading of 0 is rejected — falls back to the room average instead of displaying 0", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 0, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r1": mkState("sensor.r1", 600, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r2": mkState("sensor.r2", 800, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.average.source, "calculated", "the invalid 0 primary reading must not be used directly");
  assert.equal(data.average.value, 700, "falls back to the mean of the 2 valid rooms");
  env.cleanup(el);
});

test("all CO2 room readings physically invalid + no valid primary entity -> empty state, not a crash or a 0/negative display", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -1, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r1": mkState("sensor.r1", 0, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r2": mkState("sensor.r2", -10, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.empty, true);
  env.cleanup(el);
});

// Range state and trend validity: hasRange/hasRangeScale
// axis and trendValue are exempt from _isPhysicallyValid() by design (they
// are deltas/day-spans, not absolute concentration readings — see
// the range model's own comment on min/max) — DATA-02's negative-range
// concern for those is separately covered by DATA-02/DATA-03's own sign
// checks (range-and-spread.test.js), not the physical-plausibility filter.
test("a CO2 trend value is not filtered by _isPhysicallyValid() (a negative trend is a legitimate falling rate, not an invalid reading)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r1": mkState("sensor.r1", 600, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.r2": mkState("sensor.r2", 800, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
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

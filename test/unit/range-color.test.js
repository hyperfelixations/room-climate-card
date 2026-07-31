"use strict";

// CORR-01 (v2.15.0 audit): the daily minimum/maximum cards must be colored
// from their own numeric value, never from the range_entity's own current
// value_color/value_level attributes (which describe its *current* reading,
// not the historical min/max being displayed) — otherwise both cards could
// wrongly inherit one shared, unrelated color.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("rangeMinColor/rangeMaxColor never equal the range_entity's own current value_color", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 7, { unit_of_measurement: "°C", minimum: 18, maximum: 25, value_color: "#ff00ff", value_level: "Whatever" }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.notEqual(data.range.minColor, "#ff00ff");
  assert.notEqual(data.range.maxColor, "#ff00ff");
  env.cleanup(el);
});

test("18°C (cool tier) and 25°C (very-warm tier) get distinct fallback colors, not one shared color", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 7, { unit_of_measurement: "°C", minimum: 18, maximum: 25, value_color: "#ff00ff" }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.notEqual(data.range.minColor, data.range.maxColor, `min(18°C) and max(25°C) must classify to different fallback tiers, got ${data.range.minColor} for both`);
  env.cleanup(el);
});

test("without a range_entity value_color at all, min/max are still classified purely numerically", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 7, { unit_of_measurement: "°C", minimum: 18, maximum: 25 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.ok(/^#[0-9a-f]{3,8}$/i.test(data.range.minColor), data.range.minColor);
  assert.ok(/^#[0-9a-f]{3,8}$/i.test(data.range.maxColor), data.range.maxColor);
  env.cleanup(el);
});

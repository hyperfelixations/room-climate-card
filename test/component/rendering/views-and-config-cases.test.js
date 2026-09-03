"use strict";

// Whole configurations, rendered — minimal, rooms-only, with a range entity, and all at
// once. What these exercise is the comparison in _render() between data.views.keys and the
// views currently on screen, which decides whether the card patches or rebuilds and is only
// reachable through a config that changes the view list. Representative, not exhaustive:
// the option grid is generated in test/property/; these four are what a person writes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE, TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const baseStates = {
  "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
  "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
  "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  "sensor.range": mkState("sensor.range", 3, {
    unit_of_measurement: "°C",
    minimum: 20,
    maximum: 23,
    minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
    maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
  }),
};
const hass = mkHass(baseStates);

test("Case A (entity only): views = [scale], no rotator", () => {
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.deepEqual(normalize(el._views), ["scale"]);
  assert.deepEqual(normalize(el._carousel.holdSequence()), []);
  env.cleanup(el);
});

test("Case B (entity + rooms): views = [scale, extremes]", () => {
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  assert.deepEqual(normalize(el._views), ["scale", "extremes"]);
  assert.deepEqual(normalize(el._carousel.holdSequence()), [0, 1]);
  env.cleanup(el);
});

test("Case C (entity + range_entity, no rooms): views = [range, scale]", () => {
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  assert.deepEqual(normalize(el._views), ["range", "scale"]);
  assert.deepEqual(normalize(el._carousel.holdSequence()), [0, 1]);
  env.cleanup(el);
});

test("Case D (entity + rooms + range_entity): views = [range, scale, extremes]", () => {
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  );
  assert.deepEqual(normalize(el._views), ["range", "scale", "extremes"]);
  assert.deepEqual(normalize(el._carousel.holdSequence()), [0, 1, 2, 1]);
  env.cleanup(el);
});

test("full config with range_scale resolves range, range_scale, scale, extremes", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }, { type: "extremes" }],
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    },
    hass
  );
  assert.deepEqual(normalize(el._views), ["range", "range_scale", "scale", "extremes"]);
  assert.deepEqual(normalize(el._carousel.holdSequence()), [0, 1, 2, 3, 2, 1], "old bug produced 2,3,2,0,2,1");
  env.cleanup(el);
});

test("views: range_scale enabled:true without a valid range_entity has no effect (stays Case B)", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      views: [{ type: "range_scale", enabled: true }, { type: "scale" }, { type: "extremes" }],
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    },
    hass
  );
  assert.deepEqual(normalize(el._views), ["scale", "extremes"]);
  env.cleanup(el);
});

test("roomsComparable requires >= 2 valid room values, not just >= 2 configured rooms", () => {
  const oneRoomHass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", "unavailable", TEMPERATURE),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, oneRoomHass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.comparable, false, "only 1 of 2 configured rooms is valid -> minimal mode");
  assert.deepEqual(normalize(el._views), ["scale"]);
  env.cleanup(el);
});

// _render() compares the complete views array (length changes and reorder at equal length).
// The comparison is inline in _render(); this helper mirrors it to test the algorithm alone.
function viewsChanged(currentViews, dataViews, dataEmpty) {
  return dataEmpty ? false : currentViews.length !== dataViews.length || dataViews.some((key, i) => key !== currentViews[i]);
}

test("viewsChanged: identical arrays -> false", () => {
  assert.equal(viewsChanged(["range", "scale"], ["range", "scale"], false), false);
});

test("viewsChanged: pure reorder at equal length -> true", () => {
  assert.equal(viewsChanged(["scale", "range"], ["range", "scale"], false), true);
});

test("viewsChanged: length change -> true", () => {
  assert.equal(viewsChanged(["scale"], ["range", "scale"], false), true);
  assert.equal(viewsChanged(["range", "scale", "extremes"], ["range", "scale"], false), true);
});

test("viewsChanged: no-data models always report false regardless of arrays", () => {
  assert.equal(viewsChanged(["range", "scale"], [], true), false);
  assert.equal(viewsChanged([], ["range", "scale"], true), false);
});

// A structural rebuild must fire on real config changes that affect the DOM/carousel,
// verified end to end by checking the structure changes across two setConfig() calls.
test("integration: a config change from Case A to Case B triggers a real structural rebuild (extremes view appears)", () => {
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.deepEqual(normalize(el._views), ["scale"]);
  assert.equal(Boolean(el.shadowRoot.querySelector(".rtc-extremes-view")), false);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  assert.deepEqual(normalize(el._views), ["scale", "extremes"]);
  assert.equal(Boolean(el.shadowRoot.querySelector(".rtc-extremes-view")), true);
  env.cleanup(el);
});

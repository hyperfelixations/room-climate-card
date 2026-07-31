"use strict";

// Configuration cases A/B/C/D (+ rangeScale) from "Ansichten und
// Konfigurationsfaelle" in the dev doc, and the generic data.views.keys vs
// this._views comparison formula from _render() (ARCH-01, audit section
// 9.5: "View-Struktur generisch vergleichen").

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const baseStates = {
  "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
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

test("Case D + views: range_scale enabled: views = [range, range_scale, scale, extremes], the exact audit counterexample config", () => {
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

test("hasRoomsView requires >= 2 valid room values, not just >= 2 configured rooms", () => {
  const oneRoomHass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", "unavailable", { device_class: "temperature" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, oneRoomHass);
  const data = el._computeViewModel();
  assert.equal(data.rooms.hasRoomsView, false, "only 1 of 2 configured rooms is valid -> minimal mode");
  assert.deepEqual(normalize(el._views), ["scale"]);
  env.cleanup(el);
});

// ARCH-01, audit section 9.5: _render()'s generic views-array comparison —
// replaces the old hasRange/hasRangeScale boolean-flag comparison, so it
// must catch length changes AND pure reordering at equal length. The
// comparison itself lives inline in _render(), not as a standalone method
// (see "Rendering und Robustheit" in the dev doc); replicated here from the
// exact source expression to test the algorithm in isolation.
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

test("viewsChanged: empty-state data always reports false regardless of arrays", () => {
  assert.equal(viewsChanged(["range", "scale"], [], true), false);
  assert.equal(viewsChanged([], ["range", "scale"], true), false);
});

// A structural rebuild (_renderAll()) must fire on real config changes that
// affect the DOM/carousel — verified end to end via _render()'s public
// entry point rather than the inline expression above, by checking the
// carousel structure actually changes across two setConfig() calls.
test("integration: a config change from Case A to Case B triggers a real structural rebuild (extremes view appears)", () => {
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.deepEqual(normalize(el._views), ["scale"]);
  assert.equal(Boolean(el.shadowRoot.querySelector(".rtc-extremes-view")), false);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  assert.deepEqual(normalize(el._views), ["scale", "extremes"]);
  assert.equal(Boolean(el.shadowRoot.querySelector(".rtc-extremes-view")), true);
  env.cleanup(el);
});

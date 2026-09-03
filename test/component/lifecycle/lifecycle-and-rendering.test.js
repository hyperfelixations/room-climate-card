"use strict";

// _render()'s signature is committed only after a render succeeds, so a thrown exception
// does not leave a "successful-looking" signature that suppresses a correct retry.
// LIFE-01: setConfig() cancels any in-progress pointer gesture atomically before applying
// the new config. Also covers no-data icon updates and retrying an identical update after
// a render error.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { HUMIDITY_CLASS_ONLY, TEMPERATURE, TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
// RENDER_PATH imported from source so tests name the same constants production does.
let RENDER_PATH;

test.before(async () => {
  ({ RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("ROB-01: a thrown _computeViewModel() does not commit the render signature, so an identical retry actually re-renders", () => {
  const hassA = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hassA);
  // An identical repeat is skipped, proving the first render committed. Asserted via the
  // render path, not the signature string.
  assert.equal(el._render(), RENDER_PATH.SKIPPED, "an unchanged repeat must be skipped, so the first render committed");

  const hassB = mkHass({ "sensor.avg": mkState("sensor.avg", 23, TEMPERATURE_C) });
  // _render() calls _computeViewModel() directly; failing the legacy-DTO adapter instead
  // would stop proving anything once the adapter is removed.
  const original = el._computeViewModel;
  let threw = false;
  el._computeViewModel = function () {
    threw = true;
    throw new Error("induced failure for ROB-01 test");
  };
  const originalConsoleError = env.window.console.error;
  const loggedErrors = [];
  env.window.console.error = (...args) => loggedErrors.push(args);
  el.hass = hassB; // triggers _render(); set hass()'s own try/catch must swallow the throw
  env.window.console.error = originalConsoleError;

  assert.ok(threw, "the induced failure must actually have been reached");
  assert.equal(loggedErrors.length, 1, "set hass()'s try/catch must log exactly once, not crash");
  el._computeViewModel = original;
  // The retry carries the data that just failed; a prematurely committed signature would
  // compare equal and skip it, freezing the card on stale content.
  assert.equal(el._render(), RENDER_PATH.CONTENT, "the retry must actually re-render, not be skipped as 'unchanged'");
  env.cleanup(el);
});

test("DOM-01: the no-data icon updates on a pure partial update (metric mode changes while staying empty)", () => {
  const states1 = { "sensor.avg": mkState("sensor.avg", "unavailable", TEMPERATURE) };
  const el = env.createCard({ entity: "sensor.avg" }, mkHass(states1));
  let iconEl = el.shadowRoot.querySelector(".rtc-icon-badge ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:thermometer-off");

  // device_class flips to humidity; last_updated is bumped explicitly because two mkState()
  // calls in the same millisecond would otherwise collide as a no-op update.
  const states2 = { "sensor.avg": mkState("sensor.avg", "unavailable", HUMIDITY_CLASS_ONLY) };
  states2["sensor.avg"].last_updated = new Date(Date.now() + 1000).toISOString();
  el.hass = mkHass(states2);
  iconEl = el.shadowRoot.querySelector(".rtc-icon-badge ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:water-off", "no-data icon must follow the new metric mode on a partial update");
  env.cleanup(el);
});

test("LIFE-01: setConfig() clears an in-progress pointer gesture and the render it deferred", () => {
  const C = TEMPERATURE_C;
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    mkHass({
      "sensor.avg": mkState("sensor.avg", 22, C),
      "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
      "sensor.r1": mkState("sensor.r1", 21, C),
      "sensor.r2": mkState("sensor.r2", 23, C),
    })
  );

  // A real gesture through the handlers — no writable test window into the interaction runtime.
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown({ pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0, composedPath: () => [rotator] });
  el._handlePointerMove({ pointerId: 1, clientX: -60, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(el._isDragging, true, "the drag is live");

  // A hass update arriving mid-drag is deferred rather than applied.
  assert.equal(el._render(false), RENDER_PATH.DEFERRED);
  assert.equal(el._renderController.isRenderPending, true);

  el.setConfig({ entity: "sensor.avg" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  assert.equal(el._renderController.isRenderPending, false, "the deferred render is dropped: its reason and its data are both gone");
  env.cleanup(el);
});

test("setConfig() preserves the active view across a structural rebuild when its key still exists, else falls back to start_view/the first active view", () => {
  // _renderAll() keeps whichever view key _currentVisualViewIndex() reports if it still
  // exists in the new list, falling back to config.start_view then the first active view.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  ); // views = [range, scale, extremes]
  el._activeView = el._views.indexOf("extremes");
  // Manual mode so _currentVisualViewIndex() falls back to this._activeView (see accessibility-logic.test.js).
  el._updateTrackTransform(true);

  // Cosmetic-only change (entity_label) goes through _updateContent(), not _renderAll(); _activeView untouched.
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    entity_label: "Custom",
  });
  assert.equal(el._activeView, el._views.indexOf("extremes"), "a non-structural config change must not reset the manually-swiped position");

  // A structural change (rotation_seconds) that keeps "extremes" in the list: the active
  // view survives the rebuild instead of snapping to "scale".
  el._updateTrackTransform(true);
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    rotation_seconds: 20,
  });
  assert.equal(el._views[el._activeView], "extremes", "the previously active view key must be preserved across a structural rebuild when it still exists");

  // Structural change removing "extremes" (rooms cleared), no start_view: falls back to the
  // first active view (index 0 of [range, scale] = "range", not a hardcoded "scale").
  el._updateTrackTransform(true);
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range" });
  assert.equal(el._activeView, 0, "falls back to the first active view once the previously active view key no longer exists and no start_view is set");
  assert.equal(el._views[el._activeView], "range");
  env.cleanup(el);
});

test("setConfig() falls back to config.start_view (not the first active view) when the previous view key vanishes and start_view is configured", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], start_view: "scale" },
    hass
  ); // views = [range, scale, extremes]
  el._activeView = el._views.indexOf("extremes");
  el._updateTrackTransform(true);

  // Rooms removed: "extremes" gone, start_view: "scale" wins over the index-0 "range" fallback.
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", start_view: "scale" });
  assert.equal(el._activeView, el._views.indexOf("scale"), "start_view must be preferred over the plain index-0 fallback");
  env.cleanup(el);
});

test("a font-ready promise rejection does not produce an unhandled rejection (the .catch(() => {}) safety net)", async () => {
  // document.fonts.ready is stubbed to resolve immediately; this only asserts a normal
  // render completes without throwing.
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  await Promise.resolve(); // let the document.fonts.ready.then()/.catch() chain settle
  assert.ok(el.shadowRoot.querySelector(".rtc-root"));
  env.cleanup(el);
});

// ==== The production render path consumes the CardViewModel ====

test("a full render and a partial update each compute exactly one view model", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: "A", short: "AA", entity: "sensor.r1" }, { name: "B", short: "BB", entity: "sensor.r2" }] },
    hass
  );

  let viewModelCalls = 0;
  const realViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = function () {
    viewModelCalls += 1;
    return realViewModel();
  };
  // The flat DTO has no producer in the card at all (an architecture test proves it for src/).
  assert.equal(el._computeData, undefined, "the pre-2H flat-DTO entry point is gone from the element");

  // A partial update (the common per-second path).
  el._render(false);
  assert.equal(viewModelCalls, 1, "exactly one view model per render, not one per view");

  // A structural rebuild: a second room appearing changes the markup itself.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
  });
  assert.equal(viewModelCalls, 2);
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-view"), "and the card still rendered");
  env.cleanup(el);
});

test("_computeViewModel returns the current structured view model", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.empty, false);
  assert.equal(data.metric.kind, "temperature");
  assert.equal(typeof data.average.value, "number");
  assert.equal(typeof data.scale.scaleMin, "number");
  assert.ok(Array.isArray(data.views.keys));
  env.cleanup(el);
});

test("the signature fast path returns before any view model is computed", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  let calls = 0;
  const real = el._computeViewModel.bind(el);
  el._computeViewModel = function () {
    calls += 1;
    return real();
  };
  // An identical hass push: the signature is unchanged, so nothing may be computed.
  el.hass = hass;
  assert.equal(calls, 0, "a no-op update must cost nothing");
  el._render(false);
  assert.equal(calls, 1, "while an explicitly forced render does compute");
  env.cleanup(el);
});

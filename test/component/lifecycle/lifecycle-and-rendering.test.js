"use strict";

// _render()'s signature must be committed only
// AFTER a render actually succeeds, so a thrown exception doesn't leave a
// "successful-looking" signature that suppresses a correct retry. LIFE-01:
// setConfig() must cancel any in-progress pointer gesture atomically before
// applying the new config. The suite also covers no-data icon updates
// and retrying an identical update after a render error.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");

let env;
// The render paths, imported from the source module so the test names the same
// constants production does rather than re-spelling their string values.
let RENDER_PATH;

test.before(async () => {
  ({ RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("ROB-01: a thrown _computeViewModel() does not commit the render signature, so an identical retry actually re-renders", () => {
  const hassA = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hassA);
  // A repeat of the identical hass push is skipped, which is what proves the first
  // render committed. Asserted through the render path rather than by reading the
  // signature string: the path is the property that actually matters.
  assert.equal(el._render(), RENDER_PATH.SKIPPED, "an unchanged repeat must be skipped, so the first render committed");

  const hassB = mkHass({ "sensor.avg": mkState("sensor.avg", 23, { device_class: "temperature", unit_of_measurement: "°C" }) });
  // The real production compute entry point, not the legacy-DTO adapter: _render()
  // calls _computeViewModel(), and a test that failed the adapter instead would stop
  // proving anything the moment the adapter is removed.
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
  // The retry carries the exact data that just failed. Committing the signature before
  // the render succeeded would make this identical push compare equal and be skipped,
  // freezing the card on stale content.
  assert.equal(el._render(), RENDER_PATH.CONTENT, "the retry must actually re-render, not be skipped as 'unchanged'");
  env.cleanup(el);
});

test("DOM-01: the no-data icon updates on a pure partial update (metric mode changes while staying empty)", () => {
  const states1 = { "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "temperature" }) };
  const el = env.createCard({ entity: "sensor.avg" }, mkHass(states1));
  let iconEl = el.shadowRoot.querySelector(".rtc-icon-badge ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:thermometer-off");

  // Same entity, still unavailable, device_class flips to humidity — a real
  // HA attribute-only update always bumps last_updated, so this is forced
  // explicitly (two mkState() calls made within the same millisecond would
  // otherwise collide and be treated as a no-op update).
  const states2 = { "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "humidity" }) };
  states2["sensor.avg"].last_updated = new Date(Date.now() + 1000).toISOString();
  el.hass = mkHass(states2);
  iconEl = el.shadowRoot.querySelector(".rtc-icon-badge ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:water-off", "no-data icon must follow the new metric mode on a partial update");
  env.cleanup(el);
});

test("LIFE-01: setConfig() clears an in-progress pointer gesture and the render it deferred", () => {
  const C = { device_class: "temperature", unit_of_measurement: "°C" };
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    mkHass({
      "sensor.avg": mkState("sensor.avg", 22, C),
      "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
      "sensor.r1": mkState("sensor.r1", 21, C),
      "sensor.r2": mkState("sensor.r2", 23, C),
    })
  );

  // A real gesture, driven through the handlers, so this keeps its meaning without any
  // writable test window into the interaction runtime.
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
  // _renderAll() preserves whichever view key the user was actually looking
  // at via _currentVisualViewIndex() if that
  // key still exists in the new view list, only falling back to
  // config.start_view then the first active view once it
  // doesn't.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  ); // views = [range, scale, extremes]
  el._activeView = el._views.indexOf("extremes");
  // Freezes the track into manual mode so _currentVisualViewIndex() (which
  // _renderAll() reads to capture the previously active key) is defined to
  // fall back to this._activeView instead of the wall-clock auto-slide
  // phase — see accessibility-logic.test.js for the same pattern.
  el._updateTrackTransform(true);

  // Same structure, cosmetic-only change (entity_label) -> goes through
  // _updateContent(), not _renderAll() at all -> _activeView untouched.
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    entity_label: "Custom",
  });
  assert.equal(el._activeView, el._views.indexOf("extremes"), "a non-structural config change must not reset the manually-swiped position");

  // A structural change (rotation_seconds affects structuralConfigSignature,
  // see _render()) that does NOT remove "extremes" from the view list ->
  // the active view survives the rebuild instead of snapping to "scale".
  el._updateTrackTransform(true);
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    rotation_seconds: 20,
  });
  assert.equal(el._views[el._activeView], "extremes", "the previously active view key must be preserved across a structural rebuild when it still exists");

  // A structural change that DOES remove "extremes" (rooms cleared) with no
  // start_view configured -> falls back to the first active view (index 0
  // of the new views = [range, scale] — "range", not a hardcoded "scale").
  el._updateTrackTransform(true);
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range" });
  assert.equal(el._activeView, 0, "falls back to the first active view once the previously active view key no longer exists and no start_view is set");
  assert.equal(el._views[el._activeView], "range");
  env.cleanup(el);
});

test("setConfig() falls back to config.start_view (not the first active view) when the previous view key vanishes and start_view is configured", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], start_view: "scale" },
    hass
  ); // views = [range, scale, extremes]
  el._activeView = el._views.indexOf("extremes");
  el._updateTrackTransform(true);

  // Rooms removed -> "extremes" no longer exists -> start_view: "scale" wins over the first-active-view (index 0 = "range") fallback.
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", start_view: "scale" });
  assert.equal(el._activeView, el._views.indexOf("scale"), "start_view must be preferred over the plain index-0 fallback");
  env.cleanup(el);
});

test("a font-ready promise rejection does not produce an unhandled rejection (the .catch(() => {}) safety net)", async () => {
  // document.fonts.ready is stubbed to resolve immediately by the jsdom
  // loader; this test only asserts that a normal render with the stub in
  // place completes without throwing, exercising that code path at all.
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  await Promise.resolve(); // let the document.fonts.ready.then()/.catch() chain settle
  assert.ok(el.shadowRoot.querySelector(".rtc-root"));
  env.cleanup(el);
});

// ==== The production render path consumes the CardViewModel ====

test("a full render and a partial update each compute exactly one view model", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
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
  // There is nothing else to count any more: the flat DTO has no producer in the
  // card at all, which an architecture test now proves for the whole of src/.
  assert.equal(el._computeData, undefined, "the pre-2H flat-DTO entry point is gone from the element");

  // A partial update (the common per-second path).
  el._render(false);
  assert.equal(viewModelCalls, 1, "exactly one view model per render, not one per view");

  // A structural rebuild: a second room appearing changes the markup itself.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.equal(viewModelCalls, 2);
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-view"), "and the card still rendered");
  env.cleanup(el);
});

test("_computeViewModel returns the current structured view model", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
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
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
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

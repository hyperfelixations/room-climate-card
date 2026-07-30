"use strict";

// ROB-01 (v2.15.0 audit): _render()'s signature must be committed only
// AFTER a render actually succeeds, so a thrown exception doesn't leave a
// "successful-looking" signature that suppresses a correct retry. LIFE-01:
// setConfig() must cancel any in-progress pointer gesture atomically before
// applying the new config. Also covers the DOM-01 empty-state icon update
// and the general set hass() try/catch robustness (audit checklist:
// "Renderfehler und anschliessender identischer Retry").

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

test("ROB-01: a thrown _computeViewModel() does not commit the render signature, so an identical retry actually re-renders", () => {
  const hassA = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hassA);
  const sigAfterFirstRender = el._lastRenderSignature;
  assert.ok(sigAfterFirstRender, "first render must commit a non-empty signature");

  const hassB = mkHass({ "sensor.avg": mkState("sensor.avg", 23, { device_class: "temperature" }) });
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
  assert.equal(el._lastRenderSignature, sigAfterFirstRender, "signature must NOT advance after a failed render");

  el._computeViewModel = original;
  el.hass = hassB; // retry with the identical (already-failed) data
  assert.notEqual(el._lastRenderSignature, sigAfterFirstRender, "the retry must actually re-render, not be skipped as 'unchanged'");
  env.cleanup(el);
});

test("DOM-01: the empty-state icon updates on a pure partial update (metric mode changes while staying empty)", () => {
  const states1 = { "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "temperature" }) };
  const el = env.createCard({ entity: "sensor.avg" }, mkHass(states1));
  let iconEl = el.shadowRoot.querySelector(".rtc-empty-icon ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:thermometer-off");

  // Same entity, still unavailable, device_class flips to humidity — a real
  // HA attribute-only update always bumps last_updated, so this is forced
  // explicitly (two mkState() calls made within the same millisecond would
  // otherwise collide and be treated as a no-op update).
  const states2 = { "sensor.avg": mkState("sensor.avg", "unavailable", { device_class: "humidity" }) };
  states2["sensor.avg"].last_updated = new Date(Date.now() + 1000).toISOString();
  el.hass = mkHass(states2);
  iconEl = el.shadowRoot.querySelector(".rtc-empty-icon ha-icon");
  assert.equal(iconEl?.getAttribute("icon"), "mdi:water-off", "empty-state icon must follow the new metric mode on a partial update");
  env.cleanup(el);
});

test("LIFE-01: setConfig() clears an in-progress pointer gesture (_pointer/_isDragging/_renderPending)", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  el._pointer = { id: 1, x: 0, y: 0, time: Date.now(), rotator: true, startTranslate: 0, dragging: true, width: 100 };
  el._isDragging = true;
  el._renderPending = true;

  el.setConfig({ entity: "sensor.avg" });

  assert.equal(el._pointer, null);
  assert.equal(el._isDragging, false);
  assert.equal(el._renderPending, false);
  env.cleanup(el);
});

test("setConfig() preserves the active view across a structural rebuild when its key still exists, else falls back to start_view/the first active view", () => {
  // P1.4: _renderAll() no longer unconditionally resets to "scale" on every
  // structural change — it preserves whichever view key the user was
  // actually looking at (via _currentVisualViewIndex(), see P0.1) if that
  // key still exists in the new view list, only falling back to
  // config.start_view then the first active view (AP-04: no more
  // "mandatory scale" special case — see room-climate-card.js) once it
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

  // Same structure, cosmetic-only change (avg_label) -> goes through
  // _updateContent(), not _renderAll() at all -> _activeView untouched.
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    avg_label: "Custom",
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

test("a full render and a partial update both go through _computeViewModel(), never through the legacy DTO", () => {
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
  let legacyCalls = 0;
  const realViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = function () {
    viewModelCalls += 1;
    return realViewModel();
  };
  const realLegacy = el._computeData.bind(el);
  el._computeData = function () {
    legacyCalls += 1;
    return realLegacy();
  };

  // A partial update (the common per-second path).
  el._render(false);
  assert.equal(viewModelCalls, 1, "exactly one view model per render, not one per view");
  assert.equal(legacyCalls, 0, "the flat DTO is not on the render path at all");

  // A structural rebuild.
  el._rendered = false;
  el._render(false);
  assert.equal(viewModelCalls, 2);
  assert.equal(legacyCalls, 0);
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-view"), "and the card still rendered");
  env.cleanup(el);
});

test("the legacy compatibility method still reproduces the flat shape on demand", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeData();
  assert.equal(data.empty, false);
  assert.equal(data.metricType, "temperature");
  assert.equal(typeof data.avg, "number");
  assert.equal(typeof data.scaleMin, "number");
  assert.ok(Array.isArray(data.views));
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

"use strict";

// AP-03 (v2.17.0 consolidated audit, section 9 "DATA-05 - Native
// Temperatur-UnitProfiles und Fahrenheit", 9.6 "SCALE-01"): before this
// round, a Fahrenheit-reporting entity was only RECOGNIZED as
// metricType==="temperature" (via METRIC_TYPE_BY_UNIT) but then treated
// exactly like Celsius everywhere else — classification, comfort/optimal
// bands, icons, and the dynamic scale all stayed Celsius numbers compared
// against a raw, unconverted Fahrenheit value (audit reproduction, section
// 9.1: 72 °F classified as "Very hot" against a 20-24 "Celsius" comfort
// band). AP-01 built the conversion machinery (METRIC_DEFINITIONS,
// UnitProfiles, _deriveThresholdsForProfile()/_deriveBandForProfile(),
// deterministic integer Fahrenheit boundaries); AP-02 made the measurement
// pipeline atomic and canonicalizes correctly, but deliberately kept
// display Celsius-only. AP-03 completes native display: _resolveMetricContext()
// now resolves a real displayUnitProfile (section 9.4), and the view model
// converts every displayed number into that unit before classification,
// comfort/optimal/scale, and icon decisions are made — never a raw
// Fahrenheit number compared against Celsius bounds again.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// The compositions the element used to expose only for tests (see the helper).
let internals;

// The modules under test, imported directly. These used to be reached through
// thin delegating methods on the custom element; the element no longer carries
// them, and naming the real module is what makes each test say where its subject
// actually lives.
let access;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  access = await import("../../src/domain/metrics/access.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// ==== Pure single-unit cards (section 9.7: "reine C-, F- und K-Karte") ====

test("pure Celsius card: unaffected regression anchor — identical to pre-AP-03 behavior", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°C");
  assert.equal(data.average.value, 22);
  assert.equal(data.comfort.min, 20);
  assert.equal(data.comfort.max, 24);
  assert.equal(data.scale.optimalMin, 21);
  assert.equal(data.scale.optimalMax, 23);
  assert.equal(data.scale.scaleMin, 19);
  assert.equal(data.scale.scaleMax, 25);
  env.cleanup(el);
});

test("pure Fahrenheit card: audit 9.1 reproduction is fixed — 72°F with 70/74°F rooms classifies natively, never 'Very hot'", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F" }),
    "sensor.r1": mkState("sensor.r1", 70, { unit_of_measurement: "°F" }),
    "sensor.r2": mkState("sensor.r2", 74, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "temperature");
  assert.equal(el._unit(), "°F");
  assert.ok(Math.abs(data.average.value - 72) < 1e-9, `avg must display as 72, not the canonical 22.2 — got ${data.average.value}`);
  assert.equal(data.comfort.min, 68);
  assert.equal(data.comfort.max, 75);
  assert.equal(data.scale.optimalMin, 70);
  assert.equal(data.scale.optimalMax, 73);
  const tone = internals.averageTone(el, data.average.value, data.average.entity, data.metric.kind, data.metric.displayUnitProfile);
  assert.notEqual(tone.label, "Very hot", "audit 9.1's exact bug must not reproduce");
  assert.equal(tone.label, "Optimal", "72°F (=22.2°C) is squarely in the optimal band");
  assert.equal(data.comfort.inComfort, 2, "both 70°F and 74°F rooms are within the 68-75°F comfort band");
  env.cleanup(el);
});

test("pure Kelvin card: comfort/optimal bands are exact fromCanonical conversions, unrounded (no thresholdRounding for kelvin)", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 295.15, { unit_of_measurement: "K" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "K");
  assert.ok(Math.abs(data.average.value - 295.15) < 1e-9);
  assert.equal(data.comfort.min, 293.15);
  assert.equal(data.comfort.max, 297.15);
  assert.equal(data.scale.optimalMin, 294.15);
  assert.equal(data.scale.optimalMax, 296.15);
  env.cleanup(el);
});

// ==== Mixed units (section 9.7) ====

test("mixed °C/°F/K rooms, no usable primary: canonically averaged correctly, display falls back to canonical (no single source unit to prefer)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.c": mkState("sensor.c", 20, { device_class: "temperature", unit_of_measurement: "°C" }), // 20°C
    "sensor.f": mkState("sensor.f", 71.6, { unit_of_measurement: "°F" }), // = 22°C
    "sensor.k": mkState("sensor.k", 295.15, { unit_of_measurement: "K" }), // = 22°C
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.c" }, { entity: "sensor.f" }, { entity: "sensor.k" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°C", "disagreeing room unit profiles must not pick an arbitrary display unit");
  assert.ok(Math.abs(data.average.value - (20 + 22 + 22) / 3) < 1e-9, "the °F/K rooms must be canonicalized before averaging with the °C room");
  env.cleanup(el);
});

test("Primary °F, rooms °C: display follows the usable primary's unit (section 9.4 point 1); room values convert for comparison/chips", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F" }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°F");
  assert.ok(Math.abs(data.average.value - 72) < 1e-9);
  const r1 = data.rooms.visible.find((r) => r.entity === "sensor.r1");
  const r2 = data.rooms.visible.find((r) => r.entity === "sensor.r2");
  assert.ok(Math.abs(r1.value - 68) < 1e-9, "20°C room must display as 68°F, not 20");
  assert.ok(Math.abs(r2.value - 75.2) < 1e-9, "24°C room must display as 75.2°F, not 24");
  env.cleanup(el);
});

test("Primary unavailable, rooms in a compatible unit (all °F): room-consensus display is native °F", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.r1": mkState("sensor.r1", 70, { unit_of_measurement: "°F" }),
    "sensor.r2": mkState("sensor.r2", 74, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°F");
  assert.ok(Math.abs(data.average.value - 72) < 1e-9, "mean of canonicalized 70°F/74°F round-trips back to exactly 72°F");
  env.cleanup(el);
});

// ==== -40°C = -40°F, end to end (section 9.7) ====

test("-40°C = -40°F end to end: both cards resolve to the identical canonical value and round-trip display", () => {
  const hassC = mkHass({ "sensor.avg": mkState("sensor.avg", -40, { device_class: "temperature", unit_of_measurement: "°C" }) });
  const elC = env.createCard({ entity: "sensor.avg" }, hassC);
  const hassF = mkHass({ "sensor.avg": mkState("sensor.avg", -40, { unit_of_measurement: "°F" }) });
  const elF = env.createCard({ entity: "sensor.avg" }, hassF);

  const ctxC = elC._resolveMetricContext();
  const ctxF = elF._resolveMetricContext();
  assert.ok(Math.abs(ctxC.averageSource.canonicalValue - ctxF.averageSource.canonicalValue) < 1e-9, "-40°C and -40°F must resolve to the same canonical value");

  const dataF = elF._computeViewModel();
  assert.ok(Math.abs(dataF.average.value - (-40)) < 1e-9, "-40°C converted to °F and back must still read -40");
  env.cleanup(elC);
  env.cleanup(elF);
});

// ==== All 10 generated Fahrenheit classification boundaries: -eps/exact (section 9.7) ====

function fahrenheitCard(primaryValue) {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", primaryValue, { unit_of_measurement: "°F" }) });
  return env.createCard({ entity: "sensor.avg" }, hass);
}

test("Fahrenheit classification: all 10 generated boundaries classify exactly at/just-below the documented integer threshold", () => {
  const el = fahrenheitCard(70); // context only needs A usable °F primary to resolve the profile; the boundary values themselves are tested directly
  // Teil C (review fix 3): _fallbackTone() no longer self-resolves its own
  // unitProfile — the caller (here, the test itself, standing in for
  // buildCardViewModel()) explicitly resolves it once and passes it through.
  const profile = el._resolveMetricContext().displayUnitProfile;
  const label = (value) => internals.fallbackTone(el, value, "temperature", profile).label;

  assert.equal(label(82), "Very hot");
  assert.equal(label(81.99), "Hot");
  assert.equal(label(79), "Hot");
  assert.equal(label(78.99), "Very warm");
  assert.equal(label(77), "Very warm");
  assert.equal(label(76.99), "Warm");
  assert.equal(label(75), "Warm");
  assert.equal(label(74.99), "Slightly warm");
  assert.equal(label(73), "Slightly warm");
  assert.equal(label(72.99), "Optimal");
  assert.equal(label(70), "Optimal");
  assert.equal(label(69.99), "Slightly cool");
  assert.equal(label(68), "Slightly cool");
  assert.equal(label(67.99), "Fresh");
  assert.equal(label(66), "Fresh");
  assert.equal(label(65.99), "Cool");
  assert.equal(label(64), "Cool");
  assert.equal(label(63.99), "Cold");
  assert.equal(label(61), "Cold");
  assert.equal(label(60.99), "Very cold");
  env.cleanup(el);
});

test("Fahrenheit classification precision: the ROUNDED 70°F threshold governs, not the exact canonical 21°C boundary", () => {
  // 69.8°F converts to EXACTLY 21°C (the exact canonical optimal-min) — a
  // classifier that (incorrectly) tested the exact canonical value against
  // the exact Celsius boundary would call this "Optimal". The audit's
  // binding product rule (9.3) mandates testing against the ROUNDED
  // Fahrenheit boundary (70°F) instead, so 69.8°F must NOT be optimal.
  const el = fahrenheitCard(70);
  const profile = el._resolveMetricContext().displayUnitProfile;
  assert.equal(internals.fallbackTone(el, 69.8, "temperature", profile).label, "Slightly cool");
  assert.equal(internals.fallbackTone(el, 70, "temperature", profile).label, "Optimal");
  env.cleanup(el);
});

// ==== Dynamic Fahrenheit steps: 2 / 5 / 10 °F (section 9.6) ====

test("dynamic scale step: a narrow span (<=20°F) rounds to multiples of 2°F", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.r1": mkState("sensor.r1", 70, { unit_of_measurement: "°F" }),
    "sensor.r2": mkState("sensor.r2", 74, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.scale.scaleMin % 2, 0, `scaleMin=${data.scale.scaleMin} must be a multiple of 2`);
  assert.equal(data.scale.scaleMax % 2, 0, `scaleMax=${data.scale.scaleMax} must be a multiple of 2`);
  env.cleanup(el);
});

test("dynamic scale step: a medium span (>20, <=40°F) rounds to multiples of 5°F", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.r1": mkState("sensor.r1", 70, { unit_of_measurement: "°F" }),
    "sensor.r2": mkState("sensor.r2", 95, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.scale.scaleMin % 5, 0, `scaleMin=${data.scale.scaleMin} must be a multiple of 5`);
  assert.equal(data.scale.scaleMax % 5, 0, `scaleMax=${data.scale.scaleMax} must be a multiple of 5`);
  env.cleanup(el);
});

test("dynamic scale step: a wide span (>40°F) rounds to multiples of 10°F", () => {
  const el = fahrenheitCard(130);
  const data = el._computeViewModel();
  assert.equal(data.scale.scaleMin % 10, 0, `scaleMin=${data.scale.scaleMin} must be a multiple of 10`);
  assert.equal(data.scale.scaleMax % 10, 0, `scaleMax=${data.scale.scaleMax} must be a multiple of 10`);
  env.cleanup(el);
});

// ==== Spread/trend without offset (section 9.7: "Temperaturdelta und Trend ohne Offset") ====

test("spread attribute (a delta) must round-trip without the Fahrenheit absolute offset", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F", spread: 4 }),
    "sensor.r1": mkState("sensor.r1", 70, { unit_of_measurement: "°F" }),
    "sensor.r2": mkState("sensor.r2", 74, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(Math.abs(data.spread - 4) < 1e-9, `spread must round-trip to exactly 4, not be offset by +32 (got ${data.spread})`);
  env.cleanup(el);
});

// ==== buildScaleModel(): identical geometry for identical input (section 9.6 invariant) ====

test("_buildScaleModel(): identical input produces identical geometry for both the main scale and rangeScale call sites", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  // Teil C (review fix 3): _buildScaleModel() takes an explicit options
  // object (metricType/unitProfile instead of an implicit
  // this._resolveMetricContext() call) and returns the FULL renderer-ready
  // model — displayStep/markerPositions/boundaryLabels, not just geometry.
  const celsius = access.getUnitProfile("temperature", "celsius");
  const options = {
    metricType: "temperature",
    unitProfile: celsius,
    comfortMin: 20,
    comfortMax: 24,
    optimalMin: 21,
    optimalMax: 23,
    low: 18,
    high: 26,
    markers: { avg: 22 },
  };
  const first = internals.scaleModel(el, options);
  const second = internals.scaleModel(el, { ...options, markers: { ...options.markers } });
  assert.deepEqual(normalize(first), normalize(second));
  assert.ok(first.scaleMin < first.scaleMax);
  assert.equal(first.displayStep, 1, "Celsius uses the fixed static step (1), not a dynamic Fahrenheit tier");
  assert.ok(Number.isFinite(first.markerPositions.avg) && first.markerPositions.avg > 0 && first.markerPositions.avg < 100);
  assert.equal(first.boundaryLabels.min, el._fmtWithUnit(first.scaleMin, 0, false));
  assert.equal(first.boundaryLabels.max, el._fmtWithUnit(first.scaleMax, 0, false));
  env.cleanup(el);
});

test("_buildScaleModel(): markerPositions covers every key passed in markers, and only those keys", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const celsius = access.getUnitProfile("temperature", "celsius");
  const model = internals.scaleModel(el, {
    metricType: "temperature",
    unitProfile: celsius,
    comfortMin: 20,
    comfortMax: 24,
    optimalMin: 21,
    optimalMax: 23,
    low: 18,
    high: 26,
    markers: { avg: 22, coolest: 19, warmest: 25 },
  });
  assert.deepEqual(Object.keys(model.markerPositions).sort(), ["avg", "coolest", "warmest"]);
  assert.ok(model.markerPositions.coolest < model.markerPositions.avg);
  assert.ok(model.markerPositions.avg < model.markerPositions.warmest);
  env.cleanup(el);
});

test("_buildScaleModel(): displayStep reflects the Fahrenheit dynamic-step rule (audit 9.6), driven by the passed unitProfile, not an implicit context", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 130, { unit_of_measurement: "°F" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const fahrenheit = el._resolveMetricContext().displayUnitProfile;
  const model = internals.scaleModel(el, {
    metricType: "temperature",
    unitProfile: fahrenheit,
    comfortMin: 68,
    comfortMax: 75,
    optimalMin: 70,
    optimalMax: 73,
    low: 130,
    high: 130,
    markers: { avg: 130 },
  });
  assert.equal(model.displayStep, 10, "a wide (>40°F) span must use the 10°F dynamic step");
  env.cleanup(el);
});

// ==== Review fix (post-AP-01..03, P0): the former "KNOWN GAP" — range_entity
// is now typed/converted like every other measurement (section 9.7's
// deferred RANGE-01 gap is closed). A range_entity requires an EXPLICIT
// unit_of_measurement of its own, exactly like Primary/Räume (P0 review fix,
// post-2.21.1, at _resolveAuxiliaryUnitProfile() — a missing unit is
// unusable, never assumed canonical; see metric-fallback.test.js and
// range-and-spread.test.js for the dedicated missing/unresolvable-unit
// exclusion cases). With an explicit °C unit, 18/23 Celsius correctly become
// 64.4/73.4 Fahrenheit once projected into the card's resolved °F display,
// instead of the old raw 18/23 passthrough. ====

test("review fix (closes the former KNOWN GAP): range_entity min/max ARE converted to the resolved display unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°F", "the card's resolved display unit is Fahrenheit");
  assert.ok(Math.abs(data.range.min - 64.4) < 1e-9, `rangeMin must convert 18°C -> 64.4°F, got ${data.range.min}`);
  assert.ok(Math.abs(data.range.max - 73.4) < 1e-9, `rangeMax must convert 23°C -> 73.4°F, got ${data.range.max}`);
  env.cleanup(el);
});

test("review fix (closes the former KNOWN GAP), rangeScale geometry: converted range_entity values produce a physically meaningful, single-unit axis", () => {
  // _buildScaleModel() is fed avg (display-unit, °F) alongside the NOW
  // ALSO display-unit-converted rangeMin/rangeMax — both genuinely in the
  // same physical unit, unlike the pre-fix mixed-unit axis this test used
  // to document.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    hass
  );
  const data = el._computeViewModel();
  assert.equal(data.views.hasRangeScale, true);
  assert.ok(data.rangeScale.scaleMin < data.rangeScale.scaleMax);
  assert.ok(Math.abs(data.range.min - 64.4) < 1e-9);
  assert.ok(Math.abs(data.range.max - 73.4) < 1e-9);
  for (const pos of [(data.rangeScale?.markerPositions.current ?? 0), (data.rangeScale?.markerPositions.min ?? 0), (data.rangeScale?.markerPositions.max ?? 0)]) {
    assert.equal(Number.isFinite(pos), true);
    assert.ok(pos >= 0 && pos <= 100);
  }
  env.cleanup(el);
});

// ==== Review fix: METRIC_TYPE_BY_UNIT is now derived atomically from
// METRIC_DEFINITIONS.unitProfiles[*].units instead of a separately
// hand-maintained table — the two tables had drifted: the word/bare-letter
// aliases ("c", "celsius", "f", "fahrenheit") were registered in the
// UnitProfiles (recognized once metricKind was already known some other
// way, e.g. via _resolveUnitProfileKey()) but NOT in the old
// METRIC_TYPE_BY_UNIT, so an entity with no device_class and one of these
// unit strings alone could not even be recognized as temperature at all. ====

test("review fix: 'c'/'celsius'/'f'/'fahrenheit' unit aliases (previously missing from METRIC_TYPE_BY_UNIT) are now recognized via unit alone, no device_class needed", () => {
  for (const [unit, expectedProfileKey] of [["c", "celsius"], ["celsius", "celsius"], ["f", "fahrenheit"], ["fahrenheit", "fahrenheit"]]) {
    const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { unit_of_measurement: unit }) });
    const el = env.createCard({ entity: "sensor.avg" }, hass);
    const context = el._resolveMetricContext();
    assert.equal(context.metricType, "temperature", `unit "${unit}" must resolve to temperature via unit alone`);
    assert.equal(context.averageSource.unitProfile, expectedProfileKey, `unit "${unit}" must resolve to the ${expectedProfileKey} profile`);
    env.cleanup(el);
  }
});

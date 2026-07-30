"use strict";

// AP-01 (v2.17.0 consolidated audit, sections 4, 9.2-9.5, 10): a generic
// MetricDefinition/UnitProfile/QuantityKind registry — the foundation for
// native Fahrenheit/Kelvin support and future metric kinds (e.g. absolute
// humidity). This block is PURELY ADDITIVE: METRIC_DEFINITIONS and its
// helpers are not wired into computeLegacyData(), any scale-rendering method, or
// the view system yet (that migration is a later, separate block per the
// audit's own commit/review sequencing in section 20.3 — mixing correctness
// fixes with a refactor is explicitly warned against). These tests exercise
// the new module directly via thin instance-method wrappers
// (_getMetricDefinition/_getUnitProfile/_convertMetricValue/
// _deriveThresholdsForProfile/_deriveBandForProfile), the same pattern this
// codebase already uses for other pure helpers (_isPhysicallyValid,
// _floorToStep/_ceilToStep) — a bare element with no setConfig()/hass is
// enough, no rendering involved.
//
// Celsius stays the single manually-maintained source of truth: this file
// also asserts that the temperature MetricDefinition's classification tiers
// are wired directly to the indoor temperature profile's tiers (not a second,
// separately-maintained Celsius copy that could drift), and that the
// generated Fahrenheit thresholds are integers deterministically derived
// from that single source (audit 9.3): 16/18/19/20/21/23/24/25/26/28 °C ->
// 61/64/66/68/70/73/75/77/79/82 °F exactly.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { computeLegacyData } = require("../helpers/legacy-dto.js");

let env;
let el;

test.before(() => {
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card"); // bare element, no setConfig() needed for pure-function calls
});
test.after(() => {
  env.cleanupAll();
});

// ---- Absolute round-trip invariants ----

test("absolute: -40 °C = -40 °F (the classic cross-check point)", () => {
  const f = el._convertMetricValue(-40, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(f, -40);
  const back = el._convertMetricValue(f, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "fahrenheit", toProfileKey: "celsius" });
  assert.equal(back, -40);
});

test("absolute: 0 °C = 32 °F, 100 °C = 212 °F", () => {
  assert.equal(el._convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 32);
  assert.equal(el._convertMetricValue(100, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 212);
});

test("absolute: 0 °C = 273.15 K, round-trips through celsius->kelvin->celsius", () => {
  const k = el._convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "kelvin" });
  assert.equal(k, 273.15);
  const back = el._convertMetricValue(k, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "kelvin", toProfileKey: "celsius" });
  assert.equal(back, 0);
});

test("absolute: celsius->celsius is a true identity (no accumulated float drift)", () => {
  assert.equal(el._convertMetricValue(21.4, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "celsius" }), 21.4);
});

test("absolute round-trip: an arbitrary value survives celsius->fahrenheit->celsius and celsius->kelvin->celsius within float epsilon", () => {
  for (const value of [-273.15, -40, -17.7, 0, 3.3, 21, 36.6, 100, 1000]) {
    const viaF = el._convertMetricValue(
      el._convertMetricValue(value, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }),
      { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "fahrenheit", toProfileKey: "celsius" }
    );
    assert.ok(Math.abs(viaF - value) < 1e-9, `celsius->fahrenheit->celsius for ${value} must round-trip, got ${viaF}`);

    const viaK = el._convertMetricValue(
      el._convertMetricValue(value, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "kelvin" }),
      { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "kelvin", toProfileKey: "celsius" }
    );
    assert.ok(Math.abs(viaK - value) < 1e-9, `celsius->kelvin->celsius for ${value} must round-trip, got ${viaK}`);
  }
});

// ---- Delta/rate must never apply the Fahrenheit offset ----

test("delta vs absolute: 0 °C converts differently depending on quantityKind (proves the offset is NOT applied to deltas)", () => {
  const absolute = el._convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  const delta = el._convertMetricValue(0, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(absolute, 32, "an absolute 0 °C reading is 32 °F");
  assert.equal(delta, 0, "a 0 °C delta (no change) must stay 0, not pick up the +32 offset");
});

test("delta: 5 °C delta = 9 °F delta (scale factor only, no offset)", () => {
  assert.equal(el._convertMetricValue(5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 9);
});

test("delta: a negative Celsius delta (falling trend) converts with the same factor, still no offset", () => {
  const result = el._convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.ok(Math.abs(result - -0.54) < 1e-9, `expected -0.54, got ${result}`);
});

test("rate uses exactly the same conversion factor as delta (a rate is a delta per unit time; the time unit itself is untouched)", () => {
  const delta = el._convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  const rate = el._convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "rate", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(rate, delta);
});

test("delta: Kelvin delta equals Celsius delta exactly (pure offset relationship, no scale factor)", () => {
  assert.equal(el._convertMetricValue(5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "kelvin" }), 5);
  assert.equal(el._convertMetricValue(-2.5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "kelvin", toProfileKey: "celsius" }), -2.5);
});

// ---- Deterministic, integer Fahrenheit classification thresholds (the User's explicit acceptance list) ----

test("Fahrenheit classification thresholds are the exact required integers, derived from the single Celsius source", () => {
  const celsiusTiers = el._deriveThresholdsForProfile("temperature", "celsius");
  const fahrenheitTiers = el._deriveThresholdsForProfile("temperature", "fahrenheit");

  // Source (CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.tiers):
  // 28,26,25,24,23,21,20,19,18,16,-Infinity
  const expectedByCelsius = { 16: 61, 18: 64, 19: 66, 20: 68, 21: 70, 23: 73, 24: 75, 25: 77, 26: 79, 28: 82 };

  for (const celsiusTier of celsiusTiers) {
    if (!Number.isFinite(celsiusTier.min)) continue;
    const expectedF = expectedByCelsius[celsiusTier.min];
    assert.ok(expectedF !== undefined, `unexpected Celsius tier min ${celsiusTier.min} not in the expected mapping`);
    const actualFahrenheitTier = fahrenheitTiers.find((t) => t.levelKey === celsiusTier.levelKey);
    assert.ok(actualFahrenheitTier, `no Fahrenheit tier found for levelKey ${celsiusTier.levelKey}`);
    assert.equal(actualFahrenheitTier.min, expectedF, `${celsiusTier.min} °C must generate exactly ${expectedF} °F, got ${actualFahrenheitTier.min}`);
    assert.equal(Number.isInteger(actualFahrenheitTier.min), true, `Fahrenheit threshold for ${celsiusTier.min} °C must be an integer, got ${actualFahrenheitTier.min}`);
  }
});

test("the -Infinity tier survives Fahrenheit derivation unchanged (no NaN/edge-case bug)", () => {
  const fahrenheitTiers = el._deriveThresholdsForProfile("temperature", "fahrenheit");
  const lowest = fahrenheitTiers.find((t) => t.min === -Infinity);
  assert.ok(lowest, "the -Infinity tier must still be present after Fahrenheit derivation");
  assert.equal(lowest.levelKey, "level.veryCold");
});

test("Celsius profile derivation is a true identity: returns the indoor profile tiers unchanged, proving there is no second manually-maintained Celsius table", () => {
  const derivedCelsius = el._deriveThresholdsForProfile("temperature", "celsius");
  const sourceTiers = el._getMetricDefinition("temperature").canonicalClassificationTiers;
  assert.deepEqual(normalize(derivedCelsius), normalize(sourceTiers));
});

test("levelKey/color are carried through unchanged for every generated Fahrenheit tier (only min is converted)", () => {
  const celsiusTiers = el._deriveThresholdsForProfile("temperature", "celsius");
  const fahrenheitTiers = el._deriveThresholdsForProfile("temperature", "fahrenheit");
  assert.equal(fahrenheitTiers.length, celsiusTiers.length);
  for (let i = 0; i < celsiusTiers.length; i++) {
    assert.equal(fahrenheitTiers[i].levelKey, celsiusTiers[i].levelKey);
    assert.equal(fahrenheitTiers[i].color, celsiusTiers[i].color);
  }
});

// ---- Fahrenheit comfort/optimal/base-scale bands (audit 9.3's verbindliche Bereiche) ----

test("Fahrenheit base scale is exactly 66-77 °F", () => {
  const band = el._deriveBandForProfile("temperature", "fahrenheit", "baseScale");
  assert.deepEqual(normalize(band), { min: 66, max: 77 });
});

test("Fahrenheit comfort band is exactly 68-75 °F", () => {
  const band = el._deriveBandForProfile("temperature", "fahrenheit", "comfort");
  assert.deepEqual(normalize(band), { min: 68, max: 75 });
});

test("Fahrenheit optimal band is exactly 70-73 °F", () => {
  const band = el._deriveBandForProfile("temperature", "fahrenheit", "optimal");
  assert.deepEqual(normalize(band), { min: 70, max: 73 });
});

test("Celsius bands are returned unrounded/untouched (identity profile)", () => {
  assert.deepEqual(normalize(el._deriveBandForProfile("temperature", "celsius", "comfort")), { min: 20, max: 24 });
  assert.deepEqual(normalize(el._deriveBandForProfile("temperature", "celsius", "optimal")), { min: 21, max: 23 });
  assert.deepEqual(normalize(el._deriveBandForProfile("temperature", "celsius", "baseScale")), { min: 19, max: 25 });
});

// ---- baseDisplayStep contract (data only, no consuming logic in this block) ----

test("baseDisplayStep is defined per profile: celsius 1, fahrenheit 2, kelvin 1", () => {
  assert.equal(el._getUnitProfile("temperature", "celsius").baseDisplayStep, 1);
  assert.equal(el._getUnitProfile("temperature", "fahrenheit").baseDisplayStep, 2);
  assert.equal(el._getUnitProfile("temperature", "kelvin").baseDisplayStep, 1);
});

// ---- Error paths: fail fast on internal contract violations, never NaN/undefined ----

test("_getMetricDefinition throws a descriptive error for an unregistered metricKind", () => {
  assert.throws(() => el._getMetricDefinition("pressure"), /pressure/);
});

test("_getUnitProfile throws a descriptive error for an unknown profile key", () => {
  assert.throws(() => el._getUnitProfile("temperature", "rankine"), /rankine/);
});

test("_convertMetricValue throws for an unknown quantityKind instead of silently returning NaN", () => {
  assert.throws(
    () => el._convertMetricValue(10, { metricKind: "temperature", quantityKind: "bogus", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }),
    /bogus/
  );
});

test("_deriveBandForProfile throws a descriptive error for an unknown band name", () => {
  assert.throws(() => el._deriveBandForProfile("temperature", "celsius", "notaband"), /notaband/);
});

// ---- Extension-point proof: the underlying pure functions are generic, not hardcoded to temperature ----

test("extension point: convertUnitValue/deriveThresholdsForProfile/deriveBandForProfile work against a purely test-local synthetic profile, never registered in METRIC_DEFINITIONS", () => {
  // Simulates a hypothetical future metric kind (e.g. absolute humidity,
  // g/m3 <-> mg/m3, a simple x1000 scale factor with no offset) entirely
  // outside the real registry, proving the generic functions don't assume
  // "temperature" or Fahrenheit-specific behavior anywhere.
  const gramProfile = {
    key: "gram_per_m3",
    toCanonical: (v) => v,
    fromCanonical: (v) => v,
    deltaToCanonical: (v) => v,
    deltaFromCanonical: (v) => v,
  };
  const milligramProfile = {
    key: "milligram_per_m3",
    toCanonical: (v) => v / 1000,
    fromCanonical: (v) => v * 1000,
    deltaToCanonical: (v) => v / 1000,
    deltaFromCanonical: (v) => v * 1000,
    thresholdRounding: (v) => Math.round(v * 100) / 100, // 2 decimal places, a different rounding rule than Fahrenheit's integer rule
  };

  assert.equal(el._convertUnitValue(5, "absolute", gramProfile, milligramProfile), 5000);
  assert.equal(el._convertUnitValue(5000, "absolute", milligramProfile, gramProfile), 5);
  assert.equal(el._convertUnitValue(2, "delta", gramProfile, milligramProfile), 2000);

  const syntheticTiers = [{ min: 0.5, levelKey: "test.low" }, { min: -Infinity, levelKey: "test.floor" }];
  const derived = el._deriveThresholdsForProfileFromTiers(syntheticTiers, milligramProfile);
  assert.equal(derived[0].min, 500);
  assert.equal(derived[1].min, -Infinity);

  const derivedBand = el._deriveBandForProfileFromBand({ min: 0.1, max: 0.5 }, milligramProfile);
  assert.deepEqual(normalize(derivedBand), { min: 100, max: 500 });
});

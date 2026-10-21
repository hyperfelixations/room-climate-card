"use strict";

// The generic MetricDefinition/UnitProfile/QuantityKind registry: native Fahrenheit and
// Kelvin, and room for future metric kinds. Tests import domain/metrics/access.js,
// domain/units/conversion.js and core/numbers.js directly with explicit fixtures — no
// element, no rendering. Celsius is the single maintained source: temperature tiers are
// wired to the indoor profile's tiers, not a second copy, and Fahrenheit thresholds are
// integers derived from it (16/18/19/20/21/23/24/25/26/28 °C -> 61/64/66/68/70/73/75/77/79/82 °F).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");

// Direct imports make the owner of each unit and metric contract explicit.
let access, conversion, projection, registry;

let env;
let el;

test.before(async () => {
  access = await import("../../../src/domain/metrics/access.js");
  conversion = await import("../../../src/domain/units/conversion.js");
  projection = await import("../../../src/domain/classification/projection.js");
  registry = await import("../../../src/domain/classification/registry.js");
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card"); // bare element, no setConfig() needed for pure-function calls
});
test.after(() => {
  env.cleanupAll();
});

// ---- Absolute round-trip invariants ----

test("absolute: -40 °C = -40 °F (the classic cross-check point)", () => {
  const f = access.convertMetricValue(-40, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(f, -40);
  const back = access.convertMetricValue(f, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "fahrenheit", toProfileKey: "celsius" });
  assert.equal(back, -40);
});

test("absolute: 0 °C = 32 °F, 100 °C = 212 °F", () => {
  assert.equal(access.convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 32);
  assert.equal(access.convertMetricValue(100, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 212);
});

test("absolute: 0 °C = 273.15 K, round-trips through celsius->kelvin->celsius", () => {
  const k = access.convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "kelvin" });
  assert.equal(k, 273.15);
  const back = access.convertMetricValue(k, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "kelvin", toProfileKey: "celsius" });
  assert.equal(back, 0);
});

test("absolute: celsius->celsius is a true identity (no accumulated float drift)", () => {
  assert.equal(access.convertMetricValue(21.4, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "celsius" }), 21.4);
});

test("absolute round-trip: an arbitrary value survives celsius->fahrenheit->celsius and celsius->kelvin->celsius within float epsilon", () => {
  for (const value of [-273.15, -40, -17.7, 0, 3.3, 21, 36.6, 100, 1000]) {
    const viaF = access.convertMetricValue(
      access.convertMetricValue(value, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }),
      { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "fahrenheit", toProfileKey: "celsius" }
    );
    assert.ok(Math.abs(viaF - value) < 1e-9, `celsius->fahrenheit->celsius for ${value} must round-trip, got ${viaF}`);

    const viaK = access.convertMetricValue(
      access.convertMetricValue(value, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "kelvin" }),
      { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "kelvin", toProfileKey: "celsius" }
    );
    assert.ok(Math.abs(viaK - value) < 1e-9, `celsius->kelvin->celsius for ${value} must round-trip, got ${viaK}`);
  }
});

// ---- Delta/rate must never apply the Fahrenheit offset ----

test("delta vs absolute: 0 °C converts differently depending on quantityKind (proves the offset is NOT applied to deltas)", () => {
  const absolute = access.convertMetricValue(0, { metricKind: "temperature", quantityKind: "absolute", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  const delta = access.convertMetricValue(0, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(absolute, 32, "an absolute 0 °C reading is 32 °F");
  assert.equal(delta, 0, "a 0 °C delta (no change) must stay 0, not pick up the +32 offset");
});

test("delta: 5 °C delta = 9 °F delta (scale factor only, no offset)", () => {
  assert.equal(access.convertMetricValue(5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }), 9);
});

test("delta: a negative Celsius delta (falling trend) converts with the same factor, still no offset", () => {
  const result = access.convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.ok(Math.abs(result - -0.54) < 1e-9, `expected -0.54, got ${result}`);
});

test("rate uses exactly the same conversion factor as delta (a rate is a delta per unit time; the time unit itself is untouched)", () => {
  const delta = access.convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  const rate = access.convertMetricValue(-0.3, { metricKind: "temperature", quantityKind: "rate", fromProfileKey: "celsius", toProfileKey: "fahrenheit" });
  assert.equal(rate, delta);
});

test("delta: Kelvin delta equals Celsius delta exactly (pure offset relationship, no scale factor)", () => {
  assert.equal(access.convertMetricValue(5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "celsius", toProfileKey: "kelvin" }), 5);
  assert.equal(access.convertMetricValue(-2.5, { metricKind: "temperature", quantityKind: "delta", fromProfileKey: "kelvin", toProfileKey: "celsius" }), -2.5);
});

// ---- Deterministic, integer Fahrenheit classification thresholds ----

// The temperature indoor profile as the card projects it into a display unit.
function projectedIndoor(profileKey) {
  const definition = access.getMetricDefinition("temperature");
  const canonical = registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor;
  return projection.projectProfile(canonical, definition, access.getUnitProfile("temperature", profileKey)).projected;
}

test("Fahrenheit classification thresholds are the exact required integers, derived from the single Celsius source", () => {
  const celsiusTiers = projectedIndoor("celsius").tiers;
  const fahrenheitTiers = projectedIndoor("fahrenheit").tiers;

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

test("the -Infinity tier survives Fahrenheit projection unchanged (no NaN/edge-case bug)", () => {
  const lowest = projectedIndoor("fahrenheit").tiers.find((t) => t.min === -Infinity);
  assert.ok(lowest, "the -Infinity tier must still be present after Fahrenheit projection");
  assert.equal(lowest.levelKey, "level.veryCold");
});

test("the canonical unit is the profile itself: Celsius returns the indoor profile, not a copy", () => {
  assert.equal(projectedIndoor("celsius"), registry.CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor);
});

test("levelKey/color are carried through unchanged for every projected Fahrenheit tier (only min is converted)", () => {
  const celsiusTiers = projectedIndoor("celsius").tiers;
  const fahrenheitTiers = projectedIndoor("fahrenheit").tiers;
  assert.equal(fahrenheitTiers.length, celsiusTiers.length);
  for (let i = 0; i < celsiusTiers.length; i++) {
    assert.equal(fahrenheitTiers[i].levelKey, celsiusTiers[i].levelKey);
    assert.equal(fahrenheitTiers[i].color, celsiusTiers[i].color);
  }
});

// ---- Fahrenheit comfort, optimal and base-scale bands ----

test("Fahrenheit bands are exactly 66-77 (scale), 68-75 (comfort) and 70-73 °F (optimal)", () => {
  const fahrenheit = projectedIndoor("fahrenheit");
  assert.deepEqual(normalize(fahrenheit.scale), { min: 66, max: 77 });
  assert.deepEqual(normalize(fahrenheit.comfort), { min: 68, max: 75 });
  assert.deepEqual(normalize(fahrenheit.optimal), { min: 70, max: 73 });
});

test("Celsius bands are the written ones", () => {
  const celsius = projectedIndoor("celsius");
  assert.deepEqual(normalize(celsius.comfort), { min: 20, max: 24 });
  assert.deepEqual(normalize(celsius.optimal), { min: 21, max: 23 });
  assert.deepEqual(normalize(celsius.scale), { min: 19, max: 25 });
});

// ---- Error paths: fail fast on internal contract violations, never NaN/undefined ----

test("_getMetricDefinition throws a descriptive error for an unregistered metricKind", () => {
  assert.throws(() => access.getMetricDefinition("pressure"), /pressure/);
});

test("_getUnitProfile throws a descriptive error for an unknown profile key", () => {
  assert.throws(() => access.getUnitProfile("temperature", "rankine"), /rankine/);
});

test("_convertMetricValue throws for an unknown quantityKind instead of silently returning NaN", () => {
  assert.throws(
    () => access.convertMetricValue(10, { metricKind: "temperature", quantityKind: "bogus", fromProfileKey: "celsius", toProfileKey: "fahrenheit" }),
    /bogus/
  );
});

// ---- Extension-point proof: the underlying pure functions are generic, not hardcoded to temperature ----

test("extension point: convertUnitValue/projectProfile work against a purely test-local synthetic profile, never registered in METRIC_DEFINITIONS", () => {
  // A synthetic metric kind (g/m3 <-> mg/m3, x1000, no offset) outside the real registry,
  // proving the generic functions assume neither "temperature" nor Fahrenheit behaviour.
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
    thresholdRounding: (v) => Math.round(v * 100) / 100, // 2 decimals — a different rule from Fahrenheit's integers
  };

  assert.equal(conversion.convertUnitValue(5, "absolute", gramProfile, milligramProfile), 5000);
  assert.equal(conversion.convertUnitValue(5000, "absolute", milligramProfile, gramProfile), 5);
  assert.equal(conversion.convertUnitValue(2, "delta", gramProfile, milligramProfile), 2000);

  const definition = { canonicalProfileKey: "gram_per_m3", unitProfiles: { gram_per_m3: gramProfile, milligram_per_m3: milligramProfile } };
  const synthetic = {
    tiers: [{ min: 0.5, levelKey: "test.low" }, { min: -Infinity, levelKey: "test.floor" }],
    comfort: { min: 0.1, max: 0.5 },
    optimal: { min: 0.2, max: 0.4 },
    scale: { min: 0, max: 1 },
    step: 0.1,
    validRange: null,
    invalidWhen: null,
  };
  const { projected, fault } = projection.projectProfile(synthetic, definition, milligramProfile);
  assert.equal(fault, null);
  assert.deepEqual(projected.tiers.map((tier) => tier.min), [500, -Infinity]);
  assert.deepEqual(normalize(projected.comfort), { min: 100, max: 500 });
  assert.equal(projected.step, 100);
});

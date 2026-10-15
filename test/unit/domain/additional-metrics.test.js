"use strict";

// PM1, PM4, PM10 and CO: independent profile and conversion expectations.
// Boundary probes pin the authored and projected thresholds, not just registration.
// Component tests own source arbitration and the assembled card's unit labels.
// See internal dev doc §5 "Classification und Profile".

const test = require("node:test");
const assert = require("node:assert/strict");

let metrics, registry, classification, projection, conversion, trend;
test.before(async () => {
  metrics = await import("../../../src/domain/metrics/definitions.js");
  registry = await import("../../../src/domain/classification/registry.js");
  classification = await import("../../../src/domain/classification/classify.js");
  projection = await import("../../../src/domain/classification/projection.js");
  conversion = await import("../../../src/domain/units/conversion.js");
  trend = await import("../../../src/domain/trend.js");
});

const EXPECTED = {
  pm1: { thresholds: [50, 35, 25, 15, 5], comfort: 15, optimal: 5, scale: 20, step: 5, deadband: 0.5 },
  pm4: { thresholds: [50, 35, 25, 15, 5], comfort: 15, optimal: 5, scale: 20, step: 5, deadband: 0.5 },
  pm10: { thresholds: [150, 100, 75, 45, 15], comfort: 45, optimal: 15, scale: 60, step: 15, deadband: 0.5 },
  co: { thresholds: [35, 10, 7, 4, 1], comfort: 4, optimal: 1, scale: 12, step: 1, deadband: 0.1 },
};

for (const [kind, expected] of Object.entries(EXPECTED)) {
  test(`${kind}: all six levels, bands, axis, validity and trend boundaries`, () => {
    const p = registry.CLASSIFICATION_PROFILE_REGISTRY[kind]?.profiles.indoor;
    assert.ok(p, `${kind} is registered`);
    assert.deepEqual(p.tiers.map((tier) => tier.min), [...expected.thresholds, -Infinity]);
    assert.deepEqual(p.tiers.map((tier) => tier.score), [5, 4, 3, 2, 1, 0]);
    assert.equal(p.comparison, ">=");
    assert.equal(p.oneSided, true);
    assert.deepEqual(p.comfort, { min: 0, max: expected.comfort });
    assert.deepEqual(p.optimal, { min: 0, max: expected.optimal });
    assert.deepEqual(p.scale, { min: 0, max: expected.scale });
    assert.equal(p.step, expected.step);
    assert.equal(p.headroom, expected.step);
    assert.equal(classification.classifyNumericValue(p, -0.01).invalid, true);
    assert.equal(classification.classifyNumericValue(p, 0).score, 0);
    expected.thresholds.forEach((threshold, i) => {
      for (const [value, score] of [[threshold - 1e-6, 4 - i], [threshold, 5 - i], [threshold + 1e-6, 5 - i]]) {
        assert.equal(classification.classifyNumericValue(p, value).score, score, `${kind}: ${value}`);
      }
    });
    const policy = trend.TREND_POLICY_REGISTRY[kind];
    assert.equal(trend.classifyTrendRate(expected.deadband, policy), "stable");
    assert.equal(trend.classifyTrendRate(-expected.deadband, policy), "stable");
    assert.equal(trend.classifyTrendRate(expected.deadband + 1e-6, policy), "rising");
    assert.equal(trend.classifyTrendRate(-expected.deadband - 1e-6, policy), "falling");
  });
}

test("CO: the four units share HA's 20 °C, 1 atm reference in every quantity path", () => {
  const def = metrics.METRIC_DEFINITIONS.co;
  assert.ok(def, "CO is registered");
  assert.equal(def.canonicalUnit, "mg/m³");
  const reference = { milligram_per_m3: 1.164409225500478, microgram_per_m3: 1164.409225500478, ppm: 1, ppb: 1000 };
  assert.deepEqual(Object.keys(def.unitProfiles).sort(), Object.keys(reference).sort());
  for (const quantity of ["absolute", "delta", "rate"]) {
    for (const [from, value] of Object.entries(reference)) {
      for (const [to, expected] of Object.entries(reference)) {
        const actual = conversion.convertUnitValue(value, quantity, def.unitProfiles[from], def.unitProfiles[to]);
        assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 2e-15, `${quantity}: ${from} → ${to}`);
        assert.equal(conversion.convertUnitValue(0, quantity, def.unitProfiles[from], def.unitProfiles[to]), 0);
      }
    }
  }
  assert.ok(Number.isFinite(def.unitProfiles.ppb.toCanonical(1e308)), "a finite mass concentration has no intermediate overflow");
  assert.equal(def.unitProfiles.ppm.toCanonical(Number.MAX_VALUE), Infinity, "a true overflow remains detectable");
});

test("CO: every unit projects readable distinct thresholds without losing the physical zero", () => {
  const def = metrics.METRIC_DEFINITIONS.co;
  assert.ok(def);
  const p = registry.CLASSIFICATION_PROFILE_REGISTRY.co.profiles.indoor;
  const expected = {
    milligram_per_m3: [35, 10, 7, 4, 1],
    microgram_per_m3: [35000, 10000, 7000, 4000, 1000],
    ppm: [30, 8.5, 6, 3.4, 0.8],
    ppb: [30058, 8588, 6011, 3435, 858],
  };
  for (const [key, unit] of Object.entries(def.unitProfiles)) {
    const { projected, fault } = projection.projectProfile(p, def, unit);
    assert.equal(fault, null, key);
    assert.deepEqual(projected.tiers.slice(0, -1).map((tier) => tier.min), expected[key]);
    assert.equal(projected.validRange.min, 0);
    for (const tier of projected.tiers.slice(0, -1)) assert.equal(classification.classifyNumericValue(projected, tier.min).score, tier.score);
    if (unit.thresholdRounding) {
      assert.equal(unit.thresholdRounding(-0), 0);
      assert.equal(Object.is(unit.thresholdRounding(-0), -0), false);
      assert.ok(Number.isFinite(unit.thresholdRounding(1e308)));
    }
  }
  const rounding = def.unitProfiles.ppm.thresholdRounding;
  for (const value of [0.8, 3.4, 6, 8.5, 30]) {
    assert.equal(rounding(def.unitProfiles.ppm.fromCanonical(def.unitProfiles.ppm.toCanonical(value))), value);
  }
});

"use strict";

// Direct unit tests for src/domain/trend.js.
//
// The deadband is what keeps a trend arrow from flickering on sensor noise, and
// the epsilon around it is what keeps a converted Fahrenheit rate from landing
// just outside an exact boundary. Both are easy to get subtly wrong and
// invisible in a screenshot, so the boundaries are asserted from below, exactly
// on, and above — in both directions.

const test = require("node:test");
const assert = require("node:assert/strict");

let trend;

const METRIC_KINDS = ["temperature", "humidity", "co2", "pm25"];

test.before(async () => {
  trend = await import("../../../src/domain/trend.js");
});

test("every metric kind has a frozen, symmetric deadband policy", () => {
  assert.deepEqual(Object.keys(trend.TREND_POLICY_REGISTRY).sort(), [...METRIC_KINDS].sort());
  assert.equal(Object.isFrozen(trend.TREND_POLICY_REGISTRY), true);
  for (const kind of METRIC_KINDS) {
    const policy = trend.TREND_POLICY_REGISTRY[kind];
    assert.equal(Object.isFrozen(policy), true, `${kind}: policy must be frozen`);
    assert.ok(policy.fallingBelow < 0, `${kind}: fallingBelow must be negative`);
    assert.ok(policy.risingAbove > 0, `${kind}: risingAbove must be positive`);
    assert.equal(
      policy.fallingBelow,
      -policy.risingAbove,
      `${kind}: today's policies are symmetric (the fields stay separate so an asymmetric override stays possible)`
    );
  }
});

test("the deadband values are unchanged", () => {
  assert.deepEqual({ ...trend.TREND_POLICY_REGISTRY.temperature }, { fallingBelow: -0.1, risingAbove: 0.1 });
  assert.deepEqual({ ...trend.TREND_POLICY_REGISTRY.humidity }, { fallingBelow: -0.5, risingAbove: 0.5 });
  assert.deepEqual({ ...trend.TREND_POLICY_REGISTRY.co2 }, { fallingBelow: -25, risingAbove: 25 });
  assert.deepEqual({ ...trend.TREND_POLICY_REGISTRY.pm25 }, { fallingBelow: -0.5, risingAbove: 0.5 });
});

test("each direction maps to its translation key and nothing else", () => {
  assert.deepEqual(Object.keys(trend.TREND_DIRECTION_META).sort(), ["falling", "rising", "stable"]);
  assert.equal(trend.TREND_DIRECTION_META.rising.translationKey, "trend.direction.rising");
  assert.equal(trend.TREND_DIRECTION_META.stable.translationKey, "trend.direction.stable");
  assert.equal(trend.TREND_DIRECTION_META.falling.translationKey, "trend.direction.falling");
  assert.equal(Object.isFrozen(trend.TREND_DIRECTION_META), true);
  for (const meta of Object.values(trend.TREND_DIRECTION_META)) {
    assert.deepEqual(Object.keys(meta), ["translationKey"], "domain metadata carries keys, not translated text");
  }
});

test("classifyTrendRate() returns the sign of a clearly moving rate", () => {
  for (const kind of METRIC_KINDS) {
    const policy = trend.TREND_POLICY_REGISTRY[kind];
    const far = Math.abs(policy.risingAbove) * 10;
    assert.equal(trend.classifyTrendRate(far, policy), "rising", `${kind}: +${far}`);
    assert.equal(trend.classifyTrendRate(-far, policy), "falling", `${kind}: -${far}`);
    assert.equal(trend.classifyTrendRate(0, policy), "stable", `${kind}: exactly zero`);
  }
});

test("a rate exactly on either boundary stays stable (the deadband is closed)", () => {
  for (const kind of METRIC_KINDS) {
    const policy = trend.TREND_POLICY_REGISTRY[kind];
    assert.equal(trend.classifyTrendRate(policy.risingAbove, policy), "stable", `${kind}: exactly risingAbove`);
    assert.equal(trend.classifyTrendRate(policy.fallingBelow, policy), "stable", `${kind}: exactly fallingBelow`);
  }
});

test("a rate just inside the deadband is stable, just outside it moves", () => {
  for (const kind of METRIC_KINDS) {
    const policy = trend.TREND_POLICY_REGISTRY[kind];
    const step = Math.abs(policy.risingAbove) * 0.05;
    assert.equal(trend.classifyTrendRate(policy.risingAbove - step, policy), "stable", `${kind}: just inside upper`);
    assert.equal(trend.classifyTrendRate(policy.fallingBelow + step, policy), "stable", `${kind}: just inside lower`);
    assert.equal(trend.classifyTrendRate(policy.risingAbove + step, policy), "rising", `${kind}: just outside upper`);
    assert.equal(trend.classifyTrendRate(policy.fallingBelow - step, policy), "falling", `${kind}: just outside lower`);
  }
});

test("the epsilon absorbs unit-conversion noise but not a real excursion", () => {
  const policy = trend.TREND_POLICY_REGISTRY.temperature;
  // 0.18 °F/h converts to 0.1 °C/h, but floating point lands a hair off the
  // exact boundary — that must not read as "rising".
  const converted = (0.18 * 5) / 9;
  assert.notEqual(converted, 0.1, "sanity: the conversion really is inexact");
  assert.equal(trend.classifyTrendRate(converted, policy), "stable", "machine-scale noise stays stable");
  // A materially larger value must still change direction.
  assert.equal(trend.classifyTrendRate(0.1001, policy), "rising", "a real excursion still registers");
  assert.equal(trend.classifyTrendRate(-0.1001, policy), "falling");
});

test("classifyTrendRate() returns null instead of guessing for unusable input", () => {
  const policy = trend.TREND_POLICY_REGISTRY.temperature;
  for (const value of [NaN, Infinity, -Infinity, null, undefined, "0.5"]) {
    assert.equal(trend.classifyTrendRate(value, policy), null, `value ${String(value)}`);
  }
  for (const missing of [null, undefined, 0, ""]) {
    assert.equal(trend.classifyTrendRate(0.5, missing), null, `policy ${String(missing)}`);
  }
});

test("negative zero is treated as stable, not as falling", () => {
  assert.equal(trend.classifyTrendRate(-0, trend.TREND_POLICY_REGISTRY.temperature), "stable");
});

test("co2's much wider deadband is genuinely applied", () => {
  // A 10 ppm/h drift is noise; the same number would be a strong trend for
  // temperature. This guards against a policy lookup that silently falls back
  // to the temperature policy.
  const co2 = trend.TREND_POLICY_REGISTRY.co2;
  assert.equal(trend.classifyTrendRate(10, co2), "stable");
  assert.equal(trend.classifyTrendRate(30, co2), "rising");
  assert.equal(trend.classifyTrendRate(10, trend.TREND_POLICY_REGISTRY.temperature), "rising");
});

"use strict";

// Direct unit tests for scale configuration, dynamic axes, and marker/band geometry — the
// src/domain/scale family, which evolves together.
// Boundary: classification projection, palette choice and icons are
// domain-services-modules.test.js. See interne Doku §5 „Scale- und Geometry-System".

const test = require("node:test");
const assert = require("node:assert/strict");

let registry;
let scaleConfig;
let dynamicScaleModule;
let geometry;

test.before(async () => {
  registry = await import("../../../src/domain/classification/registry.js");
  scaleConfig = await import("../../../src/domain/scale/scale-config.js");
  dynamicScaleModule = await import("../../../src/domain/scale/dynamic-scale.js");
  geometry = await import("../../../src/domain/scale/geometry.js");
});

const temperatureRegistry = () => registry.CLASSIFICATION_PROFILE_REGISTRY.temperature;

// ----------------------------------------------------------- scale config --

test("scaleConfigFor() makes the two defaults explicit", () => {
  const indoor = scaleConfig.scaleConfigFor(temperatureRegistry().profiles.indoor);
  assert.deepEqual(indoor.comfort, { min: 20, max: 24 });
  assert.equal(indoor.step, 1);
  assert.equal(indoor.oneSided, false, "an absent oneSided becomes false");
  assert.equal(indoor.anchorScale, true, "an absent anchorScale becomes true");
  assert.equal(indoor.headroom, undefined);

  const outdoor = scaleConfig.scaleConfigFor(temperatureRegistry().profiles.outdoor);
  assert.equal(outdoor.anchorScale, false, "outdoor opts out of the anchored axis");
  assert.equal(outdoor.scale, null, "and therefore declares no reference range to anchor to");
  assert.equal(
    scaleConfig.scaleConfigFor({ ...temperatureRegistry().profiles.indoor, scale: undefined }).scale,
    null,
    "an absent range normalizes to the same null the config layer produces"
  );

  const co2 = scaleConfig.scaleConfigFor(registry.CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor);
  assert.equal(co2.oneSided, true);
  assert.equal(co2.headroom, 100);
});

// ---------------------------------------------------------- dynamic scale --

const INDOOR_C = { comfort: { min: 20, max: 24 }, optimal: { min: 21, max: 23 }, scale: { min: 19, max: 25 }, step: 1, oneSided: false, headroom: undefined, anchorScale: true };

test("an anchored axis never shrinks below the reference scale", () => {
  const result = dynamicScaleModule.dynamicScale(21, 22, INDOOR_C, undefined);
  assert.deepEqual(result, { min: 19, max: 25, step: 1 });
});

test("an anchored axis grows outwards with a one-step buffer", () => {
  assert.deepEqual(dynamicScaleModule.dynamicScale(15, 30, INDOOR_C, undefined), { min: 14, max: 31, step: 1 });
  assert.deepEqual(dynamicScaleModule.dynamicScale(18.5, 25.5, INDOOR_C, undefined), { min: 17, max: 27, step: 1 });
});

test("an unanchored axis follows the data only", () => {
  const outdoor = { ...INDOOR_C, scale: null, anchorScale: false };
  assert.deepEqual(dynamicScaleModule.dynamicScale(-3, 9, outdoor, undefined), { min: -4, max: 10, step: 1 });
  assert.deepEqual(
    dynamicScaleModule.dynamicScale(20, 20, outdoor, undefined),
    { min: 19, max: 21, step: 1 },
    "a single reading gives the narrow axis around it that following the data means"
  );
});

// Every call site feeds finite values (see buildScaleAxis()), so this is the defensive
// path: an unanchored axis with no reference range must still be finite and divisible,
// because every marker position divides by it.
test("an unanchored axis stays finite and ordered even without usable readings", () => {
  const unanchored = { ...INDOOR_C, scale: null, anchorScale: false };
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x"]) {
    const result = dynamicScaleModule.dynamicScale(bad, bad, unanchored, undefined);
    assert.ok(Number.isFinite(result.min) && Number.isFinite(result.max), JSON.stringify(String(bad)));
    assert.ok(result.min < result.max, JSON.stringify(String(bad)));
  }
});

test("a one-sided axis keeps its lower bound rooted", () => {
  const co2 = { comfort: { min: 0, max: 1000 }, optimal: { min: 0, max: 800 }, scale: { min: 0, max: 1200 }, step: 200, oneSided: true, headroom: 100, anchorScale: true };
  assert.deepEqual(dynamicScaleModule.dynamicScale(400, 1500, co2, undefined), { min: 0, max: 1600, step: 200 });
  assert.deepEqual(dynamicScaleModule.dynamicScale(-500, 500, co2, undefined), { min: 0, max: 1200, step: 200 }, "a negative low cannot pull the axis below zero");
});

test("an explicit headroom replaces the one-step buffer", () => {
  const wide = { ...INDOOR_C, headroom: 5 };
  assert.deepEqual(dynamicScaleModule.dynamicScale(20, 26, wide, undefined), { min: 15, max: 31, step: 1 });
});

test("non-finite bounds fall back to the reference scale", () => {
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x"]) {
    const result = dynamicScaleModule.dynamicScale(bad, bad, INDOOR_C, undefined);
    assert.ok(Number.isFinite(result.min) && Number.isFinite(result.max), JSON.stringify(String(bad)));
    assert.ok(result.min < result.max, JSON.stringify(String(bad)));
  }
});

test("a degenerate axis is widened by one step rather than dividing by zero", () => {
  const degenerate = { comfort: { min: 5, max: 6 }, optimal: { min: 5, max: 6 }, scale: { min: 5, max: 5 }, step: 1, oneSided: true, headroom: 0, anchorScale: false };
  const result = dynamicScaleModule.dynamicScale(5, 5, degenerate, undefined);
  assert.ok(result.max > result.min, `got ${JSON.stringify(result)}`);
});

test("Fahrenheit's dynamic steps widen with the displayed span", () => {
  const steps = [
    { maxSpan: 20, step: 2 },
    { maxSpan: 40, step: 5 },
    { maxSpan: Infinity, step: 10 },
  ];
  const base = { min: 66, max: 77 };
  for (const [low, high, expected] of [[68, 75, 2], [50, 80, 5], [-10, 110, 10]]) {
    const step = dynamicScaleModule.resolveDynamicStep(2, steps, low, high, base.min, base.max, true);
    assert.equal(step, expected, `span ${low}..${high}`);
  }
});

test("resolveDynamicStep() keeps the fixed step when a profile declares none", () => {
  assert.equal(dynamicScaleModule.resolveDynamicStep(5, undefined, 0, 100, 35, 65, true), 5);
  assert.equal(dynamicScaleModule.resolveDynamicStep(200, null, 0, 5000, 0, 1200, true), 200);
});

test("resolveDynamicStep() measures the anchored span, not just the data span", () => {
  const steps = [{ maxSpan: 20, step: 2 }, { maxSpan: Infinity, step: 10 }];
  // Data span is 4, but anchoring widens it to 66..90 = 24.
  assert.equal(dynamicScaleModule.resolveDynamicStep(2, steps, 86, 90, 66, 77, true), 10);
  assert.equal(dynamicScaleModule.resolveDynamicStep(2, steps, 86, 90, 66, 77, false), 2, "unanchored sees only the data");
});

// -------------------------------------------------------------- geometry --

test("rangePosition() returns a left edge and a width in percent", () => {
  const band = geometry.rangePosition(20, 24, 19, 25);
  // Tolerance: the width is right-minus-left, not bit-identical to (4/6)*100.
  assert.ok(Math.abs(band.left - (1 / 6) * 100) < 1e-9, `left ${band.left}`);
  assert.ok(Math.abs(band.width - (4 / 6) * 100) < 1e-9, `width ${band.width}`);
  assert.deepEqual(geometry.rangePosition(19, 25, 19, 25), { left: 0, width: 100 });
});

test("rangePosition() tolerates an inverted pair and clamps outside values", () => {
  const inverted = geometry.rangePosition(24, 20, 19, 25);
  const normal = geometry.rangePosition(20, 24, 19, 25);
  assert.deepEqual(inverted, normal, "the band is the same either way round");
  assert.deepEqual(geometry.rangePosition(-100, 100, 0, 10), { left: 0, width: 100 }, "clamped, never negative or past 100");
});

test("scaleGeometry() reports band positions and their centres", () => {
  const result = geometry.scaleGeometry(20, 24, 21, 23, 19, 25);
  assert.equal(result.scaleMin, 19);
  assert.equal(result.scaleMax, 25);
  assert.equal(result.optimalMin, 21);
  assert.equal(result.optimalMax, 23);
  assert.ok(Math.abs(result.comfortCenter - 50) < 1e-9);
  assert.ok(Math.abs(result.optimalCenter - 50) < 1e-9);
  assert.equal(result.comfortVisible, true);
  assert.equal(result.optimalVisible, true);
});

test("a band wholly outside the axis is reported as not visible", () => {
  // A winter outdoor axis at -8..-2 cannot show a 14..26 comfort band.
  const result = geometry.scaleGeometry(14, 26, 18, 22, -8, -2);
  assert.equal(result.comfortVisible, false);
  assert.equal(result.optimalVisible, false);
  assert.equal(result.scaleMin, -8, "the configured bounds stay in the model regardless");
});

test("a band touching the axis edge is still not visible", () => {
  assert.equal(geometry.scaleGeometry(25, 30, 26, 28, 19, 25).comfortVisible, false, "starts exactly at scaleMax");
  assert.equal(geometry.scaleGeometry(10, 19, 12, 15, 19, 25).comfortVisible, false, "ends exactly at scaleMin");
  assert.equal(geometry.scaleGeometry(10, 19.1, 12, 15, 19, 25).comfortVisible, true, "the slightest overlap counts");
});

test("markerPositions() maps every named marker onto the axis", () => {
  const result = geometry.markerPositions({ avg: 22, coolest: 19, warmest: 25 }, 19, 25);
  assert.equal(result.coolest, 0);
  assert.equal(result.warmest, 100);
  assert.equal(result.avg, 50);
});

test("markerPositions() clamps markers outside the axis and handles no markers", () => {
  const result = geometry.markerPositions({ below: -100, above: 1000 }, 0, 10);
  assert.equal(result.below, 0);
  assert.equal(result.above, 100);
  assert.deepEqual(geometry.markerPositions({}, 0, 10), {});
  assert.deepEqual(geometry.markerPositions(null, 0, 10), {});
  assert.deepEqual(geometry.markerPositions(undefined, 0, 10), {});
});

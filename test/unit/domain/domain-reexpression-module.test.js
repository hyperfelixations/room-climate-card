"use strict";

// Direct unit tests for domain/classification/reexpression.js: which numbers of a profile a
// re-expression converts and how, and which fault it names when a converted number became
// unusable. The two callers own their own contracts: domain-services-modules.test.js the
// projection into a display unit, test/unit/config/ the conversion of a custom profile.

const test = require("node:test");
const assert = require("node:assert/strict");

let reexpression;
let registry;
let definitions;

test.before(async () => {
  reexpression = await import("../../../src/domain/classification/reexpression.js");
  registry = await import("../../../src/domain/classification/registry.js");
  definitions = await import("../../../src/domain/metrics/definitions.js");
});

const IDENTITY = { absolute: (value) => value, delta: (value) => value };
// An offset unit, so an absolute and a delta conversion can be told apart.
const LINEAR = { absolute: (value) => value * 2 + 100, delta: (value) => value * 2 };

const CUSTOM_PROFILE = Object.freeze({
  id: "custom",
  metricKind: "temperature",
  unit: "°F",
  comparison: ">=",
  tiers: [
    { min: 30, score: 2, level: "Hot", color: "#AA0000", zone: "outside" },
    { min: 20, score: 1, level: "Warm", color: null, zone: "comfort" },
    { min: 10, score: 0, level: "Ideal", color: null, zone: "optimal" },
    { min: -Infinity, score: -1, level: "Cold", color: null, zone: "outside" },
  ],
  comfort: { min: 5, max: 25 },
  optimal: { min: 10, max: 20 },
  scale: { min: 0, max: 40 },
  step: 2,
  headroom: 3,
  oneSided: false,
  anchorScale: true,
  validRange: { min: -10, max: null, minInclusive: true, maxInclusive: false },
  invalidWhen: (reading) => reading < -10,
  invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
  iconTiers: [
    { min: 30, icon: "mdi:fire" },
    { min: 10, icon: "mdi:thermometer" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
});

// A source profile and its identity re-expression, to break one number of the result at a time.
function reexpressed(patch = {}) {
  const source = { ...CUSTOM_PROFILE, ...patch };
  return { source, result: reexpression.reexpressProfile(source, IDENTITY) };
}

// ------------------------------------------------------- re-expression ------

test("every boundary goes through `absolute`, step and headroom through `delta`", () => {
  const result = reexpression.reexpressProfile(CUSTOM_PROFILE, LINEAR);
  assert.deepEqual(result.tiers.map((tier) => tier.min), [160, 140, 120, -Infinity]);
  assert.deepEqual(result.comfort, { min: 110, max: 150 });
  assert.deepEqual(result.optimal, { min: 120, max: 140 });
  assert.deepEqual(result.scale, { min: 100, max: 180 });
  assert.equal(result.step, 4);
  assert.equal(result.headroom, 6);
  assert.deepEqual(result.validRange, { min: 80, max: null, minInclusive: true, maxInclusive: false });
  assert.deepEqual(result.iconTiers.map((tier) => tier.min), [160, 120, -Infinity]);
});

test("everything but the numbers is carried over unchanged, and the source is left alone", () => {
  const before = JSON.stringify(CUSTOM_PROFILE);
  const result = reexpression.reexpressProfile(CUSTOM_PROFILE, LINEAR);
  assert.equal(JSON.stringify(CUSTOM_PROFILE), before);
  for (const key of ["id", "metricKind", "unit", "comparison", "oneSided", "anchorScale", "invalidClassification"]) {
    assert.equal(result[key], CUSTOM_PROFILE[key], key);
  }
  result.tiers.forEach((tier, index) => assert.deepEqual({ ...tier, min: null }, { ...CUSTOM_PROFILE.tiers[index], min: null }));
  result.iconTiers.forEach((tier, index) => assert.equal(tier.icon, CUSTOM_PROFILE.iconTiers[index].icon));
});

test("the validity window decides in the new unit", () => {
  const { invalidWhen } = reexpression.reexpressProfile(CUSTOM_PROFILE, LINEAR);
  // -10 in the source unit is 80 in the new one; the source predicate would answer for -10.
  assert.equal(invalidWhen(79.9), true);
  assert.equal(invalidWhen(80), false);
  assert.equal(invalidWhen(-5), true);
  assert.equal(invalidWhen(1e300), false, "an open upper bound stays open");
});

test("a part the profile does not have stays absent", () => {
  const builtInPredicate = (reading) => reading < 0;
  const result = reexpression.reexpressProfile(
    { ...CUSTOM_PROFILE, scale: null, headroom: undefined, validRange: null, invalidWhen: builtInPredicate, iconTiers: null },
    LINEAR
  );
  assert.equal(result.scale, null);
  assert.equal(result.headroom, undefined);
  assert.equal(result.validRange, null);
  assert.equal(result.invalidWhen, builtInPredicate, "a profile without a window keeps its own predicate");
  assert.equal(result.iconTiers, null);
  assert.equal(reexpression.reexpressProfile({ ...CUSTOM_PROFILE, iconTiers: undefined }, LINEAR).iconTiers, undefined);
});

test("a separate step conversion widens the step and leaves headroom an exact delta", () => {
  const result = reexpression.reexpressProfile(CUSTOM_PROFILE, { ...LINEAR, step: (value) => value * 2 + 1 });
  assert.equal(result.step, 5);
  assert.equal(result.headroom, 6);
});

// Exact maps, no rounding: over every shipped profile and every unit its kind displays in,
// re-expressing there and back restores each number and keeps every order intact.
test("every built-in profile survives every unit of its kind there and back", () => {
  const close = (actual, expected) => actual === expected || Math.abs(actual - expected) <= Math.abs(expected) * 1e-12 + 1e-12;
  for (const [kind, { profiles }] of Object.entries(registry.CLASSIFICATION_PROFILE_REGISTRY)) {
    for (const [unitKey, unit] of Object.entries(definitions.METRIC_DEFINITIONS[kind].unitProfiles)) {
      for (const [profileId, profile] of Object.entries(profiles)) {
        const label = `${kind}/${profileId} -> ${unitKey}`;
        const there = reexpression.reexpressProfile(profile, { absolute: unit.fromCanonical, delta: unit.deltaFromCanonical });
        assert.equal(reexpression.findReexpressionFault(profile, there), null, label);
        const back = reexpression.reexpressProfile(there, { absolute: unit.toCanonical, delta: unit.deltaToCanonical });
        const numbers = (p) => [
          ...p.tiers.map((tier) => tier.min),
          p.comfort.min, p.comfort.max, p.optimal.min, p.optimal.max,
          ...(p.scale ? [p.scale.min, p.scale.max] : []),
          p.step,
          ...(p.headroom === undefined ? [] : [p.headroom]),
          ...(p.validRange ? [p.validRange.min, p.validRange.max].filter((bound) => bound !== null) : []),
          ...(p.iconTiers ?? []).map((tier) => tier.min),
        ];
        numbers(back).forEach((value, index) => assert.ok(close(value, numbers(profile)[index]), `${label}: ${value} vs ${numbers(profile)[index]}`));
      }
    }
  }
});

// ---------------------------------------------------------------- faults ----

test("a re-expression that keeps every number usable has no fault", () => {
  assert.equal(reexpression.findReexpressionFault(CUSTOM_PROFILE, reexpression.reexpressProfile(CUSTOM_PROFILE, LINEAR)), null);
  const { source, result } = reexpressed({ scale: null, headroom: undefined, validRange: null, iconTiers: null });
  assert.equal(reexpression.findReexpressionFault(source, result), null, "absent parts are not checked");
});

test("a finite number that is no longer finite is an overflow at the path it is written under", () => {
  const withMax = { validRange: { ...CUSTOM_PROFILE.validRange, max: 60 } };
  const cases = [
    ["classification.bands.comfort.min", {}, (r) => { r.comfort.min = -Infinity; }],
    ["classification.bands.comfort.max", {}, (r) => { r.comfort.max = Infinity; }],
    ["classification.bands.optimal.min", {}, (r) => { r.optimal.min = NaN; }],
    ["classification.bands.optimal.max", {}, (r) => { r.optimal.max = Infinity; }],
    ["classification.scale.min", {}, (r) => { r.scale.min = -Infinity; }],
    ["classification.scale.max", {}, (r) => { r.scale.max = Infinity; }],
    ["classification.scale.step", {}, (r) => { r.step = Infinity; }],
    ["classification.scale.headroom", {}, (r) => { r.headroom = Infinity; }],
    ["classification.tiers[0].min", {}, (r) => { r.tiers[0].min = Infinity; }],
    ["classification.tiers[2].min", {}, (r) => { r.tiers[2].min = -Infinity; }],
    ["classification.valid_range.min", {}, (r) => { r.validRange.min = -Infinity; }],
    ["classification.valid_range.max", withMax, (r) => { r.validRange.max = Infinity; }],
    ["classification.icons[1].min", {}, (r) => { r.iconTiers[1].min = -Infinity; }],
  ];
  for (const [field, patch, breakIt] of cases) {
    const { source, result } = reexpressed(patch);
    breakIt(result);
    assert.deepEqual(reexpression.findReexpressionFault(source, result), { kind: "overflow", field }, field);
  }
});

test("a band, step or descending list that became empty or unordered is a collapse at its last value", () => {
  const withMax = { validRange: { ...CUSTOM_PROFILE.validRange, max: 60 } };
  const cases = [
    ["classification.bands.comfort.max", {}, (r) => { r.comfort.max = r.comfort.min; }],
    ["classification.bands.optimal.max", {}, (r) => { r.optimal.max = r.optimal.min - 1; }],
    ["classification.scale.max", {}, (r) => { r.scale.max = r.scale.min; }],
    ["classification.scale.step", {}, (r) => { r.step = 0; }],
    ["classification.tiers[1].min", {}, (r) => { r.tiers[1].min = r.tiers[0].min; }],
    ["classification.valid_range.max", withMax, (r) => { r.validRange.max = r.validRange.min; }],
    ["classification.icons[2].min", {}, (r) => { r.iconTiers[2].min = r.iconTiers[1].min; }],
  ];
  for (const [field, patch, breakIt] of cases) {
    const { source, result } = reexpressed(patch);
    breakIt(result);
    assert.deepEqual(reexpression.findReexpressionFault(source, result), { kind: "collapse", field }, field);
  }
});

test("an open end, an absent headroom and an open valid_range bound are not numbers that can break", () => {
  const { source, result } = reexpressed({ headroom: undefined });
  result.tiers[3].min = -Infinity;
  result.headroom = undefined;
  result.validRange.max = null;
  assert.equal(reexpression.findReexpressionFault(source, result), null);
});

// null compares as 0 in `<`, so the sign of the closed bound must not decide.
test("a valid_range open on one side is never a collapse, whatever the sign of its other bound", () => {
  const windows = [
    { min: 0, max: null },
    { min: 400, max: null },
    { min: null, max: 0 },
    { min: null, max: -40 },
  ];
  for (const window of windows) {
    const { source, result } = reexpressed({ validRange: { ...window, minInclusive: false, maxInclusive: true } });
    assert.equal(reexpression.findReexpressionFault(source, result), null, JSON.stringify(window));
  }
});

// The order the YAML is validated in, so a profile with several faults is refused at the same
// value whichever unit converts it: part by part, and within a part an overflow first.
test("with several faults, the first in YAML order is named", () => {
  const faults = [
    [{ kind: "overflow", field: "classification.bands.comfort.max" }, (r) => { r.comfort.max = Infinity; }],
    [{ kind: "collapse", field: "classification.bands.optimal.max" }, (r) => { r.optimal.max = r.optimal.min; }],
    [{ kind: "overflow", field: "classification.scale.min" }, (r) => { r.scale.min = -Infinity; }],
    [{ kind: "collapse", field: "classification.scale.step" }, (r) => { r.step = 0; }],
    [{ kind: "overflow", field: "classification.scale.headroom" }, (r) => { r.headroom = Infinity; }],
    [{ kind: "overflow", field: "classification.tiers[2].min" }, (r) => { r.tiers[2].min = -Infinity; }],
    [{ kind: "collapse", field: "classification.tiers[1].min" }, (r) => { r.tiers[1].min = r.tiers[0].min; }],
    [{ kind: "collapse", field: "classification.valid_range.max" }, (r) => { r.validRange.max = r.validRange.min; }],
    [{ kind: "collapse", field: "classification.icons[1].min" }, (r) => { r.iconTiers[1].min = r.iconTiers[0].min; }],
  ];
  for (let first = 0; first < faults.length; first++) {
    const { source, result } = reexpressed({ validRange: { ...CUSTOM_PROFILE.validRange, max: 60 } });
    for (const [, breakIt] of faults.slice(first)) breakIt(result);
    assert.deepEqual(reexpression.findReexpressionFault(source, result), faults[first][0]);
  }
});

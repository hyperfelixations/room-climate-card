"use strict";

// A custom unit may belong to several measurements with different canonical units.
// Structural validation runs once; each canonical variant succeeds or carries its fault.
// Runtime selection belongs to application/classification-policy.test.js.
// These injected profiles are synthetic and independent of the product registry.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PROFILE_REEXPRESSION } = require("../../helpers/profile-reexpression.js");
let config;
test.before(async () => { config = await import("../../../src/config/classification/normalize.js"); });

const profile = (factor) => ({ key: `times_${factor}`, toCanonical: (v) => v * factor, deltaToCanonical: (v) => v * factor });
const collaborators = {
  metricKindsForUnit: (unit) => unit === "shared" ? ["first", "second"] : [],
  unitProfileForUnit: (kind) => profile(kind === "first" ? 1 : 2),
  profileReexpression: PROFILE_REEXPRESSION,
  classificationZones: ["optimal", "comfort", "outside", "invalid"],
};
const custom = (overrides = {}) => ({
  unit: "shared", bands: { comfort: { min: 0, max: 10 }, optimal: { min: 0, max: 2 } },
  scale: { min: 0, max: 20, step: 1 },
  tiers: [{ min: 10, score: 1, level: "High", zone: "outside" }, { default: true, score: 0, level: "Low", zone: "optimal" }],
  ...overrides,
});

test("a shared unit compiles separate canonical variants without changing the input", () => {
  const input = custom();
  const before = JSON.stringify(input);
  const result = config.normalizeCustomClassification(input, collaborators);
  assert.equal(result.unit, "shared");
  assert.deepEqual(Object.keys(result.profiles), ["first", "second"]);
  assert.deepEqual(result.faults, {});
  assert.equal(result.profiles.first.tiers[0].min, 10);
  assert.equal(result.profiles.second.tiers[0].min, 20);
  assert.equal(result.profiles.second.step, 2);
  assert.equal(JSON.stringify(input), before);
});

// What the projection applies in the unit the profile was written in (domain/classification/projection.js).
test("each variant carries the profile as written, under the key of the unit it was written in", () => {
  const result = config.normalizeCustomClassification(custom({ valid_range: { min: 0, max: 15 } }), collaborators);
  const { authored } = result.profiles.second;
  assert.equal(authored.unitProfileKey, "times_2");
  assert.equal(authored.profile.tiers[0].min, 10);
  assert.deepEqual(authored.profile.comfort, { min: 0, max: 10 });
  assert.equal(authored.profile.step, 1);
  assert.equal(authored.profile.unit, "shared");
  assert.equal("authored" in authored.profile, false);
  // The validity window decides in the written unit; the canonical variant's in its own.
  assert.deepEqual([authored.profile.invalidWhen(15), authored.profile.invalidWhen(16)], [false, true]);
  assert.deepEqual([result.profiles.second.invalidWhen(30), result.profiles.second.invalidWhen(31)], [false, true]);
  assert.equal(result.profiles.first.authored.unitProfileKey, "times_1");
});

test("a refused value is named as written, a numeric string included", () => {
  const written = `1${"0".repeat(308)}`;
  const result = config.normalizeCustomClassification(custom({ scale: { min: 0, max: written, step: 1 } }), collaborators);
  assert.equal(result.profiles.first.scale.max, 1e308);
  assert.deepEqual(result.faults.second, { path: "classification.scale.max", value: written });
});

test("a failing variant does not reject a representable variant of the same unit", () => {
  const result = config.normalizeCustomClassification(custom({ scale: { min: 0, max: 1e308, step: 1 } }), collaborators);
  assert.equal(result.profiles.first.scale.max, 1e308);
  assert.equal(result.profiles.second, undefined);
  assert.deepEqual(result.faults.second, { path: "classification.scale.max", value: 1e308 });
});

test("canonical underflow cannot turn a positive step into zero", () => {
  const tiny = { ...collaborators, unitProfileForUnit: () => profile(1e-300) };
  const diagnostics = [];
  const result = config.normalizeClassificationConfig(custom({ scale: { min: 0, max: 20, step: 1e-100 } }), tiny, diagnostics);
  assert.equal(result.source, "auto");
  assert.equal(diagnostics[0].path, "classification.scale.step");
});

test("canonicalization rejects collapsed geometry at the original written path and value", () => {
  const tiny = { ...collaborators, unitProfileForUnit: () => profile(1e-300) };
  const cases = [
    [{ bands: { comfort: { min: 0, max: 1e-100 }, optimal: { min: 0, max: 1e-101 } } }, "classification.bands.comfort.max", 1e-100],
    [{ bands: { comfort: { min: 0, max: 10 }, optimal: { min: 0, max: 1e-100 } } }, "classification.bands.optimal.max", 1e-100],
    [{ scale: { min: 0, max: 1e-100, step: 1 } }, "classification.scale.max", 1e-100],
    [{ valid_range: { min: 0, max: 1e-100 } }, "classification.valid_range.max", 1e-100],
    [{ tiers: [{ min: 2e-100, score: 2, level: "A", zone: "outside" }, { min: 1e-100, score: 1, level: "B", zone: "comfort" }, { default: true, score: 0, level: "C", zone: "optimal" }] }, "classification.tiers[1].min", 1e-100],
    [{ icons: [{ min: 2e-100, icon: "mdi:a" }, { min: 1e-100, icon: "mdi:b" }, { default: true, icon: "mdi:c" }] }, "classification.icons[1].min", 1e-100],
  ];
  for (const [overrides, path, value] of cases) {
    const diagnostics = [];
    const result = config.normalizeClassificationConfig(custom(overrides), tiny, diagnostics);
    assert.equal(result.source, "auto", path);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].path, path);
    assert.equal(diagnostics[0].value, value);
  }
});

// The order the YAML is validated in: the same profile is refused at the same value in every unit.
test("with several collapsed values, the first in YAML order is refused", () => {
  const tiny = { ...collaborators, unitProfileForUnit: () => profile(1e-300) };
  const faults = [
    ["classification.bands.comfort.max", { bands: { comfort: { min: 0, max: 1e-100 }, optimal: { min: 0, max: 1e-101 } } }],
    ["classification.bands.optimal.max", { bands: { comfort: { min: 0, max: 10 }, optimal: { min: 0, max: 1e-100 } } }],
    ["classification.scale.max", { scale: { min: 0, max: 1e-100, step: 1 } }],
    ["classification.tiers[1].min", { tiers: [{ min: 2e-100, score: 2, level: "A", zone: "outside" }, { min: 1e-100, score: 1, level: "B", zone: "comfort" }, { default: true, score: 0, level: "C", zone: "optimal" }] }],
    ["classification.valid_range.max", { valid_range: { min: 0, max: 1e-100 } }],
    ["classification.icons[1].min", { icons: [{ min: 2e-100, icon: "mdi:a" }, { min: 1e-100, icon: "mdi:b" }, { default: true, icon: "mdi:c" }] }],
  ];
  for (let first = 0; first < faults.length; first++) {
    // Earlier entries win where two write the same key.
    const overrides = Object.assign({}, ...faults.slice(first).map(([, written]) => written).reverse());
    const diagnostics = [];
    config.normalizeClassificationConfig(custom(overrides), tiny, diagnostics);
    assert.equal(diagnostics[0].path, faults[first][0]);
  }
});

test("a fault named under a block that was never written is refused, not crashed on", () => {
  const blind = { ...collaborators, profileReexpression: { ...PROFILE_REEXPRESSION, findFault: () => ({ kind: "collapse", field: "classification.valid_range.max" }) } };
  const diagnostics = [];
  const result = config.normalizeClassificationConfig(custom(), blind, diagnostics);
  assert.equal(result.source, "auto");
  assert.equal(diagnostics[0].path, "classification.valid_range.max");
  assert.equal(diagnostics[0].value, undefined);
});

test("unexpected conversion errors propagate instead of becoming configuration warnings", () => {
  const broken = { ...collaborators, unitProfileForUnit: () => ({ toCanonical() { throw new Error("broken converter"); } }) };
  assert.throws(() => config.normalizeCustomClassification(custom(), broken), /broken converter/);
});

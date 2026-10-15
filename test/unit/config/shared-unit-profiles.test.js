"use strict";

// A custom unit may belong to several measurements with different canonical units.
// Structural validation runs once; each canonical variant succeeds or carries its fault.
// Runtime selection belongs to application/classification-policy.test.js.
// These injected profiles are synthetic and independent of the product registry.

const test = require("node:test");
const assert = require("node:assert/strict");
let config;
test.before(async () => { config = await import("../../../src/config/classification/normalize.js"); });

const profile = (factor) => ({ toCanonical: (v) => v * factor, deltaToCanonical: (v) => v * factor });
const collaborators = {
  metricKindsForUnit: (unit) => unit === "shared" ? ["first", "second"] : [],
  unitProfileForUnit: (kind) => profile(kind === "first" ? 1 : 2),
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

test("unexpected conversion errors propagate instead of becoming configuration warnings", () => {
  const broken = { ...collaborators, unitProfileForUnit: () => ({ toCanonical() { throw new Error("broken converter"); } }) };
  assert.throws(() => config.normalizeCustomClassification(custom(), broken), /broken converter/);
});

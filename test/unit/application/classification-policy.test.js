"use strict";

// Direct unit tests for application/model/classification-policy.js: which classification a
// render applies when the configured one cannot hold for the measurement the sensors report or
// for the unit the card displays. Boundary: resolving and projecting one profile are the domain
// tests'; that the card ends up the same whichever of setConfig() and hass comes first is
// component/lifecycle/config-order-invariance.test.js's. See internal dev doc §5
// "Klassifikations-Rückfall".

const test = require("node:test");
const assert = require("node:assert/strict");

let policies;
let core;
let definitions;
let registry;

test.before(async () => {
  policies = await import("../../../src/application/model/classification-policy.js");
  core = await import("../../../src/core/diagnostics.js");
  definitions = await import("../../../src/domain/metrics/definitions.js");
  registry = await import("../../../src/domain/classification/registry.js");
});

const AUTO = { source: "auto", profile: null, custom: null };
const unitOf = (kind, key) => definitions.METRIC_DEFINITIONS[kind].unitProfiles[key];

// A canonical custom temperature profile whose 22.0 and 22.3 °C thresholds both round to 72 °F.
function collapsingInFahrenheit() {
  return {
    id: "custom",
    metricKind: "temperature",
    unit: "°C",
    comparison: ">=",
    tiers: [
      { min: 24, score: 3, level: "A", color: "#cc4444", zone: "outside" },
      { min: 22.3, score: 2, level: "B", color: "#ccaa44", zone: "comfort" },
      { min: 22.0, score: 1, level: "C", color: "#44cc66", zone: "optimal" },
      { min: -Infinity, score: 0, level: "D", color: "#4488cc", zone: "outside" },
    ],
    comfort: { min: 19, max: 25 },
    optimal: { min: 21, max: 23 },
    scale: { min: 16, max: 28 },
    step: 2,
    validRange: null,
    invalidWhen: null,
    iconTiers: null,
  };
}

test("a policy that holds is returned as it is, without a word", () => {
  const policies_ = [AUTO, { source: "entity", profile: null, custom: null }, { source: "profile", profile: "fridge", custom: null }];
  for (const policy of policies_) {
    const result = policies.resolveEffectivePolicy({ policy, metricKind: "temperature", displayUnitProfile: unitOf("temperature", "fahrenheit") });
    assert.equal(result.policy, policy, JSON.stringify(policy));
    assert.deepEqual(result.diagnostics, []);
  }
});

test("a named profile the measurement does not have falls back to its default profile", () => {
  const result = policies.resolveEffectivePolicy({
    policy: { source: "auto", profile: "outdoor", custom: null },
    metricKind: "humidity",
    displayUnitProfile: unitOf("humidity", "percent"),
  });
  assert.deepEqual(result.policy, AUTO);
  assert.deepEqual(result.diagnostics, [
    core.createDiagnostic("classification.profile_unavailable", {
      path: "classification.profile",
      value: "outdoor",
      params: { measurement: "humidity", fallback: "indoor" },
    }),
  ]);
});

test("a custom profile written in another measurement's unit falls back to automatic", () => {
  const custom = { ...collapsingInFahrenheit(), metricKind: "humidity", unit: "%" };
  const result = policies.resolveEffectivePolicy({
    policy: { source: "custom", profile: null, custom },
    metricKind: "temperature",
    displayUnitProfile: unitOf("temperature", "celsius"),
  });
  assert.deepEqual(result.policy, AUTO);
  assert.deepEqual(result.diagnostics, [
    core.createDiagnostic("classification.unit_mismatch", {
      path: "classification.unit",
      value: "%",
      params: { measurement: "temperature", fallback: "indoor" },
    }),
  ]);
});

test("a custom profile the display unit cannot represent falls back to automatic, and holds where it can", () => {
  const policy = { source: "custom", profile: null, custom: collapsingInFahrenheit() };
  const inFahrenheit = policies.resolveEffectivePolicy({ policy, metricKind: "temperature", displayUnitProfile: unitOf("temperature", "fahrenheit") });
  assert.deepEqual(inFahrenheit.policy, AUTO);
  assert.deepEqual(inFahrenheit.diagnostics, [
    core.createDiagnostic("classification.not_representable", { params: { unit: "°F", fallback: "indoor" } }),
  ]);

  const inCelsius = policies.resolveEffectivePolicy({ policy, metricKind: "temperature", displayUnitProfile: unitOf("temperature", "celsius") });
  assert.equal(inCelsius.policy, policy);
  assert.deepEqual(inCelsius.diagnostics, []);
});

test("no built-in profile ever falls back, in any unit its measurement knows", () => {
  // Read from the registries, so a new profile or unit is covered without an edit here.
  for (const [kind, entry] of Object.entries(registry.CLASSIFICATION_PROFILE_REGISTRY)) {
    for (const id of Object.keys(entry.profiles)) {
      for (const unitProfile of Object.values(definitions.METRIC_DEFINITIONS[kind].unitProfiles)) {
        const result = policies.resolveEffectivePolicy({
          policy: { source: "profile", profile: id, custom: null },
          metricKind: kind,
          displayUnitProfile: unitProfile,
        });
        assert.deepEqual(result.diagnostics, [], `${kind}/${id} in ${unitProfile.key}`);
      }
    }
  }
});

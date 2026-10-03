"use strict";

// What a metric kind has to bring for the card to show it, checked for every registered kind:
// a Home Assistant device class of its own whose units it displays, a canonical unit profile,
// a default classification profile, a trend deadband, presentation metadata and English
// wording, and a place in the card picker. A new kind that misses one fails here by name
// rather than somewhere downstream. Boundary: how the parts behave is the domain unit tests'
// to pin; this file checks only that they are there and agree. See internal dev doc §6
// "Neue Messart".

const test = require("node:test");
const assert = require("node:assert/strict");

let definitions;
let homeAssistant;
let resolution;
let classification;
let trend;
let metricMeta;
let suggestions;
let en;
let unitToken;

test.before(async () => {
  definitions = await import("../../src/domain/metrics/definitions.js");
  homeAssistant = await import("../../src/domain/metrics/home-assistant.js");
  resolution = await import("../../src/domain/metrics/resolution.js");
  classification = await import("../../src/domain/classification/registry.js");
  trend = await import("../../src/domain/trend.js");
  metricMeta = await import("../../src/presentation/view-model/metric-meta.js");
  suggestions = await import("../../src/application/model/card-suggestions.js");
  ({ en } = await import("../../src/i18n/languages/en.js"));
  unitToken = await import("../../src/domain/units/unit-token.js");
});

const kinds = () => Object.entries(definitions.METRIC_DEFINITIONS);

test("each kind declares a Home Assistant device class of its own", () => {
  const seen = new Set();
  for (const [kind, { deviceClass }] of kinds()) {
    assert.ok(homeAssistant.HA_SENSOR_DEVICE_CLASSES.includes(deviceClass), `${kind}: "${deviceClass}" is a Home Assistant class`);
    assert.ok(Object.hasOwn(homeAssistant.HA_DEVICE_CLASS_UNITS, deviceClass), `${kind}: the units of "${deviceClass}" are known`);
    assert.ok(!seen.has(deviceClass), `${kind}: "${deviceClass}" belongs to one kind`);
    seen.add(deviceClass);
    assert.deepEqual(resolution.identifyMeasurement(deviceClass, null), { metricKind: kind, basis: "device_class", unknownDeviceClass: false }, kind);
  }
});

test("each kind displays only units Home Assistant allows for its device class", () => {
  for (const [kind, definition] of kinds()) {
    const allowed = homeAssistant.HA_DEVICE_CLASS_UNITS[definition.deviceClass].map(unitToken.normalizeUnitToken);
    for (const profile of Object.values(definition.unitProfiles)) {
      assert.ok(allowed.includes(unitToken.normalizeUnitToken(profile.displayUnit)), `${kind}/${profile.key}: ${profile.displayUnit}`);
      assert.equal(resolution.resolveUnitProfileKey(kind, profile.displayUnit), profile.key, `${kind}/${profile.key}: its own unit finds it`);
    }
  }
});

test("each kind has a canonical unit profile and a default classification profile", () => {
  for (const [kind, definition] of kinds()) {
    assert.equal(definition.unitProfiles[definition.canonicalProfileKey]?.displayUnit, definition.canonicalUnit, kind);
    const registry = classification.CLASSIFICATION_PROFILE_REGISTRY[kind];
    assert.ok(registry?.profiles?.[registry.defaultProfile], `${kind}: default profile "${registry?.defaultProfile}"`);
  }
});

test("each kind states a trend deadband the trend classifier reads", () => {
  for (const [kind, definition] of kinds()) {
    const { fallingBelow, risingAbove } = definition.trend;
    assert.ok(Number.isFinite(fallingBelow) && Number.isFinite(risingAbove), kind);
    assert.ok(fallingBelow < risingAbove, `${kind}: fallingBelow < risingAbove`);
    assert.deepEqual({ ...trend.TREND_POLICY_REGISTRY[kind] }, { fallingBelow, risingAbove }, kind);
  }
});

test("each kind has presentation metadata and its English wording", () => {
  for (const [kind] of kinds()) {
    const meta = metricMeta.METRIC_META[kind];
    assert.ok(meta, `${kind}: METRIC_META entry`);
    for (const field of ["titleKey", "lowRoomKey", "highRoomKey", "aboveAdjectiveKey", "belowAdjectiveKey"]) {
      assert.ok(Object.hasOwn(en, meta[field]), `${kind}: ${field} "${meta[field]}" is worded in English`);
    }
  }
  assert.deepEqual(Object.keys(metricMeta.METRIC_META).sort(), Object.keys(definitions.METRIC_DEFINITIONS).sort(), "no metadata for a kind that does not exist");
});

test("the card picker tries every kind, in the order they are registered", () => {
  assert.deepEqual([...suggestions.BROWSE_KIND_PRIORITY], [...definitions.METRIC_KIND_ORDER]);
});

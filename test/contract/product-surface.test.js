"use strict";

// THE ONE PLACE the hand-written product surface is compared with the code.
//
// Every other generic matrix in the suite imports test/manifests/product-surface.js and
// trusts it. That trust is only worth something because this file exists: it is the single
// seam where an independent statement of what the card supports meets what the card
// actually registers, and a mismatch here means one of the two is wrong.
//
// A failure is therefore never "update the expectation until it passes". It is a question:
// did the product gain something that was never written down, or lose something that still
// is? Both have happened.

const test = require("node:test");
const assert = require("node:assert/strict");

const surface = require("../manifests/product-surface.js");

let i18nRegistry;
let locales;
let metricDefinitions;
let viewState;
let paletteRegistry;
let zones;
let actions;

test.before(async () => {
  i18nRegistry = await import("../../src/i18n/registry.js");
  locales = await import("../../src/i18n/locales.js");
  metricDefinitions = await import("../../src/domain/metrics/definitions.js");
  viewState = await import("../../src/presentation/view-model/view-state.js");
  paletteRegistry = await import("../../src/domain/classification/palettes/registry.js");
  zones = await import("../../src/domain/classification/zones.js");
  actions = await import("../../src/config/actions.js");
});

// ------------------------------------------------------------------- languages --

test("the card ships exactly the languages the manifest claims", () => {
  assert.deepEqual(
    Object.keys(i18nRegistry.TRANSLATIONS).sort(),
    [...surface.LANGUAGES].sort(),
    "a language is registered that the manifest does not name, or the other way round"
  );
  assert.equal(locales.DEFAULT_LANGUAGE, surface.DEFAULT_LANGUAGE);
});

test("no language code is listed twice", () => {
  assert.equal(new Set(surface.LANGUAGES).size, surface.LANGUAGES.length);
});

// --------------------------------------------------------------------- metrics --

test("the card measures exactly the metrics the manifest claims", () => {
  assert.deepEqual(Object.keys(metricDefinitions.METRIC_DEFINITIONS).sort(), [...surface.METRIC_KINDS].sort());
});

test("each metric's canonical unit and unit profiles match the manifest", () => {
  for (const [kind, expected] of Object.entries(surface.METRICS)) {
    const definition = metricDefinitions.METRIC_DEFINITIONS[kind];
    assert.equal(definition.canonicalUnit, expected.canonicalUnit, `${kind}: canonical unit`);
    assert.deepEqual(
      Object.keys(definition.unitProfiles).sort(),
      [...expected.unitProfiles].sort(),
      `${kind}: unit profiles`
    );
  }
});

test("each metric is reachable through the device class the manifest names", async () => {
  const resolution = await import("../../src/domain/metrics/resolution.js");
  for (const [kind, expected] of Object.entries(surface.METRICS)) {
    assert.equal(
      resolution.METRIC_TYPE_BY_DEVICE_CLASS[expected.deviceClass],
      kind,
      `device_class "${expected.deviceClass}" should identify ${kind}`
    );
  }
  // And nothing else does. A device class the manifest does not name would be a
  // measurement the card silently claims to understand.
  assert.deepEqual(
    Object.keys(resolution.METRIC_TYPE_BY_DEVICE_CLASS).sort(),
    Object.values(surface.METRICS)
      .map((m) => m.deviceClass)
      .sort()
  );
});

// ----------------------------------------------------------------------- views --

test("the views are exactly those the manifest claims, in that order", () => {
  // Order is part of the contract, not incidental: it decides on-screen order, auto-slide
  // direction and keyboard traversal. deepEqual, not a set comparison.
  assert.deepEqual(
    viewState.VIEW_DEFINITIONS.map((definition) => definition.key),
    surface.VIEWS
  );
});

test("every view has a renderer", async () => {
  const registry = await import("../../src/views/registry.js");
  assert.deepEqual(
    registry.VIEW_RENDERERS.map((renderer) => renderer.key),
    surface.VIEWS
  );
});

// -------------------------------------------------------------------- palettes --

test("every word that reaches a palette is in the manifest, and no other", () => {
  assert.deepEqual([...paletteRegistry.paletteKeys()].sort(), [...surface.PALETTE_KEYS].sort());
  assert.equal(paletteRegistry.DEFAULT_PALETTE_ID, surface.DEFAULT_PALETTE_ID);
});

test("the shipped palettes are exactly those the manifest names", () => {
  const shipped = new Set(surface.PALETTE_KEYS.map((key) => paletteRegistry.paletteForName(key).id));
  assert.deepEqual([...shipped].sort(), [...surface.SHIPPED_PALETTE_IDS].sort());
});

// ----------------------------------------------------------------------- zones --

test("the classification zones are exactly those the manifest claims", () => {
  assert.deepEqual([...zones.CLASSIFICATION_ZONES].sort(), [...surface.CLASSIFICATION_ZONES].sort());
});

test("the Home Assistant action allowlist matches the public surface", () => {
  assert.deepEqual(actions.allowedActionTypes().sort(), [...surface.ACTION_TYPES].sort());
});

test("every view's option keys match the public surface", () => {
  for (const definition of viewState.VIEW_DEFINITIONS) {
    assert.deepEqual(
      Object.keys(definition.optionsSchema).sort(),
      Object.keys(surface.VIEW_OPTIONS[definition.key]).sort(),
      definition.key
    );
  }
});

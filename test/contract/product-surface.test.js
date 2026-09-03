"use strict";

// The one place the hand-written product surface is compared with the code. Every other
// generic matrix imports test/manifests/product-surface.js and trusts it; that trust is
// only worth something because this file exists. A failure is a question, not "update the
// expectation": did the product gain something never written down, or lose something still
// claimed? Both have happened.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const surface = require("../manifests/product-surface.js");

let i18nRegistry;
let locales;
let metricDefinitions;
let viewState;
let paletteRegistry;
let zones;
let actions;
let show;
let topLevelKeys;

test.before(async () => {
  i18nRegistry = await import("../../src/i18n/registry.js");
  locales = await import("../../src/i18n/locales.js");
  metricDefinitions = await import("../../src/domain/metrics/definitions.js");
  viewState = await import("../../src/presentation/view-model/view-state.js");
  paletteRegistry = await import("../../src/domain/classification/palettes/registry.js");
  zones = await import("../../src/domain/classification/zones.js");
  actions = await import("../../src/config/actions.js");
  show = await import("../../src/config/show.js");
  topLevelKeys = await import("../../src/config/top-level-keys.js");
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

// -------------------------------------------------------- the top-level keys --

test("the top-level keys the manifest claims are the ones the normalizer reads", () => {
  // Asked of the source, not a normalized result: a key the normalizer never reads leaves
  // no trace, so it would be silently ignored while the manifest keeps promising it.
  // `userConfig.<key>` is the one way the normalizer reaches the raw config.
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "config", "normalize-config.js"), "utf8");
  const read = new Set([...source.matchAll(/\buserConfig\.([a-z_]+)/g)].map((match) => match[1]));
  assert.ok(read.size > 10, "the scan found almost nothing, so it is not scanning");

  const claimed = new Set(surface.TOP_LEVEL_CONFIG_KEYS);
  const unread = [...claimed].filter((key) => !read.has(key)).sort();
  const unclaimed = [...read].filter((key) => !claimed.has(key)).sort();
  assert.deepEqual(unread, [], `the manifest promises keys normalizeConfig() never reads: ${unread.join(", ")}`);
  assert.deepEqual(unclaimed, [], `normalizeConfig() reads keys the manifest does not promise: ${unclaimed.join(", ")}`);
});

test("the keys the card accepts are the ones the manifest claims", () => {
  // The other end: the scan above proves the normalizer reads what the manifest promises;
  // this proves it accepts exactly that — otherwise an option could be read and still warned about.
  assert.deepEqual([...topLevelKeys.TOP_LEVEL_KEYS].sort(), [...surface.TOP_LEVEL_CONFIG_KEYS].sort());
  // And the two lists stay apart: a key Home Assistant writes is not one the card owns.
  const owned = [...topLevelKeys.FRAMEWORK_KEYS].filter((key) => topLevelKeys.TOP_LEVEL_KEYS.has(key));
  assert.deepEqual(owned, [], `these are claimed both as the card's own and as the framework's: ${owned.join(", ")}`);
});

test("the parts of the show block are exactly those the manifest claims", () => {
  assert.deepEqual([...show.SHOW_KEYS].sort(), Object.keys(surface.SHOW_KEYS).sort());
  // And the one that is not a switch is the one the manifest says is not a switch.
  for (const [key, shape] of Object.entries(surface.SHOW_KEYS)) {
    const isSwitch = Object.prototype.hasOwnProperty.call(show.SHOW_SWITCHES, key);
    assert.equal(isSwitch, shape === "bool", `${key}: the manifest and the module disagree about its shape`);
  }
  assert.deepEqual(Object.keys(show.SHOW_ROOMS_STATES).sort(), ["auto", "false", "true"]);
});

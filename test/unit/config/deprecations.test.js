"use strict";

// The deprecation register (config/deprecations.js): which older spellings the card still
// recognizes, at which stage, and how it answers each occurrence. Three layers:
//   - the register itself: entry validation and stage behaviour, on synthetic registers;
//   - the shipped entries: each stage agrees with whether the card still reads the spelling;
//   - REMOVED means no effect: an older spelling changes nothing but the warnings.
// Boundary: top-level-keys.test.js owns the key contract for keys that are not deprecated,
// config-normalize-modules.test.js what a current key normalizes to. See internal dev doc §4
// "Deprecation-Register".

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let deprecations;
let topLevelKeys;
let viewState;
let normalizeConfigModule;
let core;
let collaborators;

const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };

test.before(async () => {
  deprecations = await import("../../../src/config/deprecations.js");
  topLevelKeys = await import("../../../src/config/top-level-keys.js");
  viewState = await import("../../../src/presentation/view-model/view-state.js");
  normalizeConfigModule = await import("../../../src/config/normalize-config.js");
  core = await import("../../../src/core/diagnostics.js");
  // The real view types and option schemas, so a shipped entry is judged against what the views
  // accept; the other registries are stubs, as everywhere in this layer.
  collaborators = {
    classificationZones: ["optimal", "comfort", "outside", "invalid"],
    paletteForName: () => TINY_PALETTE,
    paletteForColor: () => null,
    paletteForGradient: () => null,
    assertPalette: (palette) => palette,
    completePalette: (palette) => palette,
    isSupportedLanguage: (code) => code === "en",
    viewTypes: viewState.VIEW_DEFINITIONS.map((definition) => definition.key),
    optionSchemaForView: viewState.optionSchemaForView,
    metricKindForUnit: (unit) => (unit === "°C" ? "temperature" : undefined),
    unitProfileForUnit: () => ({ key: "celsius", toCanonical: (v) => v, deltaToCanonical: (v) => v }),
  };
});

const { PREFERRED, WARNED, REMOVED } = { PREFERRED: 1, WARNED: 2, REMOVED: 3 };

function normalize(config) {
  return normalizeConfigModule.normalizeConfig(config, collaborators);
}

function withoutDiagnostics(normalized) {
  const { _configDiagnostics, ...rest } = normalized;
  return rest;
}

const codesOf = (normalized) => normalized._configDiagnostics.map((diagnostic) => diagnostic.code);

// ------------------------------------------------------------------ the register --

test("the stages are the three a spelling passes through before its entry is deleted", () => {
  assert.deepEqual({ ...deprecations.DEPRECATION_STAGE }, { PREFERRED, WARNED, REMOVED });
  assert.ok(Object.isFrozen(deprecations.DEPRECATION_STAGE));
});

test("an entry that names no place, two places, an unknown stage or no replacement is refused at load", () => {
  const { createDeprecationRegister } = deprecations;
  const valid = { key: "old_key", replacement: "new_key", stage: REMOVED };
  assert.doesNotThrow(() => createDeprecationRegister([valid]));
  for (const [entry, reason] of [
    [{ replacement: "new_key", stage: REMOVED }, "no place"],
    [{ key: "old_key", view: "scale", option: "footer", replacement: "x", stage: REMOVED }, "two places"],
    [{ view: "scale", replacement: "x", stage: REMOVED }, "a view without its option"],
    [{ key: "old_key", replacement: "new_key", stage: 4 }, "stage 4 is the deleted entry"],
    [{ key: "old_key", replacement: "new_key", stage: "removed" }, "a stage is a number"],
    [{ key: "old_key", replacement: "", stage: REMOVED }, "an empty replacement"],
    [{ key: "old_key", replacement: "new_key", stage: REMOVED, matches: true }, "matches is a predicate"],
    [{ key: "old_key", replacement: "new_key", stage: REMOVED, equivalent: "x" }, "equivalent is a function"],
  ]) {
    assert.throws(() => createDeprecationRegister([entry]), /deprecations:/, reason);
  }
  assert.throws(() => createDeprecationRegister([valid, { ...valid }]), /deprecations:/, "one place, one entry");
  assert.throws(
    () => createDeprecationRegister([{ view: "v", option: "o", replacement: "x", stage: REMOVED }, { view: "v", option: "o", replacement: "y", stage: WARNED }]),
    /deprecations:/
  );
});

test("a register finds a spelling by its place, and a view option only for a value it matches", () => {
  const register = deprecations.createDeprecationRegister([
    { key: "old_key", replacement: "new_key", stage: REMOVED },
    { view: "v", option: "mode", matches: (value) => value === false, replacement: "show", stage: REMOVED },
    { view: "v", option: "legacy", replacement: "show", stage: WARNED },
  ]);
  assert.equal(register.topLevel("old_key").replacement, "new_key");
  assert.equal(register.topLevel("new_key"), null);
  assert.equal(register.topLevel("constructor"), null, "only own entries");
  assert.equal(register.viewOption("v", "mode", false).option, "mode");
  assert.equal(register.viewOption("v", "mode", "compact"), null, "a value the entry does not match is a current one");
  assert.equal(register.viewOption("v", "legacy", 7).option, "legacy", "no predicate: every written value");
  assert.equal(register.viewOption("w", "mode", false), null, "the view is part of the place");
  assert.deepEqual(register.toleratedViewOptions("v"), ["mode"], "only a removed option is accepted beside the schema");
  assert.deepEqual(register.toleratedViewOptions("w"), []);
});

test("each stage answers an occurrence its own way", () => {
  const entry = (stage) => ({ key: "old_key", replacement: "new_key", stage, equivalent: (value) => (typeof value === "boolean" ? !value : undefined) });
  const answer = (stage, value = true) => deprecations.deprecationDiagnostic(entry(stage), "old_key", value);
  assert.equal(answer(PREFERRED), null, "preferred: silent");
  assert.deepEqual(answer(WARNED), core.createDiagnostic("config.deprecated", { path: "old_key", params: { written: "old_key: true", replacement: "new_key: false" } }));
  assert.deepEqual(answer(REMOVED), core.createDiagnostic("config.removed", { path: "old_key", params: { written: "old_key: true", replacement: "new_key: false" } }));
  assert.equal(deprecations.isIneffective(entry(PREFERRED)), false);
  assert.equal(deprecations.isIneffective(entry(WARNED)), false);
  assert.equal(deprecations.isIneffective(entry(REMOVED)), true);
});

test("a value with no equivalent is named by its path alone, never quoted back", () => {
  const entry = { key: "old_key", replacement: "new_key", stage: REMOVED, equivalent: (value) => (value === "on" ? true : undefined) };
  const params = (value) => deprecations.deprecationDiagnostic(entry, "old_key", value).params;
  assert.deepEqual({ ...params("on") }, { written: "old_key: on", replacement: "new_key: true" });
  assert.deepEqual({ ...params("a very long and arbitrary value someone pasted") }, { written: "old_key", replacement: "new_key" });
  assert.deepEqual({ ...params({ nested: true }) }, { written: "old_key", replacement: "new_key" });
  const plain = { key: "old_key", replacement: "new_key", stage: REMOVED };
  assert.deepEqual({ ...deprecations.deprecationDiagnostic(plain, "old_key", 3).params }, { written: "old_key", replacement: "new_key" }, "no equivalent at all");
  assert.deepEqual(
    { ...deprecations.deprecationDiagnostic(plain, "views[2].options.old", true, "views[2].options.new").params },
    { written: "views[2].options.old", replacement: "views[2].options.new" },
    "a view option names its replacement at the same entry"
  );
});

// ------------------------------------------------------------ the shipped entries --

test("the card ships exactly the four spellings replaced in 2.39.0, all removed", () => {
  const places = deprecations.DEPRECATIONS.map((entry) => (entry.key ? entry.key : `views[${entry.view}].options.${entry.option}`));
  assert.deepEqual(places, ["show_rooms", "unavailable_values", "hide_footer", "views[scale].options.footer", "views[range_scale].options.footer"]);
  for (const entry of deprecations.DEPRECATIONS) assert.equal(entry.stage, REMOVED, JSON.stringify(entry));
});

test("a spelling still read is still a key of the card; a removed one no longer is", () => {
  for (const entry of deprecations.DEPRECATIONS) {
    if (entry.key) {
      assert.equal(topLevelKeys.TOP_LEVEL_KEYS.has(entry.key), entry.stage < REMOVED, entry.key);
      continue;
    }
    assert.ok(VIEWS.includes(entry.view), `${entry.view} is a registered view`);
    const schema = viewState.optionSchemaForView(entry.view);
    if (entry.stage < REMOVED || entry.matches) {
      // Still read, or only some values retired: the option itself stays, and the retired value
      // is no longer one it accepts.
      assert.ok(Object.hasOwn(schema, entry.option), `${entry.view}.${entry.option} is still an option`);
      if (entry.stage >= REMOVED) {
        for (const value of [false, true, 0, "false"]) {
          if (!entry.matches(value)) continue;
          assert.equal(schema[entry.option].validate(value), false, `${entry.view}.${entry.option}: ${JSON.stringify(value)} is no longer valid`);
        }
      }
    } else {
      assert.equal(Object.hasOwn(schema, entry.option), false, `${entry.view}.${entry.option} is no longer an option`);
    }
  }
});

// ---------------------------------------------------------- REMOVED has no effect --

const BASE = {
  entity: "sensor.avg",
  rooms: [{ entity: "sensor.a" }, { entity: "sensor.b" }],
  range_entity: "sensor.range",
};

// Every value a removed spelling was ever written with, valid or not.
const REMOVED_OCCURRENCES = [
  ["show_rooms", [false, true, "auto", "TRUE", "alway", 1]],
  ["unavailable_values", ["hide", "show", "hidden"]],
  ["hide_footer", [true, false, "yes"]],
];
const VIEW_OCCURRENCES = [
  ["scale", [false, true, "compact"]],
  ["range_scale", [false]],
];

test("a removed top-level spelling changes nothing but the warnings, and is named once", () => {
  const reference = withoutDiagnostics(normalize(BASE));
  for (const [key, values] of REMOVED_OCCURRENCES) {
    for (const value of values) {
      const normalized = normalize({ ...BASE, [key]: value });
      assert.deepEqual(withoutDiagnostics(normalized), reference, `${key}: ${JSON.stringify(value)}`);
      assert.deepEqual(codesOf(normalized), ["config.removed"], `${key}: ${JSON.stringify(value)} — one warning, no second one about the value`);
      assert.equal(normalized._configDiagnostics[0].path, key);
    }
  }
});

test("a removed view option changes nothing but the warnings, and is named at its entry", () => {
  for (const [type, values] of VIEW_OCCURRENCES) {
    const views = (options) => ["range", { type, options }];
    const reference = withoutDiagnostics(normalize({ ...BASE, views: views({ show_comfort_band: true }) }));
    for (const value of values) {
      const normalized = normalize({ ...BASE, views: views({ show_comfort_band: true, footer: value }) });
      assert.deepEqual(withoutDiagnostics(normalized), reference, `${type}.footer: ${JSON.stringify(value)}`);
      assert.deepEqual(codesOf(normalized), ["config.removed"], `${type}.footer: ${JSON.stringify(value)}`);
      assert.equal(normalized._configDiagnostics[0].path, "views[1].options.footer");
      assert.equal(normalized._configDiagnostics[0].params.replacement.startsWith("views[1].options.show_footer"), true);
    }
  }
});

test("range_scale keeps footer as its form; only the retired false is answered as removed", () => {
  for (const form of ["compact", "detailed"]) {
    const normalized = normalize({ ...BASE, views: [{ type: "range_scale", options: { footer: form } }] });
    assert.deepEqual(normalized._configDiagnostics, [], form);
    assert.equal(normalized.views[0].options.footer, form);
  }
});

test("the replacement a removed spelling names is what the card shows with it", () => {
  const params = (config) => ({ ...normalize({ ...BASE, ...config })._configDiagnostics[0].params });
  assert.deepEqual(params({ show_rooms: false }), { written: "show_rooms: false", replacement: "show.rooms: false" });
  assert.deepEqual(params({ show_rooms: " TRUE " }), { written: "show_rooms: TRUE", replacement: "show.rooms: true" });
  assert.deepEqual(params({ show_rooms: "alway" }), { written: "show_rooms", replacement: "show.rooms" });
  assert.deepEqual(params({ unavailable_values: "hide" }), { written: "unavailable_values: hide", replacement: "show.unavailable_rooms: false" });
  assert.deepEqual(params({ unavailable_values: "show" }), { written: "unavailable_values: show", replacement: "show.unavailable_rooms: true" });
  assert.deepEqual(params({ hide_footer: true }), { written: "hide_footer: true", replacement: "views[].options.show_footer: false" });
  assert.deepEqual(params({ views: [{ type: "scale", options: { footer: false } }] }), {
    written: "views[0].options.footer: false",
    replacement: "views[0].options.show_footer: false",
  });
  // The replacement, written, takes effect.
  assert.equal(normalize({ ...BASE, show: { rooms: false } }).show.rooms, false);
  assert.equal(normalize({ ...BASE, show: { unavailable_rooms: false } }).show.unavailable_rooms, false);
});

test("a removed spelling with nothing after it is not written, and stays silent", () => {
  for (const key of ["show_rooms", "unavailable_values", "hide_footer"]) {
    assert.deepEqual(normalize({ ...BASE, [key]: null })._configDiagnostics, [], key);
  }
  assert.deepEqual(normalize({ ...BASE, views: [{ type: "scale", options: { footer: null } }] })._configDiagnostics, []);
});

test("a repeated or unknown view entry is dropped before its options are read, so its footer is not named", () => {
  const normalized = normalize({ ...BASE, views: ["scale", { type: "scale", options: { footer: false } }, { type: "nope", options: { footer: false } }] });
  assert.deepEqual(codesOf(normalized), ["value.invalid", "value.invalid"]);
});

test("a typo of a removed key is foreign, never answered with the removed key", () => {
  const normalized = normalize({ ...BASE, hide_foter: true, show_room: false });
  assert.deepEqual(codesOf(normalized), ["config.foreign_key", "config.foreign_key"]);
});

test("a typo of a removed view option is refused without suggesting it", () => {
  assert.throws(
    () => normalize({ ...BASE, views: [{ type: "scale", options: { foter: false } }] }),
    (error) => error.code === "config.unknown_key" && error.params.key === "views[0].options.foter" && error.params.suggestion === null
  );
});

test("removed spellings are named in the order the YAML writes them", () => {
  const normalized = normalize({ hide_footer: true, ...BASE, views: [{ type: "scale", options: { footer: false } }], show_rooms: false });
  assert.deepEqual(
    normalized._configDiagnostics.map((diagnostic) => diagnostic.path),
    ["hide_footer", "views[0].options.footer", "show_rooms"]
  );
});

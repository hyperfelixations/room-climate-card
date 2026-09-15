"use strict";

// Direct unit tests for the `show:` block and the two header lines — pure normalization, no
// rendering. Two rules run through every case: `show:` decides whether a part is drawn and the
// part's own key decides what it says (so `title: ""` and `show.title: false` both remove the
// line, neither replacing the other); and an invalid value falls back to the default it names,
// while a key the block does not have refuses the configuration.
// Boundary: config-normalize-modules.test.js owns whole-configuration assembly and its
// rejection messages; this file owns one block and two keys, including their precedence over
// the older spellings they replace.

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let showModule;
let normalizeConfigModule;
let core;

const SUPPORTED = new Set(["en", "de"]);
const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };

// Enough stub collaborators to let normalizeConfig() run, not the production registries.
const COLLABORATORS = {
  classificationZones: ["optimal", "comfort", "outside", "invalid"],
  paletteForName: () => TINY_PALETTE,
  paletteForColor: () => null,
  paletteForGradient: () => null,
  assertPalette: (palette) => palette,
  completePalette: (palette) => palette,
  isSupportedLanguage: (code) => SUPPORTED.has(code),
  viewTypes: VIEWS,
  optionSchemaForView: () => undefined,
  metricKindForUnit: (unit) => (unit === "°C" ? "temperature" : undefined),
  unitProfileForUnit: () => ({ key: "celsius", toCanonical: (v) => v, deltaToCanonical: (v) => v }),
};

const configure = (overrides) => normalizeConfigModule.normalizeConfig({ entity: "sensor.a", ...overrides }, COLLABORATORS);

// The block on its own, with the diagnostics it records.
function showOf(value) {
  const diagnostics = [];
  return { show: showModule.normalizeShowConfig(value, diagnostics), diagnostics };
}

const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });

test.before(async () => {
  showModule = await import("../../../src/config/show.js");
  normalizeConfigModule = await import("../../../src/config/normalize-config.js");
  core = await import("../../../src/core/diagnostics.js");
});

// ============================================ the block on its own ===============

test("an absent block asks for nothing, and every part is drawn", () => {
  for (const absent of [undefined, null]) {
    assert.deepEqual(showOf(absent), { show: {}, diagnostics: [] }, "an omitted block is the normal case and not a mistake");
  }
  assert.deepEqual(configure({}).show, {
    accent_line: true,
    icon: true,
    title: true,
    subtitle: true,
    entity_label: true,
    pill: true,
    warnings: true,
    panel: true,
    rooms: "auto",
    unavailable_rooms: true,
  });
});

test("show.warnings is a switch like every other part", () => {
  assert.deepEqual(showOf({ warnings: false }), { show: { warnings: false }, diagnostics: [] });
  assert.equal(configure({ show: { warnings: false } }).show.warnings, false);
  assert.deepEqual(showOf({ warnings: "no" }), {
    show: { warnings: true },
    diagnostics: [invalid("show.warnings", "no", core.fallbackValue(true))],
  });
});

test("a block that is not an object is diagnosed and changes nothing", () => {
  for (const wrong of ["yes", 42, true, []]) {
    assert.deepEqual(
      showOf(wrong),
      { show: {}, diagnostics: [invalid("show", wrong, core.FALLBACK.DEFAULTS)] },
      JSON.stringify(wrong)
    );
  }
});

test("one part named turns off exactly that part", () => {
  const config = configure({ show: { icon: false } });
  assert.equal(config.show.icon, false);
  for (const part of ["accent_line", "title", "subtitle", "entity_label", "pill", "panel"]) {
    assert.equal(config.show[part], true, `${part} was not mentioned and stays on`);
  }
  assert.equal(config.show.rooms, "auto");
  assert.equal(config.show.unavailable_rooms, true);
});

test("a key the block does not have refuses the configuration, naming the part meant", () => {
  assert.throws(() => showOf({ icon: false, ikon: false }), {
    name: "ConfigError",
    message: "Invalid configuration: show.ikon is not an option of this card. Did you mean show.icon?",
  });
  assert.throws(() => showOf({ footer: false }), {
    name: "ConfigError",
    message: "Invalid configuration: show.footer is not an option of this card.",
  });
  assert.throws(() => configure({ show: { pill: "no", ikon: false } }), { name: "ConfigError" }, "whatever else the block says");
});

test("a part that is not a boolean takes the default it names", () => {
  assert.deepEqual(showOf({ pill: "no", panel: 0 }), {
    show: { pill: true, panel: true },
    diagnostics: [invalid("show.pill", "no", core.fallbackValue(true)), invalid("show.panel", 0, core.fallbackValue(true))],
  });
});

test("rooms keeps its three states while every other part is a switch", () => {
  // `true | false | "auto"`, the same shape views[].enabled uses; both YAML spellings of a
  // boolean arrive here and both mean the boolean.
  for (const written of [true, "true"]) assert.equal(showOf({ rooms: written }).show.rooms, true);
  for (const written of [false, "false"]) assert.equal(showOf({ rooms: written }).show.rooms, false);
  assert.equal(showOf({ rooms: "auto" }).show.rooms, "auto");

  // A typo here is not silently defaulted: "auto" and "true" are different answers.
  assert.deepEqual(showOf({ rooms: "alway" }), {
    show: { rooms: "auto" },
    diagnostics: [invalid("show.rooms", "alway", core.fallbackValue("auto"))],
  });
});

// ============================================ precedence over the older spellings =

test("the block wins over the older spelling of the same decision", () => {
  const both = configure({
    show: { rooms: false, unavailable_rooms: false },
    show_rooms: true,
    unavailable_values: "show",
  });
  assert.equal(both.show.rooms, false);
  assert.equal(both.show.unavailable_rooms, false);
});

test("an invalid value in the block takes the default it names, whatever the older spelling says", () => {
  const config = configure({ show: { rooms: "alway" }, show_rooms: false });
  assert.equal(config.show.rooms, "auto", "the warning says auto, so the card shows auto");
});

test("the older spelling still decides on its own", () => {
  assert.equal(configure({ show_rooms: false }).show.rooms, false);
  assert.equal(configure({ show_rooms: true }).show.rooms, true);
  assert.equal(configure({ show_rooms: "false" }).show.rooms, false, "read the way show.rooms reads it");
  assert.equal(configure({ unavailable_values: "hide" }).show.unavailable_rooms, false);
});

test("accent_line selects the edge while show.accent_line independently selects visibility", () => {
  const bottom = configure({ accent_line: "bottom" });
  assert.equal(bottom.accent_line, "bottom");
  assert.equal(bottom.show.accent_line, true);

  const hiddenBottom = configure({ accent_line: "bottom", show: { accent_line: false } });
  assert.equal(hiddenBottom.accent_line, "bottom");
  assert.equal(hiddenBottom.show.accent_line, false);
});

test("a block that mentions other parts does not silence the older spelling", () => {
  // Precedence is per decision, not per block: writing `show:` must not reset keys it says
  // nothing about.
  const config = configure({ show: { icon: false }, show_rooms: false, unavailable_values: "hide" });
  assert.equal(config.show.icon, false);
  assert.equal(config.show.rooms, false, "show_rooms still decides, because the block did not");
  assert.equal(config.show.unavailable_rooms, false);
});

test("an older spelling with a value it never had falls back to its default, with a warning", () => {
  const { fallbackValue } = core;
  for (const nonsense of ["alway", "", 0, 1]) {
    const config = configure({ show_rooms: nonsense });
    assert.equal(config.show.rooms, "auto", JSON.stringify(nonsense));
    assert.deepEqual(config._configDiagnostics, [invalid("show_rooms", nonsense, fallbackValue("auto"))], JSON.stringify(nonsense));
  }
  for (const nonsense of ["HIDE", "hidden", "", false]) {
    const config = configure({ unavailable_values: nonsense });
    assert.equal(config.show.unavailable_rooms, true, JSON.stringify(nonsense));
    assert.deepEqual(config._configDiagnostics, [invalid("unavailable_values", nonsense, fallbackValue("show"))], JSON.stringify(nonsense));
  }
  assert.deepEqual(configure({ show_rooms: null, unavailable_values: null })._configDiagnostics, [], "not written");
});

test("legacyShowRequests() reports only what was actually asked for", () => {
  const requests = (userConfig) => normalizeConfigModule.legacyShowRequests(userConfig, []);
  assert.deepEqual(requests({}), {});
  assert.deepEqual(requests({ show_rooms: true }), { rooms: true });
  assert.deepEqual(requests({ show_rooms: false }), { rooms: false });
  assert.deepEqual(requests({ show_rooms: "auto" }), {}, "the default is not this key's to state");
  assert.deepEqual(requests({ unavailable_values: "hide" }), { unavailable_rooms: false });
  assert.deepEqual(requests({ unavailable_values: "show" }), {});
  assert.deepEqual(requests({ show_rooms: false, unavailable_values: "hide" }), { rooms: false, unavailable_rooms: false });
});

test("the diagnostics of the block travel on the same channel as the views diagnostics", () => {
  const config = configure({ show: { pill: "no" }, views: "not-an-array" });
  assert.deepEqual(config._configDiagnostics.map((entry) => entry.path), ["show.pill", "views"]);
});

// ============================================ the two header lines ===============

test("the title takes the same four forms as the subtitle", () => {
  assert.deepEqual(configure({ title: "Ground floor" }).title, { text: "Ground floor", overflow: "wrap" });
  assert.deepEqual(configure({ title: "clip" }).title, { text: null, overflow: "clip" });
  assert.deepEqual(configure({ title: "" }).title, { text: "", overflow: "wrap" });
  assert.deepEqual(configure({ title: { text: "Hall", overflow: "clip" } }).title, { text: "Hall", overflow: "clip" });
  // The escape hatch out of the one ambiguity, exactly as the subtitle has it.
  assert.deepEqual(configure({ title: { text: "wrap" } }).title, { text: "wrap", overflow: "wrap" });
});

test("each line keeps the overflow it has always had as its default", () => {
  // Matches the stylesheet: `.rtc-title` has no nowrap/ellipsis and wraps, `.rtc-subtitle`
  // has both and clips.
  assert.equal(configure({}).title.overflow, "wrap");
  assert.equal(configure({}).subtitle.overflow, "clip");
  assert.equal(configure({ title: "Hall" }).title.overflow, "wrap");
  assert.equal(configure({ subtitle: "Downstairs" }).subtitle.overflow, "clip");
});

test("a malformed line falls back and says which part of it", () => {
  const { FALLBACK, fallbackValue } = core;
  for (const wrong of [42, [], true]) {
    const config = configure({ title: wrong, subtitle: wrong });
    assert.deepEqual(config.title, { text: null, overflow: "wrap" }, JSON.stringify(wrong));
    assert.deepEqual(config.subtitle, { text: null, overflow: "clip" }, JSON.stringify(wrong));
    assert.deepEqual(config._configDiagnostics, [invalid("title", wrong, FALLBACK.AUTOMATIC), invalid("subtitle", wrong, FALLBACK.AUTOMATIC)]);
  }
  const sideways = configure({ title: { overflow: "sideways" }, subtitle: { text: 1, overflow: "WRAP" } });
  assert.deepEqual(sideways.title, { text: null, overflow: "wrap" });
  assert.deepEqual(sideways.subtitle, { text: null, overflow: "wrap" });
  assert.deepEqual(sideways._configDiagnostics, [
    invalid("title.overflow", "sideways", fallbackValue("wrap")),
    invalid("subtitle.text", 1, FALLBACK.AUTOMATIC),
  ]);
});

test("a key a line does not have refuses the configuration", () => {
  assert.throws(() => configure({ subtitle: { text: "x", overflw: "wrap" } }), {
    name: "ConfigError",
    message: "Invalid configuration: subtitle.overflw is not an option of this card. Did you mean subtitle.overflow?",
  });
  assert.throws(() => configure({ title: { text: "x", nope: 1 } }), {
    name: "ConfigError",
    message: "Invalid configuration: title.nope is not an option of this card.",
  });
});

test("emptying a line and hiding it are two roads to the same node, and both stay open", () => {
  const emptied = configure({ title: "", subtitle: "", entity_label: "" });
  assert.equal(emptied.title.text, "");
  assert.equal(emptied.subtitle.text, "");
  assert.equal(emptied.entity_label, "");
  assert.equal(emptied.show.title, true, "the block says nothing here, and must not be inferred from the text");

  const hidden = configure({ show: { title: false, subtitle: false, entity_label: false } });
  assert.equal(hidden.title.text, null, "hiding a line does not invent a text for it");
  assert.equal(hidden.show.title, false);
  assert.equal(hidden.show.subtitle, false);
  assert.equal(hidden.show.entity_label, false);
});

// ============================================ what the block does not do ========

test("the block does not mutate the configuration it was handed", () => {
  const raw = { entity: "sensor.a", show: { icon: false }, show_rooms: true };
  const frozen = JSON.stringify(raw);
  normalizeConfigModule.normalizeConfig(raw, COLLABORATORS);
  assert.equal(JSON.stringify(raw), frozen);
});

test("every half-typed value a YAML editor produces comes back with an answer", () => {
  // Only a key the block does not have refuses; every value, finished or not, is answered.
  const shapes = [undefined, null, {}, { icon: undefined }, { icon: null }, { rooms: {} }, { rooms: "" }, "sh", 0, [1, 2]];
  for (const shape of shapes) {
    assert.doesNotThrow(() => showOf(shape), JSON.stringify(shape));
  }
});

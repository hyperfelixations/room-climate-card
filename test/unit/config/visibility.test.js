"use strict";

// Direct unit tests for the `show:` block and the two header lines.
//
// Where the card decides WHICH PARTS it draws, and — for the title and the subtitle —
// what each of them says and how it behaves when it does not fit. Both are pure
// normalization: a configuration goes in, one normalized shape comes out, and nothing
// here renders anything.
//
// Two rules run through every case below and are worth stating once. First, `show:`
// decides WHETHER a part is drawn and the part's own key decides WHAT it says, which is
// why `title: ""` and `show.title: false` both remove the line and neither replaces the
// other. Second, the block is cosmetic and therefore never throws: Home Assistant's YAML
// editor calls setConfig() on every keystroke, so a half-typed block has to degrade to
// the default with a diagnostic rather than paint the dashboard red on every other
// character.
//
// The boundary to config-normalize-modules.test.js next door: that file owns the
// assembly of a whole configuration and the messages a user sees when one is rejected.
// This file owns one block and two keys, including their precedence over the older
// spellings they replace.

const test = require("node:test");
const assert = require("node:assert/strict");

let showModule;
let normalizeConfigModule;

const SUPPORTED = new Set(["en", "de"]);
const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };

// The same shape of stand-in the neighbouring config tests use: enough collaborators to
// let normalizeConfig() run, and deliberately not the production registries.
const COLLABORATORS = {
  classificationZones: ["optimal", "comfort", "outside", "invalid"],
  paletteForName: () => TINY_PALETTE,
  paletteForColor: () => null,
  paletteForGradient: () => null,
  paletteGradientLimit: 3,
  paletteKeys: () => ["tiny"],
  assertPalette: (palette) => palette,
  completePalette: (palette) => palette,
  isSupportedLanguage: (code) => SUPPORTED.has(code),
  optionSchemaForView: () => undefined,
  metricKindForUnit: (unit) => (unit === "°C" ? "temperature" : undefined),
  unitProfileForUnit: () => ({ key: "celsius", toCanonical: (v) => v, deltaToCanonical: (v) => v }),
};

const configure = (overrides) => normalizeConfigModule.normalizeConfig({ entity: "sensor.a", ...overrides }, COLLABORATORS);

test.before(async () => {
  showModule = await import("../../../src/config/show.js");
  normalizeConfigModule = await import("../../../src/config/normalize-config.js");
});

// ============================================ the block on its own ===============

test("an absent block asks for nothing, and every part is drawn", () => {
  for (const absent of [undefined, null]) {
    const { show, diagnostics } = showModule.normalizeShowConfig(absent);
    assert.deepEqual(show, {}, "nothing was requested, so nothing is claimed");
    assert.deepEqual(diagnostics, [], "an omitted block is the normal case and not a mistake");
  }
  const config = configure({});
  assert.deepEqual(config.show, {
    accent_line: true,
    icon: true,
    title: true,
    subtitle: true,
    entity_label: true,
    pill: true,
    panel: true,
    rooms: "auto",
    unavailable_rooms: true,
  });
});

test("a block that is not an object is diagnosed and changes nothing", () => {
  for (const wrong of ["yes", 42, true, []]) {
    const { show, diagnostics } = showModule.normalizeShowConfig(wrong);
    assert.deepEqual(show, {}, JSON.stringify(wrong));
    assert.equal(diagnostics.length, 1, JSON.stringify(wrong));
    assert.match(diagnostics[0], /^show: expected an object/);
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

test("an unknown key inside the block is ignored and said out loud", () => {
  const { show, diagnostics } = showModule.normalizeShowConfig({ icon: false, ikon: false, footer: false });
  assert.deepEqual(show, { icon: false });
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /ignoring unknown "show" key\(s\) "ikon", "footer"/);
});

test("a part that is not a boolean falls back to its default and is said out loud", () => {
  const { show, diagnostics } = showModule.normalizeShowConfig({ pill: "no", panel: 0 });
  assert.deepEqual(show, {}, "neither survives, so both fall back to the default");
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0], /show\.pill: expected true or false, got "no"/);
  assert.match(diagnostics[1], /show\.panel: expected true or false, got 0/);
});

test("rooms keeps its three states while every other part is a switch", () => {
  assert.equal(showModule.normalizeShowConfig({ rooms: true }).show.rooms, "always");
  assert.equal(showModule.normalizeShowConfig({ rooms: false }).show.rooms, "never");
  assert.equal(showModule.normalizeShowConfig({ rooms: "auto" }).show.rooms, "auto");

  // A typo here is the one case where falling back silently would be wrong: "auto" and
  // "always" are different answers, and a user who wrote "alway" meant one of them.
  const { show, diagnostics } = showModule.normalizeShowConfig({ rooms: "alway" });
  assert.deepEqual(show, {});
  assert.match(diagnostics[0], /show\.rooms: expected auto, true or false, got "alway"/);
});

// ============================================ precedence over the older spellings =

test("the block wins over the older spelling of the same decision", () => {
  const both = configure({
    show: { rooms: false, unavailable_rooms: false },
    show_rooms: true,
    unavailable_values: "show",
  });
  assert.equal(both.show.rooms, "never");
  assert.equal(both.show.unavailable_rooms, false);
});

test("the older spelling still decides on its own", () => {
  assert.equal(configure({ show_rooms: false }).show.rooms, "never");
  assert.equal(configure({ show_rooms: true }).show.rooms, "always");
  assert.equal(configure({ unavailable_values: "hide" }).show.unavailable_rooms, false);
});

test("the top-level accent_line is gone, and only the block decides", () => {
  // Committed once, never released, so there is nobody to be compatible with. It is now an
  // unrecognized top-level key like any other, and the block is the one spelling.
  assert.equal(configure({ accent_line: false }).show.accent_line, true);
  assert.equal(configure({ show: { accent_line: false } }).show.accent_line, false);
});

test("a block that mentions other parts does not silence the older spelling", () => {
  // The precedence is per DECISION, not per block: writing `show:` at all must not
  // quietly reset the keys it says nothing about.
  const config = configure({ show: { icon: false }, show_rooms: false, unavailable_values: "hide" });
  assert.equal(config.show.icon, false);
  assert.equal(config.show.rooms, "never", "show_rooms still decides, because the block did not");
  assert.equal(config.show.unavailable_rooms, false);
});

test("the diagnostics of the block travel on the same channel as the views diagnostics", () => {
  const config = configure({ show: { nonsense: true }, views: "not-an-array" });
  assert.equal(config._configDiagnostics.length, 2);
  assert.ok(config._configDiagnostics.some((entry) => entry.startsWith("show:")), config._configDiagnostics.join(" | "));
  assert.ok(config._configDiagnostics.some((entry) => entry.startsWith("views:")), config._configDiagnostics.join(" | "));
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
  // Measured against the stylesheet rather than chosen: `.rtc-title` carries no nowrap and
  // no ellipsis and therefore wraps, `.rtc-subtitle` carries both and therefore clips.
  assert.equal(configure({}).title.overflow, "wrap");
  assert.equal(configure({}).subtitle.overflow, "clip");
  assert.equal(configure({ title: "Hall" }).title.overflow, "wrap");
  assert.equal(configure({ subtitle: "Downstairs" }).subtitle.overflow, "clip");
});

test("a malformed line falls back rather than throwing", () => {
  for (const wrong of [42, [], true]) {
    assert.deepEqual(configure({ title: wrong }).title, { text: null, overflow: "wrap" }, JSON.stringify(wrong));
    assert.deepEqual(configure({ subtitle: wrong }).subtitle, { text: null, overflow: "clip" }, JSON.stringify(wrong));
  }
  assert.deepEqual(configure({ title: { overflow: "sideways" } }).title, { text: null, overflow: "wrap" });
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

test("nothing in the block can throw", () => {
  // The keystroke case, stated as a test: every half-typed shape a YAML editor produces
  // on the way to a valid block has to come back with a value.
  const shapes = [undefined, null, {}, { icon: undefined }, { icon: null }, { rooms: {} }, { "": true }, "sh", 0, [1, 2]];
  for (const shape of shapes) {
    assert.doesNotThrow(() => showModule.normalizeShowConfig(shape), JSON.stringify(shape));
  }
});

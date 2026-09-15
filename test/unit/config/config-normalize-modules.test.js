"use strict";

// Direct unit tests for top-level config normalization, palette resolution, and the tier colour
// contract. What setConfig() refuses is a closed catalog whose messages Home Assistant shows, so
// they, and the order validation runs in, are asserted literally; every other invalid value falls
// back to the default it names in a warning. Collaborators are stubbed, which is the point of
// injecting them.
// Boundary: config-primitives.test.js owns the small readers, classification-normalize.test.js
// the classification sub-tree; this file owns the assembly. See internal dev doc §3
// "Konfigurationsvertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let classification;
let normalizeConfigModule;
let paletteModule;
let core;
let errors;

// Minimal stand-ins for the injected registries — not the real ones, so a test that needs
// the production registry proves the injection boundary is not doing its job.
const ZONES = ["optimal", "comfort", "outside", "invalid"];
const SUPPORTED = new Set(["en", "de", "fr"]);
const CELSIUS = {
  key: "celsius",
  toCanonical: (v) => v,
  deltaToCanonical: (v) => v,
};
const FAHRENHEIT = {
  key: "fahrenheit",
  toCanonical: (v) => ((v - 32) * 5) / 9,
  deltaToCanonical: (v) => (v * 5) / 9,
};

// Tiny palette collaborators: one colour per wing proves the layer never assumes the
// shipped palette's reach.
const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };
const PALETTES = { tiny: TINY_PALETTE, other: { id: "other", below: ["#abcdef"], optimal: "#fedcba", above: ["#123456"] } };

const COLLABORATORS = {
  classificationZones: ZONES,
  paletteForName: (name) => (name === null ? TINY_PALETTE : PALETTES[name] ?? null),
  // Colour lookup stand-in: one name resolves, exercising precedence without the 148-entry table.
  paletteForColor: (name) =>
    name === "teal" ? { id: "teal", below: ["#003333"], optimal: "#006666", above: ["#009999"] } : null,
  // Gradient lookup stand-in with the real contract: two or three recognised colours, null
  // otherwise.
  paletteForGradient: (value) => {
    const parts = String(value).trim().split("-").map((part) => part.trim().toLowerCase());
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((part) => part === "teal" || part === "black")) return null;
    return { id: parts.join("-"), below: ["#001111"], optimal: "#006666", above: ["#00BBBB"] };
  },
  assertPalette: (palette, path) => {
    if (typeof palette.optimal !== "string") throw new Error(`${path}.optimal must be a color.`);
    for (const wing of ["below", "above"]) {
      if (!Array.isArray(palette[wing])) throw new Error(`${path}.${wing} must be a list of colors.`);
    }
    return palette;
  },
  completePalette: (palette) => ({ ...palette, invalid: palette.invalid ?? "#7D7D7D" }),
  isSupportedLanguage: (code) => SUPPORTED.has(code),
  viewTypes: VIEWS,
  optionSchemaForView: (type) =>
    type === "scale"
      ? {
          show_comfort_band: { default: true, validate: (v) => typeof v === "boolean" },
          markers: { default: "extremes", validate: (v) => ["average", "extremes", "all"].includes(v) },
          legacy: { default: null },
        }
      : undefined,
  metricKindForUnit: (unit) => ({ "°C": "temperature", "°F": "temperature", "%": "humidity" })[unit],
  unitProfileForUnit: (kind, unit) => {
    if (kind !== "temperature") return unit === "%" ? CELSIUS : null;
    if (unit === "°C") return CELSIUS;
    if (unit === "°F") return FAHRENHEIT;
    return null;
  },
};

function validCustom(overrides = {}) {
  return {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 3, level: "Warm", color: "#cc4444", zone: "outside" },
      { min: 20, score: 2, level: "Ok", color: "#44cc66", zone: "optimal" },
      { default: true, score: 1, level: "Cold", color: "#4488cc", zone: "outside" },
    ],
    ...overrides,
  };
}

test.before(async () => {
  core = await import("../../../src/core/diagnostics.js");
  errors = await import("../../../src/config/errors.js");
  classification = await import("../../../src/config/classification/normalize.js");
  normalizeConfigModule = await import("../../../src/config/normalize-config.js");
  paletteModule = await import("../../../src/config/classification/palette.js");
});

const normalize = (config) => normalizeConfigModule.normalizeConfig(config, COLLABORATORS);
const configure = (overrides) => normalize({ entity: "sensor.avg", ...overrides });
const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });
const refusal = (message) => ({ name: "ConfigError", message });

// A palette read on its own, with the diagnostics it records.
function paletteOf(value) {
  const diagnostics = [];
  return { palette: paletteModule.normalizePalette(value, COLLABORATORS, diagnostics), diagnostics };
}

// -------------------------------------------------------- normalizeConfig --

test("normalizeConfig() refuses a non-object, then a configuration with no value source at all", () => {
  for (const value of ["x", [], 5, true]) {
    assert.throws(() => normalize(value), refusal("Invalid configuration: the card configuration must be a YAML object."), JSON.stringify(value));
  }
  const noSource = refusal("Invalid configuration: set entity, or add at least one entry under rooms.");
  assert.throws(() => normalize(null), noSource);
  assert.throws(() => normalize({}), noSource);
  assert.throws(() => normalize({ rooms: [] }), noSource, "an empty rooms list is not a source");
  assert.throws(() => normalize({ range_entity: "sensor.r" }), noSource, "an auxiliary entity cannot BE the value");
  assert.throws(() => normalize({ trend_entity: "sensor.t" }), noSource);
});

test("every refusal carries its code and parameters for the card to word", () => {
  const caught = (config) => {
    try {
      normalize(config);
    } catch (error) {
      return error;
    }
    return null;
  };
  const cases = [
    ["x", "config.not_object", {}],
    [{ pallete: "vivid", entity: "sensor.a" }, "config.unknown_key", { key: "pallete", suggestion: "palette" }],
    [{ entity: 5 }, "config.must_be_entity_id", { key: "entity" }],
    [{ rooms: "sensor.a" }, "config.must_be_list", { key: "rooms" }],
    [{ rooms: ["sensor.a"] }, "config.must_be_object", { key: "rooms[0]" }],
    [{ rooms: [{ entity: "sensor.a" }, { entity: "sensor.a" }] }, "config.duplicate_room", { entity: "sensor.a" }],
    [{}, "config.no_source", {}],
  ];
  for (const [config, code, params] of cases) {
    const error = caught(config);
    assert.ok(error instanceof errors.ConfigError, `${code}: a ConfigError`);
    assert.equal(error.code, code);
    assert.deepEqual(error.params, params, code);
  }
});

test("the refusals run in a fixed order: object, keys, entity, rooms, source, then the other objects", () => {
  assert.throws(() => normalize({ rooms: "not-a-list", pallete: "tiny" }), refusal("Invalid configuration: pallete is not an option of this card. Did you mean palette?"));
  assert.throws(() => normalize({ entity: 5, rooms: "x" }), refusal("Invalid configuration: entity must be an entity id."));
  assert.throws(() => normalize({ rooms: [{ entity: "sensor.a", nmae: "A" }, "x"] }), { name: "ConfigError", message: /rooms\[0\]\.nmae/ });
  assert.throws(() => normalize({ rooms: [], show: { ikon: false } }), refusal("Invalid configuration: set entity, or add at least one entry under rooms."));
  assert.throws(
    () => configure({ views: [{ type: "scale", enable: true }], show: { ikon: false } }),
    { name: "ConfigError", message: /views\[0\]\.enable/ },
    "views before show"
  );
});

test("normalizeConfig() fills in every default for a minimal config", () => {
  const result = configure({});
  assert.equal(result.entity, "sensor.avg");
  assert.deepEqual(result.rooms, []);
  assert.equal(result.range_entity, null);
  assert.equal(result.trend_entity, null);
  assert.equal(result.rotation_seconds, 14);
  assert.equal(result.slide_seconds, 1);
  assert.equal(result.hold_seconds, 0.5);
  assert.equal(result.auto_slide, true);
  assert.equal(result.swipe, true);
  assert.equal(result.accent_line, "top");
  assert.equal(result.hide_footer, false);
  assert.equal(result.show.rooms, "auto");
  assert.equal(result.show.unavailable_rooms, true);
  assert.equal(result.language, "auto");
  assert.equal(result.views, null);
  assert.equal(result.decimals, null);
  assert.equal(result.icon, null);
  assert.deepEqual(result._configDiagnostics, []);
  assert.deepEqual(result.classification, { source: "auto", profile: null, custom: null });
  assert.deepEqual(result.tap_action, { action: "more-info" });
  assert.deepEqual(result.hold_action, { action: "more-info" });
  assert.equal(result.room_sort, "value_asc");
  assert.equal(result.room_label, "auto");
});

test("the three top-level switches read a boolean the way the show: block does", () => {
  assert.equal(configure({ auto_slide: false }).auto_slide, false);
  assert.equal(configure({ swipe: false }).swipe, false);
  assert.equal(configure({ hide_footer: true }).hide_footer, true);

  // A value that is neither true nor false falls back to the default; the card names the key
  // in a diagnostic.
  const typo = configure({ auto_slide: "yes", swipe: 1, hide_footer: "true" });
  assert.equal(typo.auto_slide, true, "the default, exactly as before");
  assert.equal(typo.swipe, true);
  assert.equal(typo.hide_footer, false);
  const { fallbackValue } = core;
  assert.deepEqual(typo._configDiagnostics, [
    invalid("auto_slide", "yes", fallbackValue(true)),
    invalid("swipe", 1, fallbackValue(true)),
    invalid("hide_footer", "true", fallbackValue(false)),
  ]);
});

test("accent_line selects one edge and diagnoses every value outside its enum", () => {
  assert.equal(configure({ accent_line: "top" }).accent_line, "top");
  assert.equal(configure({ accent_line: "bottom" }).accent_line, "bottom");
  assert.deepEqual(configure({ accent_line: null })._configDiagnostics, [], "an unfinished YAML value is silent");

  for (const value of ["under", false, true, 0, {}, []]) {
    const config = configure({ accent_line: value });
    assert.equal(config.accent_line, "top", JSON.stringify(value));
    assert.deepEqual(
      config._configDiagnostics,
      [invalid("accent_line", value, core.fallbackValue("top"))],
      JSON.stringify(value)
    );
  }
});

test("every option that used to fall back in silence now names its default", () => {
  const { FALLBACK, fallbackValue } = core;
  const cases = [
    [{ decimals: 3 }, invalid("decimals", 3, FALLBACK.METRIC_DECIMALS), { decimals: null }],
    [{ decimals: "" }, invalid("decimals", "", FALLBACK.METRIC_DECIMALS), { decimals: null }],
    [{ room_columns: 0 }, invalid("room_columns", 0, FALLBACK.AUTOMATIC), { room_columns: null }],
    [{ room_rows: "x" }, invalid("room_rows", "x", FALLBACK.AUTOMATIC), { room_rows: null }],
    [{ rotation_seconds: 0 }, invalid("rotation_seconds", 0, fallbackValue(14)), { rotation_seconds: 14 }],
    [{ slide_seconds: 50 }, invalid("slide_seconds", 50, fallbackValue(1)), { slide_seconds: 1 }],
    [{ room_sort: "names" }, invalid("room_sort", "names", fallbackValue("value_asc")), { room_sort: "value_asc" }],
    [{ room_label: "long" }, invalid("room_label", "long", fallbackValue("auto")), { room_label: "auto" }],
    [{ language: "xx" }, invalid("language", "xx", fallbackValue("auto")), { language: "auto" }],
    [{ icon: 42 }, invalid("icon", 42, FALLBACK.AUTOMATIC), { icon: null }],
    [{ icon: "" }, invalid("icon", "", FALLBACK.AUTOMATIC), { icon: null }],
    [{ entity_label: 5 }, invalid("entity_label", 5, FALLBACK.AUTOMATIC), { entity_label: null }],
    [{ tap_action: "toggle" }, invalid("tap_action", "toggle", fallbackValue("more-info")), { tap_action: { action: "more-info" } }],
    [{ hold_action: { action: "explode" } }, invalid("hold_action.action", "explode", fallbackValue("more-info")), { hold_action: { action: "more-info" } }],
    [{ range_entity: 7 }, invalid("range_entity", 7, FALLBACK.IGNORED), { range_entity: null }],
    [{ trend_entity: "  " }, invalid("trend_entity", "  ", FALLBACK.IGNORED), { trend_entity: null }],
    [{ start_view: "" }, invalid("start_view", "", FALLBACK.FIRST_VIEW), { start_view: null }],
    [{ start_view: 5 }, invalid("start_view", 5, FALLBACK.FIRST_VIEW), { start_view: null }],
  ];
  for (const [written, diagnostic, expected] of cases) {
    const result = configure(written);
    assert.deepEqual(result._configDiagnostics, [diagnostic], JSON.stringify(written));
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(result[key], value, `${JSON.stringify(written)}: ${key}`);
  }
});

test("a room's own action and label warn at their paths inside rooms", () => {
  const { FALLBACK } = core;
  const result = configure({ rooms: [{ entity: "sensor.r", name: true, tap_action: { action: "explode" } }] });
  assert.deepEqual(result._configDiagnostics, [
    invalid("rooms[0].name", true, FALLBACK.AUTOMATIC),
    invalid("rooms[0].tap_action.action", "explode", FALLBACK.CARD_ACTION),
  ]);
  assert.equal(result.rooms[0].tap_action, null, "the card's own action applies");
});

test("every diagnostic shares the one channel, in the order the YAML writes the keys", () => {
  const paths = (config) => configure(config)._configDiagnostics.map((diagnostic) => diagnostic.path);
  assert.deepEqual(
    paths({ auto_slide: "yes", wibble: 1, show: { pill: "no" }, views: "not-an-array", start_view: "sclae" }),
    ["auto_slide", "wibble", "show.pill", "views", "start_view"]
  );
  assert.deepEqual(
    paths({ start_view: "sclae", views: "not-an-array", show: { pill: "no" }, wibble: 1, auto_slide: "yes" }),
    ["start_view", "views", "show.pill", "wibble", "auto_slide"]
  );
  // Within one key, the order the block is read in.
  assert.deepEqual(paths({ show: { panel: 0, pill: "no" } }), ["show.panel", "show.pill"]);
});

test("normalizeConfig() accepts a room as the only current-value source", () => {
  const result = normalize({ entity: null, rooms: [{ entity: "sensor.kitchen", name: "Kitchen" }] });
  assert.equal(result.entity, null);
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].entity, "sensor.kitchen");
});

test("normalizeConfig() distinguishes an omitted primary from a malformed one", () => {
  assert.equal(normalize({ entity: "", rooms: [{ entity: "sensor.room" }] }).entity, null);
  for (const malformed of [[], "   "]) {
    assert.throws(
      () => normalize({ entity: malformed, rooms: [{ entity: "sensor.room" }] }),
      refusal("Invalid configuration: entity must be an entity id."),
      JSON.stringify(malformed)
    );
  }
});

test("entity_label preserves the explicit empty-string sentinel", () => {
  assert.equal(configure({ entity_label: undefined }).entity_label, null);
  assert.equal(configure({ entity_label: " Home " }).entity_label, "Home");
  assert.equal(configure({ entity_label: "" }).entity_label, "");
  assert.equal(configure({ entity_label: "   " }).entity_label, "");
});

test("show_rooms maps the three public states", () => {
  // The older spelling of show.rooms: same three-state vocabulary, and the block outranks it
  // where both are written. A value outside it is a warning (visibility.test.js).
  const rooms = (value) => configure({ show_rooms: value }).show.rooms;
  assert.equal(rooms("auto"), "auto");
  assert.equal(rooms(true), true);
  assert.equal(rooms(false), false);
  assert.equal(rooms("always"), "auto", "a word the card has never accepted is not one of the three");
});

test("unavailable_values accepts show or hide", () => {
  // The older spelling of show.unavailable_rooms, collapsed to one boolean here, so "hide" is the
  // only value that turns the placeholders off.
  const shown = (value) => configure({ unavailable_values: value }).show.unavailable_rooms;
  assert.equal(shown("show"), true);
  assert.equal(shown("hide"), false);
  assert.equal(shown("invalid"), true);
  assert.equal(shown(true), true);
});

test("normalizeConfig() carries view diagnostics on the returned config", () => {
  assert.deepEqual(configure({ views: [{ type: "scale", enabled: "yes" }] })._configDiagnostics, [
    invalid("views[0].enabled", "yes", core.fallbackValue("auto")),
  ]);
});

test("normalizeConfig() never writes to the console", () => {
  // Warning output belongs to the caller; a pure normalizer stays silent.
  const original = { warn: console.warn, error: console.error, log: console.log };
  const captured = [];
  console.warn = (...a) => captured.push(a);
  console.error = (...a) => captured.push(a);
  console.log = (...a) => captured.push(a);
  try {
    configure({ views: "nonsense", room_columns: true, decimals: 9, palette: "neon" });
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(captured, []);
});

test("normalizeLanguage() accepts only languages the predicate confirms", () => {
  const { normalizeLanguage } = normalizeConfigModule;
  const isSupported = (code) => SUPPORTED.has(code);
  const language = (value) => {
    const diagnostics = [];
    return { result: normalizeLanguage(value, isSupported, diagnostics), diagnostics };
  };
  assert.deepEqual(language("de"), { result: "de", diagnostics: [] });
  assert.deepEqual(language(" FR "), { result: "fr", diagnostics: [] }, "trimmed and lowercased");
  assert.deepEqual(language("auto"), { result: "auto", diagnostics: [] });
  assert.deepEqual(language(undefined), { result: "auto", diagnostics: [] });
  for (const value of ["xx", "", 5]) {
    assert.deepEqual(
      language(value),
      { result: "auto", diagnostics: [invalid("language", value, core.fallbackValue("auto"))] },
      `${JSON.stringify(value)}: falls back rather than throwing`
    );
  }
});

test("normalizeConfig() reaches the injected collaborators, not a real registry", () => {
  // "fr" is supported by the stub; a language it rejects falls back, proving the predicate
  // is consulted.
  assert.equal(configure({ language: "fr" }).language, "fr");
  assert.equal(configure({ language: "it" }).language, "auto");
});

// ------------------------------------------------- the older spellings due to go --

test("the older spellings stay silent while the deprecation switch is off", () => {
  assert.equal(normalizeConfigModule.DEPRECATION_LEVEL, null);
  const legacy = { show_rooms: false, unavailable_values: "hide", hide_footer: true, views: [{ type: "scale", options: { legacy: false } }] };
  assert.deepEqual(configure(legacy)._configDiagnostics, []);
});

test("switched on, each older spelling names what replaces it", () => {
  const { deprecationDiagnostics } = normalizeConfigModule;
  const deprecated = (path, written, replacement) => core.createDiagnostic("config.deprecated", { path, params: { written, replacement } });
  const userConfig = {
    entity: "sensor.a",
    hide_footer: true,
    show_rooms: false,
    unavailable_values: "hide",
    views: ["scale", { type: "range_scale", options: { footer: false } }, { type: "range_scale", options: { footer: "compact" } }],
  };
  assert.deepEqual(deprecationDiagnostics(userConfig, null), []);
  assert.deepEqual(deprecationDiagnostics(userConfig, "warning"), [
    deprecated("show_rooms", "show_rooms", "show.rooms"),
    deprecated("unavailable_values", "unavailable_values", "show.unavailable_rooms"),
    deprecated("hide_footer", "hide_footer", "views[].options.show_footer"),
    deprecated("views[1].options.footer", "views[1].options.footer: false", "views[1].options.show_footer: false"),
  ]);
});

// ------------------------------------------------------------- palette ----

test("the palette option resolves a name, a written-out palette, or the default", () => {
  assert.deepEqual(paletteOf(undefined), { palette: TINY_PALETTE, diagnostics: [] }, "omitted means the card's own ramp");
  assert.deepEqual(paletteOf(null), { palette: TINY_PALETTE, diagnostics: [] });
  assert.equal(paletteOf("other").palette.id, "other");
  assert.equal(paletteOf("  OTHER  ").palette.id, "other", "a name is matched case-insensitively");

  const written = paletteOf({ below: ["#111"], optimal: "#222", above: ["#333"] }).palette;
  assert.deepEqual(written.below, ["#111111"]);
  assert.equal(written.optimal, "#222222");
  // invalid is the one field a palette may leave out and still be complete.
  assert.equal(written.invalid, "#7D7D7D");
});

// `optimal: #1DB85D` is a YAML comment, so every row below is a form a person reaches for
// instead, and all normalize to the same hex.
test("a colour may be written the way a person writes it", () => {
  const optimalOf = (value) => paletteOf({ optimal: value }).palette.optimal;
  assert.equal(optimalOf("#1DB85D"), "#1DB85D", "quoted, with the hash");
  assert.equal(optimalOf("1DB85D"), "#1DB85D", "unquoted, without it");
  assert.equal(optimalOf("1db85d"), "#1DB85D", "lower case");
  assert.equal(optimalOf("  1DB85D  "), "#1DB85D", "surrounded by spaces");
  assert.equal(optimalOf("#0F8"), "#00FF88", "three digits, expanded the way CSS defines them");
  assert.equal(optimalOf("teal"), "#008080", "a CSS colour name");
  // YAML turns an all-digit hex into a number and drops leading zeros; the digits are
  // recovered from the decimal spelling and padded to six. See core-modules.test.js.
  assert.equal(optimalOf(123456), "#123456", "six digits");
  assert.equal(optimalOf(80808), "#080808", "what YAML delivers for 080808");
  assert.equal(optimalOf(8000), "#008000", "and for 008000");
  assert.equal(optimalOf(0), "#000000");
});

// A wing may be a list, one colour, or a comma-separated line.
test("a wing may be a list, a single colour, or a comma-separated line", () => {
  const expected = ["#FD9808", "#EE2046"];
  for (const written of [["FD9808", "EE2046"], "FD9808, EE2046", "FD9808 EE2046", "#FD9808,#EE2046", ["FD9808, EE2046"]]) {
    assert.deepEqual(paletteOf({ optimal: "1DB85D", above: written }).palette.above, expected, JSON.stringify(written));
  }
  assert.deepEqual(paletteOf({ optimal: "1DB85D", above: "FD9808" }).palette.above, ["#FD9808"]);
});

// One wing or none is legitimate: CO2 has no "too little" to colour, and a single colour is
// a valid way to say "this card is teal".
test("only optimal is required, and a wing left out is simply empty", () => {
  const single = paletteOf({ optimal: "1DB85D" }).palette;
  assert.equal(single.optimal, "#1DB85D");
  assert.deepEqual(single.above, []);
  assert.deepEqual(single.below, []);

  const oneSided = paletteOf({ optimal: "1DB85D", above: "FD9808, EE2046" }).palette;
  assert.deepEqual(oneSided.above, ["#FD9808", "#EE2046"]);
  assert.deepEqual(oneSided.below, []);
});

// A shipped palette wins over a colour of the same name.
test("a registered palette name beats a colour name", () => {
  assert.equal(paletteOf("teal").palette.id, "teal", "no palette is called teal here");
  const shadowed = { ...COLLABORATORS, paletteForName: (name) => (name === "teal" ? { id: "shipped" } : null) };
  assert.equal(paletteModule.normalizePalette("teal", shadowed, []).id, "shipped");
});

// The hyphen is reached only when the name and single-colour lookups fail; that order is
// the safeguard for five CSS colours written either way and two hyphenated shipped palettes.
test("a name and a single colour are both tried before the hyphen is", () => {
  const { normalizePalette } = paletteModule;
  const hyphenated = {
    ...COLLABORATORS,
    paletteForName: (name) => (name === "teal-black" ? { id: "shipped-palette" } : PALETTES[name] ?? null),
  };
  assert.equal(normalizePalette("teal-black", hyphenated, []).id, "shipped-palette", "a registered name wins");

  const oneColour = {
    ...COLLABORATORS,
    paletteForColor: (value) => (value === "teal-black" ? { id: "one-colour", optimal: "#008080" } : null),
  };
  assert.equal(normalizePalette("teal-black", oneColour, []).id, "one-colour", "and a single colour beats the split");

  // Only when neither answers does the split get its turn.
  assert.equal(paletteOf("teal-black").palette.id, "teal-black");
  assert.equal(paletteOf("teal-black-teal").palette.id, "teal-black-teal");
  assert.equal(paletteOf("  TEAL-BLACK  ").palette.id, "teal-black", "one palette, however it was spelled");
});

test("a palette value the card cannot read falls back to the default palette and says so", () => {
  const { fallbackValue } = core;
  for (const value of ["neon", "", "   ", "teal-black-teal-black", "teal-", "teal--black", "teal-nonsense", [], true, 80, 1234567, 1.5]) {
    assert.deepEqual(
      paletteOf(value),
      { palette: TINY_PALETTE, diagnostics: [invalid("palette", value, fallbackValue("tiny"))] },
      JSON.stringify(value)
    );
  }
});

test("a written-out palette with a value it cannot use names the value's path and falls back whole", () => {
  const { fallbackOption } = core;
  const instead = fallbackOption("palette", "tiny");
  const cases = [
    [{ above: "FD9808" }, "palette.optimal", undefined],
    // What `optimal: #1DB85D` actually reaches the card as: a YAML comment left it empty.
    [{ optimal: null }, "palette.optimal", null],
    [{ optimal: 80 }, "palette.optimal", 80],
    [{ optimal: "1DB85D", above: null }, "palette.above", null],
    [{ optimal: "1DB85D", above: [] }, "palette.above", []],
    // A wing is counted in steps from optimal, so its first colour is [1].
    [{ optimal: "1DB85D", above: "FD9808, nope" }, "palette.above[2]", "nope"],
    [{ optimal: "1DB85D", invalid: "grey-ish" }, "palette.invalid", "grey-ish"],
  ];
  for (const [value, path, written] of cases) {
    assert.deepEqual(paletteOf(value), { palette: TINY_PALETTE, diagnostics: [invalid(path, written, instead)] }, JSON.stringify(value));
  }
  // Leaving a wing out entirely means something different and is not a mistake.
  assert.deepEqual(paletteOf({ optimal: "1DB85D" }).diagnostics, []);
});

test("a key a written-out palette does not have refuses the configuration, whatever else is wrong", () => {
  assert.throws(() => paletteOf({ optimal: "#222", extra: 1 }), refusal("Invalid configuration: palette.extra is not an option of this card."));
  assert.throws(
    () => paletteOf({ optimal: "nope", abve: "#333" }),
    refusal("Invalid configuration: palette.abve is not an option of this card. Did you mean palette.above?")
  );
});

// -------------------------------------------------- tier colour contract ---

// The custom-profile rules answer with the path and the value they refuse; the classification
// object turns that into a warning (classification-normalize.test.js).
function refusedAt(profile, path, value) {
  assert.throws(
    () => classification.normalizeCustomClassification(profile, COLLABORATORS),
    (error) => error instanceof errors.ConfigValueError && error.path === path && Object.is(error.value, value),
    `${path} = ${JSON.stringify(value)}`
  );
}

// A tier that names a colour paints itself and is held to no position rules.
test("a tier with a colour may carry any finite score, as it always could", () => {
  for (const score of [2.5, 0, -3, 1e9]) {
    const result = classification.normalizeCustomClassification(
      validCustom({
        tiers: [
          { min: 24, score, level: "Warm", color: "#cc4444", zone: "outside" },
          { default: true, score, level: "Cold", color: "#4488cc", zone: "outside" },
        ],
      }),
      COLLABORATORS
    );
    assert.deepEqual(result.tiers.map((tier) => tier.score), [score, score], String(score));
  }
});

// Palette-driven scores must descend with the thresholds, or the optimal tier can take the
// palette's most extreme colour.
test("palette-driven scores must descend with the thresholds", () => {
  const ramp = (scores) =>
    validCustom({
      tiers: [
        { min: 24, score: scores[0], level: "Warm", zone: "outside" },
        { min: 20, score: scores[1], level: "Ok", zone: "optimal" },
        { default: true, score: scores[2], level: "Cold", zone: "outside" },
      ],
    });
  assert.doesNotThrow(() => classification.normalizeCustomClassification(ramp([1, 0, -1]), COLLABORATORS));
  refusedAt(ramp([1, 5, -1]), "classification.tiers[1].score", 5);
  // Equal is not descending either: two tiers cannot occupy one place on the ramp.
  refusedAt(ramp([1, 1, -1]), "classification.tiers[1].score", 1);
  refusedAt(ramp([1, 0, 2]), "classification.tiers[2].score", 2);
});

// The anchor, and only in the direction that can go wrong.
test("a tier that calls itself optimal must sit at the middle of the ramp", () => {
  const withOptimalScore = (score) =>
    validCustom({
      tiers: [
        { min: 24, score: 2, level: "Warm", zone: "outside" },
        { min: 20, score, level: "Ok", zone: "optimal" },
        { default: true, score: -2, level: "Cold", zone: "outside" },
      ],
    });
  assert.doesNotThrow(() => classification.normalizeCustomClassification(withOptimalScore(0), COLLABORATORS));
  refusedAt(withOptimalScore(1), "classification.tiers[1].score", 1);

  // The converse is not required: a profile that only tells comfortable from outside carries
  // 0 in the middle without claiming to be optimal.
  assert.doesNotThrow(() =>
    classification.normalizeCustomClassification(
      validCustom({
        tiers: [
          { min: 24, score: 1, level: "Warm", zone: "outside" },
          { default: true, score: 0, level: "Normal", zone: "comfort" },
        ],
      }),
      COLLABORATORS
    )
  );
});

// A painted tier answers to none of the ramp rules; a mixed profile is read as its
// colourless tiers alone.
test("tiers that name their own colour are stepped over by the ramp rules", () => {
  assert.doesNotThrow(() =>
    classification.normalizeCustomClassification(
      validCustom({
        tiers: [
          { min: 26, score: 99, level: "Painted high", color: "#cc4444", zone: "outside" },
          { min: 24, score: 1, level: "Warm", zone: "outside" },
          { min: 20, score: 0, level: "Ok", zone: "optimal" },
          { min: 18, score: -1, level: "Cool", zone: "outside" },
          { default: true, score: -99, level: "Painted low", color: "#4488cc", zone: "outside" },
        ],
      }),
      COLLABORATORS
    )
  );
});

// And the rule that makes a distance mean something for a tier that has no colour.
test("a tier without a colour needs a whole number of steps from optimal", () => {
  for (const score of [2.5, 0.5, -1.5]) {
    refusedAt(
      validCustom({
        tiers: [
          { min: 24, score: 9, level: "Warm", zone: "outside" },
          { default: true, score, level: "Cold", zone: "outside" },
        ],
      }),
      "classification.tiers[1].score",
      score
    );
  }
});

// A painted tier is not on the ramp, so its score need not be a whole-number distance.
test("a mixed profile applies the distance rule only to the tiers that take a palette colour", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({
      tiers: [
        { min: 26, score: 2, level: "Hot", zone: "outside" },
        { min: 24, score: 0.5, level: "Painted", color: "#cc4444", zone: "outside" },
        { default: true, score: -3, level: "Cold", zone: "outside" },
      ],
    }),
    COLLABORATORS
  );
  assert.deepEqual(result.tiers.map((tier) => tier.color), [null, "#cc4444", null]);
  assert.deepEqual(result.tiers.map((tier) => tier.score), [2, 0.5, -3]);
});

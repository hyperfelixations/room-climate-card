"use strict";

// Direct unit tests for top-level config normalization, palette resolution,
// and the tier colour contract.
//
// These messages are a user-facing contract: Home Assistant shows whatever
// setConfig() throws straight in the dashboard, and the troubleshooting section
// of the public README quotes them. They are therefore asserted literally, and
// so is the ORDER in which validation happens — a config with two problems must
// keep reporting the same one first, or a user fixing errors top-down gets a
// moving target.
//
// The collaborators the config layer is not allowed to import are stubbed here,
// which is exactly the point of injecting them: the whole layer is testable
// without the domain, the i18n registry or the view registry.
//
// This file owns the TOP LEVEL: normalizeConfig() itself — the keys a card takes, the
// defaults they fall back to, the order the checks run in — plus the palette resolution it
// delegates to and the tier colour contract that comes out of it.
//
// The boundary to its two neighbours: config-primitives.test.js owns the small readers this
// normalizer is built out of, and classification-normalize.test.js owns the classification
// sub-tree. What is left here is the assembly, and the messages a user actually sees.

const test = require("node:test");
const assert = require("node:assert/strict");

let classification;
let normalizeConfigModule;
let paletteModule;

// Minimal stand-ins for the injected registries. Deliberately not the real ones:
// if a test only passes with the production registry, the injection boundary is
// not doing its job.
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

// The palette collaborators, deliberately tiny: one colour per wing makes the anchoring
// visible in a way five would not, and proves the layer never assumes the shipped
// palette's reach.
const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };
const PALETTES = { tiny: TINY_PALETTE, other: { id: "other", below: ["#abcdef"], optimal: "#fedcba", above: ["#123456"] } };

const COLLABORATORS = {
  classificationZones: ZONES,
  paletteForName: (name) => (name === null ? TINY_PALETTE : PALETTES[name] ?? null),
  // A stand-in for the colour lookup: one name that resolves, so precedence and the
  // error message can both be exercised without the 148-entry table.
  paletteForColor: (name) =>
    name === "teal" ? { id: "teal", below: ["#003333"], optimal: "#006666", above: ["#009999"] } : null,
  // A stand-in for the gradient lookup with the same contract as the real one: two or three
  // colours it recognises, and null for everything else so the layer owns every message.
  paletteForGradient: (value) => {
    const parts = String(value).trim().split("-").map((part) => part.trim().toLowerCase());
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((part) => part === "teal" || part === "black")) return null;
    return { id: parts.join("-"), below: ["#001111"], optimal: "#006666", above: ["#00BBBB"] };
  },
  paletteGradientLimit: 3,
  paletteKeys: () => Object.keys(PALETTES),
  assertPalette: (palette, path) => {
    if (typeof palette.optimal !== "string") throw new Error(`Invalid configuration: ${path}.optimal must be a color.`);
    for (const wing of ["below", "above"]) {
      if (!Array.isArray(palette[wing])) throw new Error(`Invalid configuration: ${path}.${wing} must be a list of colors.`);
    }
    return palette;
  },
  completePalette: (palette) => ({ ...palette, invalid: palette.invalid ?? "#7D7D7D" }),
  isSupportedLanguage: (code) => SUPPORTED.has(code),
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
  classification = await import("../../../src/config/classification/normalize.js");
  normalizeConfigModule = await import("../../../src/config/normalize-config.js");
  paletteModule = await import("../../../src/config/classification/palette.js");
});

// -------------------------------------------------------- normalizeConfig --

test("normalizeConfig() rejects a non-object, then a configuration with no value source at all", () => {
  const n = (config) => normalizeConfigModule.normalizeConfig(config, COLLABORATORS);
  for (const invalid of ["x", [], 5, true]) {
    assert.throws(() => n(invalid), { message: "Invalid configuration: card configuration must be an object." });
  }
  const noSource = {
    message:
      "Invalid configuration: at least one current-value source is required — set entity, or add at least one entry to rooms.",
  };
  assert.throws(() => n(null), noSource);
  assert.throws(() => n({}), noSource);
  assert.throws(() => n({ rooms: [] }), noSource, "an empty rooms list is not a source");
  assert.throws(() => n({ range_entity: "sensor.r" }), noSource, "an auxiliary entity cannot BE the value");
  assert.throws(() => n({ trend_entity: "sensor.t" }), noSource);
});

test("normalizeConfig() fills in every default for a minimal config", () => {
  const result = normalizeConfigModule.normalizeConfig({ entity: "sensor.avg" }, COLLABORATORS);
  assert.equal(result.entity, "sensor.avg");
  assert.deepEqual(result.rooms, []);
  assert.equal(result.range_entity, null);
  assert.equal(result.trend_entity, null);
  assert.equal(result.rotation_seconds, 14);
  assert.equal(result.slide_seconds, 1);
  assert.equal(result.hold_seconds, 0.5);
  assert.equal(result.auto_slide, true);
  assert.equal(result.swipe, true);
  assert.equal(result.hide_footer, false);
  assert.equal(result.show_rooms, "auto");
  assert.equal(result.unavailable_values, "show");
  assert.equal(result.language, "auto");
  assert.equal(result.views, null);
  assert.deepEqual(result._viewsDiagnostics, []);
  assert.deepEqual(result.classification, { source: "auto", profile: null, custom: null });
  assert.deepEqual(result.tap_action, { action: "more-info" });
  assert.deepEqual(result.hold_action, { action: "more-info" });
  assert.equal(result.room_sort, "value_asc");
  assert.equal(result.room_label, "auto");
});

test("normalizeConfig() accepts a room as the only current-value source", () => {
  const result = normalizeConfigModule.normalizeConfig(
    { entity: null, rooms: [{ entity: "sensor.kitchen", name: "Kitchen" }] },
    COLLABORATORS
  );
  assert.equal(result.entity, null);
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].entity, "sensor.kitchen");
});

test("normalizeConfig() distinguishes an omitted primary from a malformed one", () => {
  const n = (config) => normalizeConfigModule.normalizeConfig(config, COLLABORATORS);
  assert.equal(n({ entity: "", rooms: [{ entity: "sensor.room" }] }).entity, null);
  assert.throws(
    () => n({ entity: [], rooms: [{ entity: "sensor.room" }] }),
    { message: "Invalid configuration: entity must be an entity id string." }
  );
  assert.throws(
    () => n({ entity: "   ", rooms: [{ entity: "sensor.room" }] }),
    { message: "Invalid configuration: entity must be an entity id string." }
  );
});

test("entity_label preserves the explicit empty-string sentinel", () => {
  const n = (value) => normalizeConfigModule.normalizeConfig({ entity: "sensor.avg", entity_label: value }, COLLABORATORS);
  assert.equal(n(undefined).entity_label, null);
  assert.equal(n(" Home ").entity_label, "Home");
  assert.equal(n("").entity_label, "");
  assert.equal(n("   ").entity_label, "");
  assert.equal(n(5).entity_label, null);
});

test("show_rooms maps the three public states and defaults everything else to auto", () => {
  const n = (value) => normalizeConfigModule.normalizeConfig({ entity: "sensor.avg", show_rooms: value }, COLLABORATORS).show_rooms;
  assert.equal(n("auto"), "auto");
  assert.equal(n(true), "always");
  assert.equal(n(false), "never");
  assert.equal(n("always"), "auto", "internal sentinels are not public YAML values");
  assert.equal(n("invalid"), "auto");
});

test("unavailable_values accepts show or hide and silently defaults invalid values", () => {
  const n = (value) => normalizeConfigModule.normalizeConfig({ entity: "sensor.avg", unavailable_values: value }, COLLABORATORS).unavailable_values;
  assert.equal(n("show"), "show");
  assert.equal(n("hide"), "hide");
  assert.equal(n("invalid"), "show");
  assert.equal(n(true), "show");
});

test("normalizeConfig() carries view diagnostics on the returned config", () => {
  const result = normalizeConfigModule.normalizeConfig(
    { entity: "sensor.avg", views: [{ type: "scale", enabled: "yes" }] },
    COLLABORATORS
  );
  assert.equal(result._viewsDiagnostics.length, 1);
  assert.match(result._viewsDiagnostics[0], /invalid "enabled" value/);
});

test("normalizeConfig() never writes to the console", () => {
  // Warning output and its deduplication belong to the caller; a pure normalizer
  // must stay silent even for a config full of diagnosable mistakes.
  const original = { warn: console.warn, error: console.error, log: console.log };
  const captured = [];
  console.warn = (...a) => captured.push(a);
  console.error = (...a) => captured.push(a);
  console.log = (...a) => captured.push(a);
  try {
    normalizeConfigModule.normalizeConfig(
      { entity: "sensor.avg", views: "nonsense", room_columns: true, decimals: 9 },
      COLLABORATORS
    );
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(captured, []);
});

test("normalizeLanguage() accepts only languages the predicate confirms", () => {
  const { normalizeLanguage } = normalizeConfigModule;
  const isSupported = (code) => SUPPORTED.has(code);
  assert.equal(normalizeLanguage("de", isSupported), "de");
  assert.equal(normalizeLanguage(" FR ", isSupported), "fr", "trimmed and lowercased");
  assert.equal(normalizeLanguage("auto", isSupported), "auto");
  assert.equal(normalizeLanguage("", isSupported), "auto");
  assert.equal(normalizeLanguage("xx", isSupported), "auto", "unsupported falls back rather than throwing");
  assert.equal(normalizeLanguage(5, isSupported), "auto");
  assert.equal(normalizeLanguage(undefined, isSupported), "auto");
});

test("normalizeConfig() reaches the injected collaborators, not a real registry", () => {
  // "fr" is supported by the stub; a language the stub rejects must fall back,
  // proving the predicate is actually consulted.
  assert.equal(normalizeConfigModule.normalizeConfig({ entity: "sensor.a", language: "fr" }, COLLABORATORS).language, "fr");
  assert.equal(normalizeConfigModule.normalizeConfig({ entity: "sensor.a", language: "it" }, COLLABORATORS).language, "auto");
});

// ------------------------------------------------------------- palette ----

test("the palette option resolves a name, a written-out palette, or the default", () => {
  const { normalizePalette } = paletteModule;
  assert.equal(normalizePalette(undefined, COLLABORATORS), TINY_PALETTE, "omitted means the card's own ramp");
  for (const absent of [null, "", "   "]) {
    assert.equal(normalizePalette(absent, COLLABORATORS), TINY_PALETTE, JSON.stringify(absent));
  }
  assert.equal(normalizePalette("other", COLLABORATORS).id, "other");
  assert.equal(normalizePalette("  OTHER  ", COLLABORATORS).id, "other", "a name is matched case-insensitively");

  const written = normalizePalette({ below: ["#111"], optimal: "#222", above: ["#333"] }, COLLABORATORS);
  assert.deepEqual(written.below, ["#111111"]);
  assert.equal(written.optimal, "#222222");
  // The one field a palette may leave out and still be complete: nobody has to invent a
  // colour for a state they never see.
  assert.equal(written.invalid, "#7D7D7D");
});

// WHAT A PERSON ACTUALLY TYPES. `optimal: #1DB85D` is a YAML comment, so the strict
// spelling is a trap rather than a safeguard here; every row below is a form somebody
// reaches for, and all of them have to arrive as the same normalized hex.
test("a colour may be written the way a person writes it", () => {
  const { normalizePalette } = paletteModule;
  const optimalOf = (value) => normalizePalette({ optimal: value }, COLLABORATORS).optimal;
  assert.equal(optimalOf("#1DB85D"), "#1DB85D", "quoted, with the hash");
  assert.equal(optimalOf("1DB85D"), "#1DB85D", "unquoted, without it");
  assert.equal(optimalOf("1db85d"), "#1DB85D", "lower case");
  assert.equal(optimalOf("  1DB85D  "), "#1DB85D", "surrounded by spaces");
  assert.equal(optimalOf("#0F8"), "#00FF88", "three digits, expanded the way CSS defines them");
  assert.equal(optimalOf("teal"), "#008080", "a CSS colour name");
  // YAML turns an all-digit hex into a NUMBER and drops any leading zero on the way. The
  // digits are recovered from the decimal spelling and padded back to six — which is what
  // makes `080808` work at all. See core-modules.test.js for the whole table.
  assert.equal(optimalOf(123456), "#123456", "six digits");
  assert.equal(optimalOf(80808), "#080808", "what YAML delivers for 080808");
  assert.equal(optimalOf(8000), "#008000", "and for 008000");
  assert.equal(optimalOf(0), "#000000");
  assert.throws(() => optimalOf(80), /palette\.optimal.*only in digits has to be six/s, "too short to tell from a shorthand");
  assert.throws(() => optimalOf(1234567), /palette\.optimal.*only in digits has to be six/s, "too long to be a colour");
  assert.throws(() => optimalOf(1.5), /palette\.optimal/, "and a fraction is not one either");
});

// The wings are the other half of the same idea: a list is fine, one colour is fine, and
// so is the comma-separated line people write without thinking about it.
test("a wing may be a list, a single colour, or a comma-separated line", () => {
  const { normalizePalette } = paletteModule;
  const expected = ["#FD9808", "#EE2046"];
  for (const written of [
    ["FD9808", "EE2046"],
    "FD9808, EE2046",
    "FD9808 EE2046",
    "#FD9808,#EE2046",
    ["FD9808, EE2046"],
  ]) {
    const palette = normalizePalette({ optimal: "1DB85D", above: written }, COLLABORATORS);
    assert.deepEqual(palette.above, expected, JSON.stringify(written));
  }
  assert.deepEqual(normalizePalette({ optimal: "1DB85D", above: "FD9808" }, COLLABORATORS).above, ["#FD9808"]);
});

// A palette with one wing, or none at all, is a legitimate thing to want: CO2 has no
// "too little" to colour, and a single colour is a perfectly good way to say "this card
// is teal". Requiring both wings made all of that an error for no gain.
test("only optimal is required, and a wing left out is simply empty", () => {
  const { normalizePalette } = paletteModule;
  const single = normalizePalette({ optimal: "1DB85D" }, COLLABORATORS);
  assert.equal(single.optimal, "#1DB85D");
  assert.deepEqual(single.above, []);
  assert.deepEqual(single.below, []);

  const oneSided = normalizePalette({ optimal: "1DB85D", above: "FD9808, EE2046" }, COLLABORATORS);
  assert.deepEqual(oneSided.above, ["#FD9808", "#EE2046"]);
  assert.deepEqual(oneSided.below, []);

  assert.throws(() => normalizePalette({ above: "FD9808" }, COLLABORATORS), /palette needs an optimal color/);
});

// The mistake this system makes most often produces an EMPTY value rather than a wrong
// one, so "must be a hex color" would be describing something the user cannot see. The
// message has to name the cause.
test("a value that a YAML comment swallowed is explained, not just rejected", () => {
  const { normalizePalette } = paletteModule;
  // What `optimal: #1DB85D` actually reaches the card as.
  assert.throws(() => normalizePalette({ optimal: null }, COLLABORATORS), /starts a comment in YAML/);
  assert.throws(() => normalizePalette({ optimal: "1DB85D", above: null }, COLLABORATORS), /palette\.above.*starts a comment in YAML/s);
  // Leaving the key out entirely means something different and is not an error.
  assert.deepEqual(normalizePalette({ optimal: "1DB85D" }, COLLABORATORS).above, []);
});

// A name the card does not know is a hard error, not a silent fallback: a user who
// typed it meant it, and a dashboard that quietly ignored them would look like a bug
// in the palette rather than a typo.
test("an unknown palette name is refused, and the message names all three roads in", () => {
  assert.throws(
    () => paletteModule.normalizePalette("neon", COLLABORATORS),
    /palette "neon" is neither a palette nor a color — the palettes are "tiny", "other", or name any CSS color/
  );
});

// A shipped palette wins over a colour of the same name, so adding a palette later can
// take a word back without changing anything else.
test("a registered palette name beats a colour name", () => {
  assert.equal(paletteModule.normalizePalette("teal", COLLABORATORS).id, "teal", "no palette is called teal here");
  const shadowed = { ...COLLABORATORS, paletteForName: (name) => (name === "teal" ? { id: "shipped" } : null) };
  assert.equal(paletteModule.normalizePalette("teal", shadowed).id, "shipped");
});

// -------------------------------------------------- a palette from two or three colours ----

// The hyphen is only ever reached by a spelling the two lookups above could not resolve,
// and that order is the whole safeguard: five CSS colours can be written either way
// (`orangered` / `orange-red`) and two shipped palettes contain a hyphen (`color-vision`).
// Every one of them keeps the meaning it already had, so no existing configuration changes.
test("a name and a single colour are both tried before the hyphen is", () => {
  const { normalizePalette } = paletteModule;
  const hyphenated = {
    ...COLLABORATORS,
    paletteForName: (name) => (name === "teal-black" ? { id: "shipped-palette" } : PALETTES[name] ?? null),
  };
  assert.equal(normalizePalette("teal-black", hyphenated).id, "shipped-palette", "a registered name wins");

  const oneColour = {
    ...COLLABORATORS,
    paletteForColor: (value) => (value === "teal-black" ? { id: "one-colour", optimal: "#008080" } : null),
  };
  assert.equal(normalizePalette("teal-black", oneColour).id, "one-colour", "and a single colour beats the split");

  // Only when neither answers does the split get its turn.
  assert.equal(normalizePalette("teal-black", COLLABORATORS).id, "teal-black");
  assert.equal(normalizePalette("teal-black-teal", COLLABORATORS).id, "teal-black-teal");
  assert.equal(normalizePalette("  TEAL-BLACK  ", COLLABORATORS).id, "teal-black", "one palette, however it was spelled");
});

// Each way of getting a hyphenated palette wrong gets its own sentence, naming the part at
// fault — a user who mistyped one of three colours should not have to work out which.
test("a hyphenated palette that does not resolve says which part was the problem", () => {
  const { normalizePalette } = paletteModule;
  assert.throws(
    () => normalizePalette("teal-black-teal-black", COLLABORATORS),
    /names 4 colors — a gradient palette takes two, for the two ends, or three, where the middle one is the optimal color/,
    "too many"
  );
  for (const empty of ["teal-", "-teal", "teal--black"]) {
    assert.throws(() => normalizePalette(empty, COLLABORATORS), /has an empty part where a color should be/, empty);
  }
  assert.throws(
    () => normalizePalette("teal-nonsense", COLLABORATORS),
    /"nonsense" in "teal-nonsense" is not a color/,
    "and the part that is not a colour is quoted back"
  );
  // A value with no hyphen in it never reaches any of that, and still gets the general list.
  assert.throws(() => normalizePalette("neon", COLLABORATORS), /is neither a palette nor a color/);
});

test("a written-out palette is refused for the same reasons a shipped one would be", () => {
  const ok = { below: ["#111"], optimal: "#222", above: ["#333"] };
  assert.throws(() => paletteModule.normalizePalette([], COLLABORATORS), /palette must be a palette name, a color, or an object/);
  assert.throws(() => paletteModule.normalizePalette(true, COLLABORATORS), /palette must be a palette name, a color, or an object/);
  assert.throws(() => paletteModule.normalizePalette({ ...ok, extra: 1 }, COLLABORATORS), /palette\.extra/);
  assert.throws(() => paletteModule.normalizePalette({ ...ok, above: "not-a-colour" }, COLLABORATORS), /palette\.above\[1\]/);
});

// -------------------------------------------------- tier colour contract ---

// The rule that keeps every profile released before palettes existed valid: a tier that
// names a colour paints itself and is held to no position rules at all.
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

// THE RULE THE DOCUMENTATION PROMISED AND NOTHING ENFORCED. `[1, 5, -1]` normalized
// without complaint, and the middle tier — the one marked `zone: optimal` — then took the
// palette's most extreme colour. Valid YAML, a card that says the opposite of what it
// means, and no way for the user to see why.
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
  // The reviewer's example, and the reason this test exists.
  assert.throws(
    () => classification.normalizeCustomClassification(ramp([1, 5, -1]), COLLABORATORS),
    /classification\.tiers\[1\]\.score is 5, which is not below the 1 of classification\.tiers\[0\]/
  );
  // Equal is not descending either: two tiers cannot occupy one place on the ramp.
  assert.throws(
    () => classification.normalizeCustomClassification(ramp([1, 1, -1]), COLLABORATORS),
    /classification\.tiers\[1\]\.score/
  );
  assert.throws(
    () => classification.normalizeCustomClassification(ramp([1, 0, 2]), COLLABORATORS),
    /classification\.tiers\[2\]\.score/
  );
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
  assert.throws(
    () => classification.normalizeCustomClassification(withOptimalScore(1), COLLABORATORS),
    /classification\.tiers\[1\]\.score is 1, but a tier in the optimal zone is the middle of the ramp/
  );

  // The converse is NOT required: a profile that only tells comfortable from outside is a
  // legitimate thing to write, and its middle carries 0 without claiming to be optimal.
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

// A painted tier answers to none of it, which is what keeps every profile written before
// palettes existed valid — and a mixed profile is read as its colourless tiers alone.
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
    assert.throws(
      () =>
        classification.normalizeCustomClassification(
          validCustom({
            tiers: [
              { min: 24, score: 9, level: "Warm", zone: "outside" },
              { default: true, score, level: "Cold", zone: "outside" },
            ],
          }),
          COLLABORATORS
        ),
      {
        message: `Invalid configuration: classification.tiers[1].score must be a whole number of steps from optimal to take a color from the palette, but is ${score}.`,
      },
      String(score)
    );
  }
});

// A painted tier is not on the ramp at all, so its score is under no obligation to be a
// distance -- which is what keeps every profile written before palettes existed valid.
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

"use strict";

// Direct unit tests for src/config/* — the full normalization pipeline.
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

const test = require("node:test");
const assert = require("node:assert/strict");

let primitives;
let actions;
let rooms;
let views;
let classification;
let profileParts;
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
  primitives = await import("../../src/config/primitives.js");
  actions = await import("../../src/config/actions.js");
  rooms = await import("../../src/config/rooms.js");
  views = await import("../../src/config/views.js");
  classification = await import("../../src/config/classification/normalize.js");
  profileParts = await import("../../src/config/classification/profile-parts.js");
  normalizeConfigModule = await import("../../src/config/normalize-config.js");
  paletteModule = await import("../../src/config/classification/palette.js");
});

// ------------------------------------------------------------- primitives --

test("isPlainObject() rejects arrays and everything non-object", () => {
  const { isPlainObject } = primitives;
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  for (const invalid of [[], null, undefined, "x", 1, true, () => {}]) {
    assert.equal(isPlainObject(invalid), false, JSON.stringify(String(invalid)));
  }
});

test("requiredEntity() trims and rejects anything unusable", () => {
  const { requiredEntity } = primitives;
  assert.equal(requiredEntity("  sensor.a  ", "entity"), "sensor.a");
  for (const invalid of ["", "   ", null, undefined, 5, {}, []]) {
    assert.throws(
      () => requiredEntity(invalid, "entity"),
      { message: "Invalid configuration: entity must be a non-empty entity id." },
      JSON.stringify(String(invalid))
    );
  }
  assert.throws(() => requiredEntity("", "rooms[2].entity"), {
    message: "Invalid configuration: rooms[2].entity must be a non-empty entity id.",
  });
});

test("optionalEntity() distinguishes absent from malformed", () => {
  const { optionalEntity } = primitives;
  assert.equal(optionalEntity(undefined, null, "range_entity"), null, "absent uses the fallback");
  assert.equal(optionalEntity(null, null, "range_entity"), null);
  assert.equal(optionalEntity("", null, "range_entity"), null, "empty string counts as absent");
  assert.equal(optionalEntity(" sensor.r ", null, "range_entity"), "sensor.r");
  for (const invalid of [5, {}, [], "   "]) {
    assert.throws(
      () => optionalEntity(invalid, null, "range_entity"),
      { message: "Invalid configuration: range_entity must be an entity id string." },
      JSON.stringify(String(invalid))
    );
  }
});

test("optionalString() falls back to null instead of throwing", () => {
  const { optionalString } = primitives;
  assert.equal(optionalString(" Title "), "Title");
  for (const empty of ["", "   ", null, undefined, 5, {}, true]) {
    assert.equal(optionalString(empty), null, JSON.stringify(String(empty)));
  }
});

test("stringOrDefault() coerces and honours the fallback chain", () => {
  const { stringOrDefault } = primitives;
  assert.equal(stringOrDefault("Kitchen", "fallback"), "Kitchen");
  assert.equal(stringOrDefault(undefined, "fallback"), "fallback");
  assert.equal(stringOrDefault(null, "fallback"), "fallback");
  assert.equal(stringOrDefault("", "fallback"), "fallback");
  assert.equal(stringOrDefault(0, "fallback"), "0", "a real 0 is a value, not an absence");
  assert.equal(stringOrDefault(undefined, undefined), "");
});

test("normalizeEnum() silently falls back for anything outside the set", () => {
  const { normalizeEnum } = primitives;
  assert.equal(normalizeEnum("name", ["configured", "name"], "configured"), "name");
  for (const invalid of ["NAME", "", null, undefined, 1, true]) {
    assert.equal(normalizeEnum(invalid, ["configured", "name"], "configured"), "configured");
  }
});

test("decimalsOverride() accepts only integers 0..2", () => {
  const { decimalsOverride } = primitives;
  for (const [input, expected] of [[0, 0], [1, 1], [2, 2], ["1", 1]]) {
    assert.equal(decimalsOverride(input), expected, JSON.stringify(input));
  }
  for (const invalid of [-1, 3, 1.5, true, "x", {}, [], null, undefined, ""]) {
    assert.equal(decimalsOverride(invalid), null, JSON.stringify(String(invalid)));
  }
});

test("positiveInteger() accepts 1..20 and nothing else", () => {
  const { positiveInteger } = primitives;
  assert.equal(positiveInteger(1), 1);
  assert.equal(positiveInteger(20), 20);
  assert.equal(positiveInteger("7"), 7);
  for (const invalid of [0, -1, 21, 2.5, true, "x", null, undefined, ""]) {
    assert.equal(positiveInteger(invalid), null, JSON.stringify(String(invalid)));
  }
});

test("positiveSeconds() clamps to its bounds by falling back, not by capping", () => {
  const { positiveSeconds } = primitives;
  assert.equal(positiveSeconds(30, 14, 1, 3600), 30);
  assert.equal(positiveSeconds("2.5", 1, 0.1, 10), 2.5);
  assert.equal(positiveSeconds(0.5, 14, 1, 3600), 14, "below min falls back, it is not raised to min");
  assert.equal(positiveSeconds(99999, 14, 1, 3600), 14, "above max falls back, it is not lowered to max");
  assert.equal(positiveSeconds(true, 14, 1, 3600), 14);
  assert.equal(positiveSeconds(undefined, 14, 1, 3600), 14);
});

test("numberAtPath() throws with the path in the message", () => {
  const { numberAtPath } = primitives;
  assert.equal(numberAtPath("21.5", "classification.scale.min"), 21.5);
  assert.throws(() => numberAtPath("x", "classification.scale.min"), {
    message: "Invalid configuration: classification.scale.min must be a finite number.",
  });
  assert.throws(() => numberAtPath(true, "classification.tiers[0].score"), {
    message: "Invalid configuration: classification.tiers[0].score must be a finite number.",
  });
});

test("assertAllowedKeys() names the first offending key", () => {
  const { assertAllowedKeys } = primitives;
  assert.doesNotThrow(() => assertAllowedKeys({ min: 1 }, new Set(["min", "max"]), "classification.scale"));
  assert.throws(() => assertAllowedKeys({ bogus: 1 }, new Set(["min"]), "classification.scale"), {
    message: "Invalid configuration: classification.scale.bogus is not a supported option.",
  });
});

// ---------------------------------------------------------------- actions --

test("normalizeAction() accepts only allowlisted action names", () => {
  const { normalizeAction } = actions;
  assert.deepEqual(normalizeAction({ action: "toggle" }, null), { action: "toggle" });
  assert.deepEqual(
    normalizeAction({ action: "navigate", navigation_path: "/x" }, null),
    { action: "navigate", navigation_path: "/x" },
    "extra parameters are preserved"
  );
  for (const invalid of [{ action: "call-service" }, { action: 5 }, {}, null, undefined, "toggle", []]) {
    assert.equal(normalizeAction(invalid, null), null, JSON.stringify(invalid));
  }
});

test("normalizeAction() copies the fallback instead of sharing it", () => {
  const { normalizeAction } = actions;
  const fallback = { action: "more-info" };
  const result = normalizeAction("nonsense", fallback);
  assert.deepEqual(result, fallback);
  assert.notEqual(result, fallback, "a mutation must not reach back into the defaults");
  const passed = normalizeAction({ action: "toggle" }, fallback);
  passed.action = "url";
  assert.equal(fallback.action, "more-info");
});

// ------------------------------------------------------------------ rooms --

test("normalizeRoom() derives name and short from each other", () => {
  const { normalizeRoom } = rooms;
  assert.deepEqual(normalizeRoom({ name: "Kitchen", short: "KI", entity: "sensor.k" }, 0), {
    name: "Kitchen",
    short: "KI",
    entity: "sensor.k",
    tap_action: null,
    hold_action: null,
  });
  assert.deepEqual(normalizeRoom({ short: "KI", entity: "sensor.k" }, 0).name, "KI", "name falls back to short");
  assert.deepEqual(normalizeRoom({ name: "Kitchen", entity: "sensor.k" }, 0).short, "Kitchen", "short falls back to name");
  assert.deepEqual(normalizeRoom({ entity: "sensor.k" }, 0).name, "sensor.k", "both fall back to the entity id");
});

test("normalizeRoom() reports its own index in the error", () => {
  const { normalizeRoom } = rooms;
  assert.throws(() => normalizeRoom("sensor.k", 3), {
    message: "Invalid configuration: rooms[3] must be an object.",
  });
  assert.throws(() => normalizeRoom({ name: "A" }, 2), {
    message: "Invalid configuration: rooms[2].entity must be a non-empty entity id.",
  });
});

test("normalizeRooms() rejects a duplicate entity outright", () => {
  const { normalizeRooms } = rooms;
  assert.throws(
    () => normalizeRooms([{ entity: "sensor.a" }, { entity: "sensor.b" }, { entity: "sensor.a" }]),
    { message: 'Invalid configuration: duplicate rooms[].entity "sensor.a" — each room must reference a unique entity.' }
  );
  // Whitespace is trimmed first, so two spellings of one entity still collide.
  assert.throws(() => normalizeRooms([{ entity: "sensor.a" }, { entity: " sensor.a " }]), /duplicate rooms\[\]\.entity/);
});

test("normalizeRooms() rejects a non-array and preserves order", () => {
  const { normalizeRooms } = rooms;
  assert.throws(() => normalizeRooms("sensor.a"), { message: "Invalid configuration: rooms must be an array." });
  assert.deepEqual(
    normalizeRooms([{ entity: "sensor.b" }, { entity: "sensor.a" }]).map((r) => r.entity),
    ["sensor.b", "sensor.a"],
    "declaration order is preserved"
  );
  assert.deepEqual(normalizeRooms([]), []);
});

// ------------------------------------------------------------------ views --

test("an omitted views: config is the not-configured sentinel and is not diagnosed", () => {
  for (const absent of [undefined, null]) {
    assert.deepEqual(views.normalizeViewsConfig(absent, COLLABORATORS), { views: null, diagnostics: [] });
  }
});

test("a non-array views: config is diagnosed and normalizes to the sentinel", () => {
  const result = views.normalizeViewsConfig("scale", COLLABORATORS);
  assert.equal(result.views, null);
  assert.deepEqual(result.diagnostics, ['views: expected an array, got "scale"']);
});

test("string and object entry forms both mean enabled", () => {
  assert.deepEqual(views.normalizeViewsConfig(["scale"], COLLABORATORS), {
    views: [{ type: "scale", enabled: true, options: {} }],
    diagnostics: [],
  });
  assert.deepEqual(views.normalizeViewsConfig([{ type: "scale" }], COLLABORATORS).views, [
    { type: "scale", enabled: true, options: {} },
  ]);
});

test("every view-entry diagnosis keeps its exact wording", () => {
  const cases = [
    [["   "], 'views[0]: expected a non-empty string or an object'],
    [[42], "views[0]: expected a string or an object, got 42"],
    [[{ enabled: true }], 'views[0]: missing or invalid "type"'],
    [[{ type: "scale", enabled: "yes" }], 'views[0] ("scale"): invalid "enabled" value "yes", falling back to "auto"'],
    [[{ type: "scale", options: "all" }], 'views[0] ("scale"): invalid "options" value "all", expected an object'],
    [[{ type: "scale", options: { bogus: 1, other: 2 } }], 'views[0] ("scale"): ignoring unknown "options" key(s) "bogus", "other"'],
    [[{ type: "scale", options: { show_comfort_band: "yes" } }], 'views[0] ("scale"): invalid "show_comfort_band" value "yes", falling back to default'],
    [[{ type: "scale", options: { markers: "some" } }], 'views[0] ("scale"): invalid "markers" value "some", falling back to default'],
  ];
  for (const [input, expected] of cases) {
    const { diagnostics } = views.normalizeViewsConfig(input, COLLABORATORS);
    assert.ok(diagnostics.includes(expected), `${JSON.stringify(input)}\n  got: ${JSON.stringify(diagnostics)}`);
  }
});

test("an invalid enabled: falls back to auto rather than dropping the view", () => {
  const { views: result } = views.normalizeViewsConfig([{ type: "scale", enabled: "yes" }], COLLABORATORS);
  assert.deepEqual(result, [{ type: "scale", enabled: "auto", options: {} }]);
});

test("an explicit auto delegates, an omitted enabled does not", () => {
  const { views: result } = views.normalizeViewsConfig(
    [{ type: "scale", enabled: "auto" }, { type: "scale", enabled: false }],
    COLLABORATORS
  );
  assert.deepEqual(result.map((r) => r.enabled), ["auto", false]);
});

test("an unresolvable entry is dropped while the rest survives", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig([42, "scale"], COLLABORATORS);
  assert.deepEqual(result, [{ type: "scale", enabled: true, options: {} }]);
  assert.equal(diagnostics.length, 1);
});

test("view options are filtered against the requested view's own schema", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "scale", options: { show_comfort_band: false, markers: "all", bogus: 1 } }],
    COLLABORATORS
  );
  assert.deepEqual(result[0].options, { show_comfort_band: false, markers: "all" });
  assert.equal(diagnostics.length, 1, "only the unknown key is diagnosed");
});

test("an unknown view type has no schema, so all its options are stripped", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "bogus", options: { anything: 1 } }],
    COLLABORATORS
  );
  assert.deepEqual(result, [{ type: "bogus", enabled: true, options: {} }], "the type itself survives for the resolver to reject");
  assert.match(diagnostics[0], /ignoring unknown "options" key/);
});

test("a schema entry without validate() is whitelisted but not value-checked", () => {
  const { views: result, diagnostics } = views.normalizeViewsConfig(
    [{ type: "scale", options: { legacy: "anything at all" } }],
    COLLABORATORS
  );
  assert.deepEqual(result[0].options, { legacy: "anything at all" });
  assert.deepEqual(diagnostics, []);
});

test("omitted options are not diagnosed", () => {
  for (const absent of [undefined, null]) {
    const { diagnostics } = views.normalizeViewsConfig([{ type: "scale", options: absent }], COLLABORATORS);
    assert.deepEqual(diagnostics, []);
  }
});

// --------------------------------------------------------- classification --

test("the classification shorthands map to the documented policies", () => {
  const n = (value) => classification.normalizeClassificationConfig(value, COLLABORATORS);
  const auto = { source: "auto", profile: null, custom: null };
  for (const absent of [undefined, null, "", "   "]) assert.deepEqual(n(absent), auto, JSON.stringify(absent));
  assert.deepEqual(n("auto"), auto);
  assert.deepEqual(n("entity"), { source: "entity", profile: null, custom: null });
  assert.deepEqual(n("outdoor"), { source: "auto", profile: "outdoor", custom: null }, "a bare name is a profile request");
  assert.deepEqual(n("OUTDOOR"), { source: "auto", profile: "outdoor", custom: null }, "case-insensitive");
});

test("the source-only shorthands that need the object form are rejected", () => {
  for (const shorthand of ["profile", "custom"]) {
    assert.throws(
      () => classification.normalizeClassificationConfig(shorthand, COLLABORATORS),
      { message: `Invalid configuration: classification "${shorthand}" requires the object form.` }
    );
  }
});

test("the object form validates source, profile and their combination", () => {
  const n = (value) => classification.normalizeClassificationConfig(value, COLLABORATORS);
  assert.deepEqual(n({ source: "profile", profile: "Fridge" }), { source: "profile", profile: "fridge", custom: null });
  assert.throws(() => n(5), { message: "Invalid configuration: classification must be a string or object." });
  assert.throws(() => n({ source: "nope" }), {
    message: 'Invalid configuration: classification.source must be "auto", "entity", "profile", or "custom".',
  });
  assert.throws(() => n({ source: "entity", profile: "indoor" }), {
    message: "Invalid configuration: classification.profile cannot be combined with source entity.",
  });
  assert.throws(() => n({ source: "profile", profile: "  " }), {
    message: "Invalid configuration: classification.profile must be a non-empty string.",
  });
  assert.throws(() => n({ source: "auto", bogus: true }), {
    message: "Invalid configuration: classification.bogus is not a supported option.",
  });
});

test("a block carrying tiers is inferred as custom even without an explicit source", () => {
  const result = classification.normalizeClassificationConfig(
    { ...validCustom(), source: undefined },
    COLLABORATORS
  );
  assert.equal(result.source, "custom");
  assert.equal(result.custom.id, "custom");
});

test("a valid custom profile is converted into the canonical unit", () => {
  const result = classification.normalizeCustomClassification(validCustom(), COLLABORATORS);
  assert.equal(result.metricKind, "temperature");
  assert.equal(result.comparison, ">=");
  assert.deepEqual(result.comfort, { min: 19, max: 25 }, "Celsius input needs no conversion");
  assert.deepEqual(result.tiers.map((t) => t.min), [24, 20, -Infinity]);
  assert.deepEqual(result.tiers.map((t) => t.level), ["Warm", "Ok", "Cold"]);
  assert.equal(result.step, 2);
  assert.equal(result.headroom, undefined, "an omitted headroom stays undefined, not null");
  assert.equal(result.oneSided, false);
  assert.equal(result.invalidWhen, null, "no valid_range means no validity predicate");
  assert.equal(result.validRange, null);
  // Colourless, like every other part of a profile: what an unusable reading looks like
  // is the palette's answer, so a custom profile does not carry a fixed hex that would
  // clash with every palette but the default.
  assert.deepEqual(result.invalidClassification, {
    score: null,
    levelKey: "level.invalidReading",
    zone: "invalid",
  });
});

test("a Fahrenheit custom profile converts absolutes and deltas differently", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({
      unit: "°F",
      bands: { comfort: { min: 66, max: 77 }, optimal: { min: 70, max: 73 } },
      scale: { min: 60, max: 82, step: 2 },
      tiers: [
        { min: 75, score: 3, level: "Warm", color: "#cc4444", zone: "outside" },
        { min: 68, score: 2, level: "Ok", color: "#44cc66", zone: "optimal" },
        { default: true, score: 1, level: "Cold", color: "#4488cc", zone: "outside" },
      ],
    }),
    COLLABORATORS
  );
  // 68 °F = 20 °C absolute; a 2 °F step is 1.11 °C, NOT -16.67 °C.
  assert.ok(Math.abs(result.tiers[1].min - 20) < 1e-9, `got ${result.tiers[1].min}`);
  assert.ok(Math.abs(result.step - (2 * 5) / 9) < 1e-9, `got ${result.step}`);
  assert.equal(result.tiers[2].min, -Infinity, "the open-ended tier survives conversion");
});

test("custom scale switches and headroom are carried through", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({ scale: { min: 16, max: 28, step: 2, headroom: 4, one_sided: true } }),
    COLLABORATORS
  );
  assert.equal(result.oneSided, true);
  assert.equal(result.headroom, 4);
});

// `classification.scale` describes the profile's reference axis, and it has exactly two
// shapes: a declared range the drawn axis always covers, or no range at all and an axis
// that follows the readings — which is what the built-in outdoor profile does, because
// an outdoor range that is right in January is wrong in July. The two are alternatives,
// not settings that combine, so declaring both is a contradiction rather than a
// preference and is refused as one.
test("a custom profile can hand the axis to the data by declaring no range at all", () => {
  const following = classification.normalizeCustomClassification(
    validCustom({
      scale: { step: 2, anchor_scale: false },
      // A temperature profile derives its fire/low icon thresholds from the reference
      // range; with none, it has to say them itself.
      icons: { fire: 30, high: 26, normal: 19, low: 14 },
    }),
    COLLABORATORS
  );
  assert.equal(following.anchorScale, false);
  assert.equal(following.scale, null, "no declared range means none is carried, not an invented one");
  assert.equal(following.step, 2, "the rounding step is still needed for the axis labels");

  const anchored = classification.normalizeCustomClassification(
    validCustom({ scale: { min: 16, max: 28, step: 2, anchor_scale: true } }),
    COLLABORATORS
  );
  assert.equal(anchored.anchorScale, true);
  assert.deepEqual(anchored.scale, { min: 16, max: 28 });
});

test("an omitted anchor_scale keeps the anchored axis every other built-in profile uses", () => {
  const result = classification.normalizeCustomClassification(validCustom(), COLLABORATORS);
  assert.equal(result.anchorScale, true);
});

// The rule this replaces refused any scale that did not fully contain the bands. The
// bar is a window onto the value range and bands are clipped into that window, so a
// band reaching past the declared range is drawn as far as the axis goes and no
// further — the same thing that already happens whenever an anchored axis has not yet
// grown to meet a band. Nothing about it is untrue, so nothing about it is refused.
test("a scale narrower than the comfort band is accepted and carried through unchanged", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({
      bands: { comfort: { min: 18, max: 26 }, optimal: { min: 21, max: 23 } },
      scale: { min: 20, max: 24, step: 2 },
      icons: { fire: 30, high: 26, normal: 20, low: 14 },
    }),
    COLLABORATORS
  );
  assert.deepEqual(result.scale, { min: 20, max: 24 }, "the declared range is not silently widened either");
  assert.deepEqual(result.comfort, { min: 18, max: 26 });
});

// normalizeScale() is the only reader of the scale block, and every switch leaves it
// already validated and camel-cased. Pinned here because the alternative — the caller
// reaching back into the raw YAML for one of them — is what this replaced, and it is the
// kind of thing that grows back.
test("normalizeScale returns the range and every switch in its resolved form", () => {
  assert.deepEqual(
    profileParts.normalizeScale({ min: 16, max: 28, step: 2 }),
    { scale: { min: 16, max: 28 }, step: 2, headroom: null, oneSided: false, anchorScale: true }
  );
  assert.deepEqual(
    profileParts.normalizeScale({ min: 16, max: 28, step: 2, headroom: 4, one_sided: true }),
    { scale: { min: 16, max: 28 }, step: 2, headroom: 4, oneSided: true, anchorScale: true }
  );
  assert.deepEqual(
    profileParts.normalizeScale({ step: 2, headroom: 4, anchor_scale: false }),
    { scale: null, step: 2, headroom: 4, oneSided: false, anchorScale: false }
  );
});

test("a custom valid_range becomes a predicate honouring both inclusivity flags", () => {
  const inclusive = classification.normalizeCustomClassification(
    validCustom({ valid_range: { min: 0, max: 50 } }),
    COLLABORATORS
  );
  assert.equal(inclusive.invalidWhen(0), false, "inclusive by default");
  assert.equal(inclusive.invalidWhen(50), false);
  assert.equal(inclusive.invalidWhen(-0.1), true);
  assert.equal(inclusive.invalidWhen(50.1), true);

  const exclusive = classification.normalizeCustomClassification(
    validCustom({ valid_range: { min: 0, max: 50, min_inclusive: false, max_inclusive: false } }),
    COLLABORATORS
  );
  assert.equal(exclusive.invalidWhen(0), true, "exclusive rejects the bound itself");
  assert.equal(exclusive.invalidWhen(50), true);
  assert.equal(exclusive.invalidWhen(0.1), false);

  const onlyMin = classification.normalizeCustomClassification(
    validCustom({ valid_range: { min: 0 } }),
    COLLABORATORS
  );
  assert.equal(onlyMin.invalidWhen(1e9), false, "an omitted bound is unbounded");
  assert.equal(onlyMin.invalidWhen(-1), true);
});

// One meaning of "no icons", for every measurement: none. The temperature-only
// derivation from the scale and comfort bands is gone, and with it the one place where
// omitting a field meant something different depending on what was being measured.
test("omitting icons declares none, whatever the profile measures", () => {
  for (const overrides of [
    {},
    { unit: "%", bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } }, scale: { min: 30, max: 70, step: 5 } },
  ]) {
    const result = classification.normalizeCustomClassification(validCustom(overrides), COLLABORATORS);
    assert.equal(result.iconTiers, null, JSON.stringify(overrides));
  }
});

// The fire/high/normal/low object is the spelling released profiles use. It survives as
// an INPUT only: what comes out is the same list every other profile carries, with the
// five icons that spelling always implied.
test("the temperature threshold object normalizes into the shared icon list", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({ icons: { fire: 30, high: 26, normal: 20, low: 14 } }),
    COLLABORATORS
  );
  assert.deepEqual(result.iconTiers, [
    { min: 30, icon: "mdi:fire-alert" },
    { min: 26, icon: "mdi:thermometer-high" },
    { min: 20, icon: "mdi:thermometer" },
    { min: 14, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ]);
});

// And the same profile written in the list form has to come out identical, or the two
// spellings would not be two spellings of one thing.
test("both spellings of the same temperature icons produce the same profile", () => {
  const asObject = classification.normalizeCustomClassification(
    validCustom({ icons: { fire: 30, high: 26, normal: 20, low: 14 } }),
    COLLABORATORS
  );
  const asList = classification.normalizeCustomClassification(
    validCustom({
      icons: [
        { min: 30, icon: "mdi:fire-alert" },
        { min: 26, icon: "mdi:thermometer-high" },
        { min: 20, icon: "mdi:thermometer" },
        { min: 14, icon: "mdi:thermometer-low" },
        { default: true, icon: "mdi:snowflake" },
      ],
    }),
    COLLABORATORS
  );
  assert.deepEqual(asList.iconTiers, asObject.iconTiers);
});

// A temperature profile may now choose its own icons, which the threshold object never
// allowed — the card no longer owns that decision for one measurement and not the others.
test("a temperature profile can choose icons of its own", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({
      icons: [
        { min: 30, icon: "mdi:sun-thermometer" },
        { default: true, icon: "mdi:home-thermometer" },
      ],
    }),
    COLLABORATORS
  );
  assert.deepEqual(result.iconTiers, [
    { min: 30, icon: "mdi:sun-thermometer" },
    { min: -Infinity, icon: "mdi:home-thermometer" },
  ]);
});

test("a non-temperature custom profile uses the shared icon list", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({
      unit: "%",
      bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } },
      scale: { min: 30, max: 70, step: 5 },
      icons: [
        { min: 60, icon: "mdi:water-plus" },
        { default: true, icon: "mdi:water-minus" },
      ],
    }),
    COLLABORATORS
  );
  assert.equal(result.metricKind, "humidity");
  assert.deepEqual(result.iconTiers, [
    { min: 60, icon: "mdi:water-plus" },
    { min: -Infinity, icon: "mdi:water-minus" },
  ]);
});

test("every custom-classification rejection keeps its exact message", () => {
  const cases = [
    [validCustom({ unit: undefined }), "Invalid configuration: classification.unit must be a recognized unit string."],
    [validCustom({ unit: "hPa" }), 'Invalid configuration: classification.unit "hPa" is not recognized.'],
    [validCustom({ comparison: ">>" }), 'Invalid configuration: classification.comparison must be ">=" or ">".'],
    [validCustom({ bands: undefined }), "Invalid configuration: classification.bands must be an object."],
    [validCustom({ bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 }, bogus: 1 } }), "Invalid configuration: classification.bands.bogus is not a supported option."],
    [validCustom({ bands: { comfort: { min: 25, max: 25 }, optimal: { min: 21, max: 23 } } }), "Invalid configuration: classification.bands.comfort must have min < max."],
    [validCustom({ bands: { comfort: { min: 21, max: 23 }, optimal: { min: 19, max: 25 } } }), "Invalid configuration: classification.bands.optimal must be fully contained in classification.bands.comfort."],
    [validCustom({ scale: undefined }), "Invalid configuration: classification.scale must be an object."],
    [validCustom({ scale: { min: 16, max: 28, step: 0 } }), "Invalid configuration: classification.scale.step must be greater than zero."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, headroom: -1 } }), "Invalid configuration: classification.scale.headroom must be zero or greater."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, one_sided: "yes" } }), "Invalid configuration: classification.scale.one_sided must be a boolean."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, anchor_scale: "no" } }), "Invalid configuration: classification.scale.anchor_scale must be a boolean."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, anchorScale: false } }), "Invalid configuration: classification.scale.anchorScale is not a supported option."],
    // The two shapes of `scale`, and the four ways of asking for neither of them.
    [validCustom({ scale: { step: 2 } }), "Invalid configuration: classification.scale must define min and max, or set anchor_scale: false to let the axis follow the data."],
    [validCustom({ scale: { min: 16, step: 2 } }), "Invalid configuration: classification.scale.max must be a finite number."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, anchor_scale: false } }), "Invalid configuration: classification.scale must not define min or max when anchor_scale is false, because an axis either covers a declared range or follows the data."],
    [validCustom({ scale: { max: 28, step: 2, anchor_scale: false } }), "Invalid configuration: classification.scale must not define min or max when anchor_scale is false, because an axis either covers a declared range or follows the data."],
    [validCustom({ scale: { step: 2, anchor_scale: false, one_sided: true }, icons: { fire: 30, high: 26, normal: 19, low: 14 } }), "Invalid configuration: classification.scale.one_sided requires an anchored axis, because it keeps the lower bound at classification.scale.min."],
    [validCustom({ tiers: [] }), "Invalid configuration: classification.tiers must be a non-empty array."],
    [validCustom({ tiers: ["x"] }), "Invalid configuration: classification.tiers[0] must be an object."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "A", color: "#cc4444", zone: "outside", bogus: 1 }] }), "Invalid configuration: classification.tiers[0].bogus is not a supported option."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "A", color: "#cc4444", zone: "outside", default: "yes" }] }), "Invalid configuration: classification.tiers[0].default must be true when present."],
    [validCustom({ tiers: [{ default: true, min: 5, score: 1, level: "A", color: "#cc4444", zone: "outside" }] }), "Invalid configuration: classification.tiers[0].min must be omitted on the default tier."],
    [validCustom({ tiers: [{ score: 1, level: "A", color: "#cc4444", zone: "outside" }] }), "Invalid configuration: classification.tiers[0].min is required for every non-default tier."],
    [validCustom({ tiers: [{ min: 20, score: 2, level: "A", color: "#cc4444", zone: "outside" }, { min: 24, score: 1, level: "B", color: "#4488cc", zone: "outside" }, { default: true, score: 0, level: "C", color: "#4488cc", zone: "outside" }] }), "Invalid configuration: classification.tiers must use unique min values in strictly descending order."],
    [validCustom({ tiers: [{ default: true, score: 2, level: "A", color: "#cc4444", zone: "outside" }, { min: 20, score: 1, level: "B", color: "#4488cc", zone: "outside" }] }), "Invalid configuration: classification.tiers[0] default tier must be the final tier."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "A", color: "#cc4444", zone: "outside" }] }), "Invalid configuration: classification.tiers must contain exactly one final default tier."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "  ", color: "#cc4444", zone: "outside" }, { default: true, score: 0, level: "C", color: "#4488cc", zone: "outside" }] }), "Invalid configuration: classification.tiers[0].level must be a non-empty string."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "A", color: "red", zone: "outside" }, { default: true, score: 0, level: "C", color: "#4488cc", zone: "outside" }] }), "Invalid configuration: classification.tiers[0].color must be a 3/4/6/8-digit hex color."],
    [validCustom({ tiers: [{ min: 20, score: 1, level: "A", color: "#cc4444", zone: "elsewhere" }, { default: true, score: 0, level: "C", color: "#4488cc", zone: "outside" }] }), 'Invalid configuration: classification.tiers[0].zone must be one of "optimal", "comfort", "outside", or "invalid".'],
    [validCustom({ valid_range: {} }), "Invalid configuration: classification.valid_range must define min and/or max."],
    [validCustom({ valid_range: { min: 0, max: 50, min_inclusive: "yes" } }), "Invalid configuration: classification.valid_range.min_inclusive must be a boolean."],
    [validCustom({ valid_range: { min: 50, max: 0 } }), "Invalid configuration: classification.valid_range must have min < max."],
    [validCustom({ valid_range: 5 }), "Invalid configuration: classification.valid_range must be an object."],
    [validCustom({ icons: 5 }), "Invalid configuration: classification.icons must be a list of {min, icon} tiers with a final {default: true, icon} entry."],
    [validCustom({ icons: { fire: 20, high: 26, normal: 19, low: 15 } }), "Invalid configuration: classification.icons must descend from fire to low."],
    [validCustom({ bogus: 1 }), "Invalid configuration: classification.bogus is not a supported option."],
  ];
  for (const [input, expected] of cases) {
    assert.throws(
      () => classification.normalizeCustomClassification(input, COLLABORATORS),
      { message: expected },
      `expected: ${expected}`
    );
  }
});

// The threshold object is a temperature-only compatibility spelling; anything else has
// to use the one shape.
test("only a temperature profile may use the legacy threshold object", () => {
  assert.throws(
    () =>
      classification.normalizeCustomClassification(
        validCustom({
          unit: "%",
          bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } },
          scale: { min: 30, max: 70, step: 5 },
          icons: { fire: 80, high: 60, normal: 40, low: 20 },
        }),
        COLLABORATORS
      ),
    { message: "Invalid configuration: classification.icons must be a list of {min, icon} tiers with a final {default: true, icon} entry." }
  );
});

test("validation order is stable: the unit is checked before the bands", () => {
  // Both are broken; the unit must still be the reported problem.
  assert.throws(
    () => classification.normalizeCustomClassification(validCustom({ unit: "hPa", bands: undefined }), COLLABORATORS),
    /classification\.unit "hPa" is not recognized/
  );
  // Both bands and scale are broken; bands must win.
  assert.throws(
    () => classification.normalizeCustomClassification(validCustom({ bands: undefined, scale: undefined }), COLLABORATORS),
    /classification\.bands must be an object/
  );
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
  // YAML turns an all-digit hex into a NUMBER. Its decimal spelling is the six digits the
  // user typed, so they are recoverable — and anything that does not come back as exactly
  // six digits is refused rather than guessed at.
  assert.equal(optimalOf(123456), "#123456", "a number YAML made of six digits");
  assert.throws(() => optimalOf(12345), /palette\.optimal/, "five digits is not a colour");
  assert.throws(() => optimalOf(1.5), /palette\.optimal/, "and neither is a fraction");
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

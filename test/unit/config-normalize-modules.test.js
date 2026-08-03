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
let normalizeConfigModule;

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

const COLLABORATORS = {
  classificationZones: ZONES,
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
  normalizeConfigModule = await import("../../src/config/normalize-config.js");
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
  assert.deepEqual(result.invalidClassification, {
    score: null,
    levelKey: "level.invalidReading",
    color: "#B4B2A9",
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

test("temperature icons default to the scale and comfort bands when omitted", () => {
  const result = classification.normalizeCustomClassification(validCustom(), COLLABORATORS);
  assert.deepEqual(result.iconThresholds, { fire: 28, high: 25, normal: 19, low: 16 });
  assert.equal(result.iconTiers, undefined);
});

test("a non-temperature custom profile uses icon tiers and no thresholds", () => {
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
  assert.equal(result.iconThresholds, null);
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
    [validCustom({ scale: { min: 20, max: 24, step: 2 } }), "Invalid configuration: classification.scale must fully contain the comfort and optimal bands."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, headroom: -1 } }), "Invalid configuration: classification.scale.headroom must be zero or greater."],
    [validCustom({ scale: { min: 16, max: 28, step: 2, one_sided: "yes" } }), "Invalid configuration: classification.scale.one_sided must be a boolean."],
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
    [validCustom({ icons: 5 }), "Invalid configuration: classification.icons must be an object with fire/high/normal/low thresholds for a temperature profile."],
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

test("a non-temperature profile rejects the temperature icon shape", () => {
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
    { message: "Invalid configuration: classification.icons must be a list of {min, icon} tiers with a final {default: true, icon} entry for a non-temperature profile." }
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

test("value_label preserves the explicit empty-string sentinel", () => {
  const n = (value) => normalizeConfigModule.normalizeConfig({ entity: "sensor.avg", value_label: value }, COLLABORATORS);
  assert.equal(n(undefined).value_label, null);
  assert.equal(n(" Home ").value_label, "Home");
  assert.equal(n("").value_label, "");
  assert.equal(n("   ").value_label, "");
  assert.equal(n(5).value_label, null);
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

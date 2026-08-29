"use strict";

// Direct unit tests for classification and custom-profile normalization.
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
// This file owns the CLASSIFICATION sub-tree: the built-in profiles, a custom profile written
// in YAML, and the parts a profile is assembled from. It is the one corner of the config
// layer with a shape of its own rather than a flat list of keys, which is why it is tested
// apart from the normalizer that calls it.
//
// The boundary to config-normalize-modules.test.js next door: how the classification result
// is fitted into the finished config, and everything else about the top level, is that file's
// subject.

const test = require("node:test");
const assert = require("node:assert/strict");
const { VIEWS } = require("../../manifests/product-surface.js");

let classification;
let profileParts;

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
  classification = await import("../../../src/config/classification/normalize.js");
  profileParts = await import("../../../src/config/classification/profile-parts.js");
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


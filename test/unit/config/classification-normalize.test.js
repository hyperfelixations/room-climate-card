"use strict";

// Direct unit tests for classification and custom-profile normalization. Every value rule of a
// custom profile answers with the path and the value it refuses, and the classification object
// turns that into one warning and the automatic policy; a key the profile does not have refuses
// the configuration at any depth. Collaborators are stubbed, which is the point of injecting them.
// Boundary: this file owns the classification sub-tree (built-in profiles, a YAML custom
// profile, the parts a profile is assembled from); how the result fits into the finished
// config is config-normalize-modules.test.js. See internal dev doc §5 "Custom-Profile-Vertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const { VIEWS } = require("../../manifests/product-surface.js");

let classification;
let profileParts;
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

const TINY_PALETTE = { id: "tiny", below: ["#111111"], optimal: "#222222", above: ["#333333"], invalid: "#999999" };

const COLLABORATORS = {
  classificationZones: ZONES,
  paletteForName: () => TINY_PALETTE,
  paletteForColor: () => null,
  paletteForGradient: () => null,
  assertPalette: (palette) => palette,
  completePalette: (palette) => palette,
  isSupportedLanguage: (code) => SUPPORTED.has(code),
  viewTypes: VIEWS,
  optionSchemaForView: () => undefined,
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

// A Fahrenheit profile with one part replaced; everything it starts with converts finitely.
function fahrenheitCustom(overrides = {}) {
  return validCustom({
    unit: "°F",
    bands: { comfort: { min: 66, max: 77 }, optimal: { min: 70, max: 73 } },
    scale: { min: 60, max: 82, step: 2 },
    tiers: [
      { min: 75, score: 3, level: "Warm", color: "#cc4444", zone: "outside" },
      { min: 68, score: 2, level: "Ok", color: "#44cc66", zone: "optimal" },
      { default: true, score: 1, level: "Cold", color: "#4488cc", zone: "outside" },
    ],
    ...overrides,
  });
}

// Temperature thresholds for a profile whose axis follows the data.
const ICON_THRESHOLDS = { fire: 30, high: 26, normal: 19, low: 14 };

test.before(async () => {
  classification = await import("../../../src/config/classification/normalize.js");
  profileParts = await import("../../../src/config/classification/profile-parts.js");
  core = await import("../../../src/core/diagnostics.js");
  errors = await import("../../../src/config/errors.js");
});

const AUTO = { source: "auto", profile: null, custom: null };
const invalid = (path, value, fallback) => core.createDiagnostic("value.invalid", { path, value, fallback });

// The classification object read the way normalizeConfig() reads it.
function policyOf(value) {
  const diagnostics = [];
  return { policy: classification.normalizeClassificationConfig(value, COLLABORATORS, diagnostics), diagnostics };
}

// A custom-profile rule refuses the value it found at the path it found it.
function refusedAt(profile, path, value) {
  assert.throws(
    () => classification.normalizeCustomClassification(profile, COLLABORATORS),
    (error) => error instanceof errors.ConfigValueError && error.path === path && isDeepStrictEqual(error.value, value),
    `${path} = ${JSON.stringify(value)}`
  );
}

// --------------------------------------------------------- classification --

test("the classification shorthands map to the documented policies", () => {
  for (const absent of [undefined, null]) assert.deepEqual(policyOf(absent), { policy: AUTO, diagnostics: [] }, JSON.stringify(absent));
  assert.deepEqual(policyOf("auto").policy, AUTO);
  assert.deepEqual(policyOf("entity").policy, { source: "entity", profile: null, custom: null });
  assert.deepEqual(policyOf("outdoor").policy, { source: "auto", profile: "outdoor", custom: null }, "a bare name is a profile request");
  assert.deepEqual(policyOf("OUTDOOR").policy, { source: "auto", profile: "outdoor", custom: null }, "case-insensitive");
});

test("an empty shorthand, or one that needs the object form, falls back to auto with a warning", () => {
  for (const value of ["", "   ", "profile", "custom", "Custom"]) {
    assert.deepEqual(
      policyOf(value),
      { policy: AUTO, diagnostics: [invalid("classification", value, core.fallbackValue("auto"))] },
      JSON.stringify(value)
    );
  }
});

test("the object form checks source, profile and their combination, and falls back where they fail", () => {
  const { FALLBACK, fallbackValue } = core;
  assert.deepEqual(policyOf({ source: "profile", profile: "Fridge" }), {
    policy: { source: "profile", profile: "fridge", custom: null },
    diagnostics: [],
  });
  assert.deepEqual(policyOf(5), { policy: AUTO, diagnostics: [invalid("classification", 5, fallbackValue("auto"))] });
  assert.deepEqual(policyOf({ source: "nope" }), { policy: AUTO, diagnostics: [invalid("classification.source", "nope", fallbackValue("auto"))] });
  assert.deepEqual(policyOf({ source: "entity", profile: "indoor" }), {
    policy: { source: "entity", profile: null, custom: null },
    diagnostics: [invalid("classification.profile", "indoor", FALLBACK.IGNORED)],
  });
  for (const profile of ["  ", 42]) {
    assert.deepEqual(
      policyOf({ source: "profile", profile }),
      { policy: AUTO, diagnostics: [invalid("classification.profile", profile, fallbackValue("auto"))] },
      JSON.stringify(profile)
    );
  }
  assert.deepEqual(policyOf({ source: "entity", profile: null }), { policy: { source: "entity", profile: null, custom: null }, diagnostics: [] });
});

test("a key the classification object does not have refuses the configuration, before its values are read", () => {
  assert.throws(() => policyOf({ source: "auto", bogus: true }), {
    name: "ConfigError",
    message: "Invalid configuration: classification.bogus is not an option of this card.",
  });
  assert.throws(() => policyOf({ source: "profile", profle: "indoor" }), {
    name: "ConfigError",
    message: "Invalid configuration: classification.profle is not an option of this card. Did you mean classification.profile?",
  });
  assert.throws(() => policyOf({ source: "nope", bogus: 1 }), { name: "ConfigError" }, "an unknown source does not hide an unknown key");
});

test("a block carrying tiers is inferred as custom even without an explicit source", () => {
  const { policy, diagnostics } = policyOf({ ...validCustom(), source: undefined });
  assert.equal(policy.source, "custom");
  assert.equal(policy.custom.id, "custom");
  assert.deepEqual(diagnostics, []);
  // `tiers:` with nothing after it is a custom profile being typed: it falls back and names the
  // first value it still misses, rather than calling `tiers` foreign to the policy form.
  assert.deepEqual(policyOf({ tiers: null }), {
    policy: AUTO,
    diagnostics: [invalid("classification.unit", undefined, core.fallbackOption("classification", "auto"))],
  });
});

test("a valid custom profile is converted into the canonical unit", () => {
  const result = classification.normalizeCustomClassification(validCustom(), COLLABORATORS);
  assert.equal(result.metricKind, "temperature");
  assert.equal(result.unit, "°C", "as written, for a message that has to name it");
  assert.equal(result.comparison, ">=");
  assert.deepEqual(result.comfort, { min: 19, max: 25 }, "Celsius input needs no conversion");
  assert.deepEqual(result.tiers.map((t) => t.min), [24, 20, -Infinity]);
  assert.deepEqual(result.tiers.map((t) => t.level), ["Warm", "Ok", "Cold"]);
  assert.equal(result.step, 2);
  assert.equal(result.headroom, undefined, "an omitted headroom stays undefined, not null");
  assert.equal(result.oneSided, false);
  assert.equal(result.invalidWhen, null, "no valid_range means no validity predicate");
  assert.equal(result.validRange, null);
  // Colourless: what an unusable reading looks like is the palette's answer.
  assert.deepEqual(result.invalidClassification, {
    score: null,
    levelKey: "level.invalidReading",
    zone: "invalid",
  });
});

test("a Fahrenheit custom profile converts absolutes and deltas differently", () => {
  const result = classification.normalizeCustomClassification(fahrenheitCustom(), COLLABORATORS);
  // 68 °F = 20 °C absolute; a 2 °F step is 1.11 °C, NOT -16.67 °C.
  assert.ok(Math.abs(result.tiers[1].min - 20) < 1e-9, `got ${result.tiers[1].min}`);
  assert.ok(Math.abs(result.step - (2 * 5) / 9) < 1e-9, `got ${result.step}`);
  assert.equal(result.tiers[2].min, -Infinity, "the open-ended tier survives conversion");
});

test("a custom value its unit cannot convert into the canonical unit is refused at its path", () => {
  // 1e308 °F is a finite YAML number; (v - 32) * 5 / 9 is not, and a delta overflows alike.
  const huge = 1e308;
  const cases = [
    ["classification.bands.comfort.max", huge, { bands: { comfort: { min: 66, max: huge }, optimal: { min: 70, max: 73 } } }],
    ["classification.bands.comfort.min", -huge, { bands: { comfort: { min: -huge, max: 77 }, optimal: { min: 70, max: 73 } } }],
    ["classification.scale.max", huge, { scale: { min: 60, max: huge, step: 2 } }],
    ["classification.scale.step", huge, { scale: { min: 60, max: 82, step: huge } }],
    ["classification.scale.headroom", huge, { scale: { min: 60, max: 82, step: 2, headroom: huge } }],
    [
      "classification.tiers[0].min",
      huge,
      {
        tiers: [
          { min: huge, score: 3, level: "Hot", color: "#cc4444", zone: "outside" },
          { default: true, score: 1, level: "Cold", color: "#4488cc", zone: "outside" },
        ],
      },
    ],
    ["classification.valid_range.max", huge, { valid_range: { min: -459.67, max: huge } }],
    ["classification.icons[0].min", huge, { icons: [{ min: huge, icon: "mdi:fire-alert" }, { default: true, icon: "mdi:snowflake" }] }],
    ["classification.icons.fire", huge, { icons: { fire: huge, high: 80, normal: 70, low: 60 } }],
  ];
  for (const [path, value, overrides] of cases) refusedAt(fahrenheitCustom(overrides), path, value);
  assert.doesNotThrow(() => classification.normalizeCustomClassification(fahrenheitCustom(), COLLABORATORS));
  // The same magnitude written in the canonical unit converts to itself and is accepted.
  assert.doesNotThrow(() =>
    classification.normalizeCustomClassification(validCustom({ scale: { min: -1e308, max: 1e308, step: 5 } }), COLLABORATORS)
  );
});

test("custom scale switches and headroom are carried through", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({ scale: { min: 16, max: 28, step: 2, headroom: 4, one_sided: true } }),
    COLLABORATORS
  );
  assert.equal(result.oneSided, true);
  assert.equal(result.headroom, 4);
});

// `classification.scale` has two shapes: a declared range the axis always covers, or no
// range and an axis that follows the readings (what `outdoor` does). They are alternatives,
// so declaring both is refused.
test("a custom profile can hand the axis to the data by declaring no range at all", () => {
  const following = classification.normalizeCustomClassification(
    validCustom({ scale: { step: 2, anchor_scale: false }, icons: ICON_THRESHOLDS }),
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
  assert.equal(classification.normalizeCustomClassification(validCustom(), COLLABORATORS).anchorScale, true);
});

// A band reaching past the declared range is drawn as far as the axis goes and no further,
// the same as an anchored axis that has not yet grown to meet a band, so it is not refused.
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

// normalizeScale() is the only reader of the scale block; every switch leaves it validated
// and camel-cased, so no caller reaches back into the raw YAML.
test("normalizeScale returns the range and every switch in its resolved form", () => {
  assert.deepEqual(profileParts.normalizeScale({ min: 16, max: 28, step: 2 }), {
    scale: { min: 16, max: 28 },
    step: 2,
    headroom: null,
    oneSided: false,
    anchorScale: true,
  });
  assert.deepEqual(profileParts.normalizeScale({ min: 16, max: 28, step: 2, headroom: 4, one_sided: true }), {
    scale: { min: 16, max: 28 },
    step: 2,
    headroom: 4,
    oneSided: true,
    anchorScale: true,
  });
  assert.deepEqual(profileParts.normalizeScale({ step: 2, headroom: 4, anchor_scale: false }), {
    scale: null,
    step: 2,
    headroom: 4,
    oneSided: false,
    anchorScale: false,
  });
});

test("a custom valid_range becomes a predicate honouring both inclusivity flags", () => {
  const inclusive = classification.normalizeCustomClassification(validCustom({ valid_range: { min: 0, max: 50 } }), COLLABORATORS);
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

  const onlyMin = classification.normalizeCustomClassification(validCustom({ valid_range: { min: 0 } }), COLLABORATORS);
  assert.equal(onlyMin.invalidWhen(1e9), false, "an omitted bound is unbounded");
  assert.equal(onlyMin.invalidWhen(-1), true);
});

// "No icons" means none, for every measurement alike.
test("omitting icons declares none, whatever the profile measures", () => {
  for (const overrides of [
    {},
    { unit: "%", bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } }, scale: { min: 30, max: 70, step: 5 } },
  ]) {
    assert.equal(classification.normalizeCustomClassification(validCustom(overrides), COLLABORATORS).iconTiers, null, JSON.stringify(overrides));
  }
});

// The fire/high/normal/low object is an input spelling only; it normalizes into the same
// {min, icon} list every profile carries, with the five icons it implies.
test("the temperature threshold object normalizes into the shared icon list", () => {
  const result = classification.normalizeCustomClassification(validCustom({ icons: { fire: 30, high: 26, normal: 20, low: 14 } }), COLLABORATORS);
  assert.deepEqual(result.iconTiers, [
    { min: 30, icon: "mdi:fire-alert" },
    { min: 26, icon: "mdi:thermometer-high" },
    { min: 20, icon: "mdi:thermometer" },
    { min: 14, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ]);
});

// The same icons written in list form come out identical.
test("both spellings of the same temperature icons produce the same profile", () => {
  const asObject = classification.normalizeCustomClassification(validCustom({ icons: { fire: 30, high: 26, normal: 20, low: 14 } }), COLLABORATORS);
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

// A temperature profile may choose its own icons, in the list form.
test("a temperature profile can choose icons of its own", () => {
  const result = classification.normalizeCustomClassification(
    validCustom({ icons: [{ min: 30, icon: "mdi:sun-thermometer" }, { default: true, icon: "mdi:home-thermometer" }] }),
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
      icons: [{ min: 60, icon: "mdi:water-plus" }, { default: true, icon: "mdi:water-minus" }],
    }),
    COLLABORATORS
  );
  assert.equal(result.metricKind, "humidity");
  assert.deepEqual(result.iconTiers, [
    { min: 60, icon: "mdi:water-plus" },
    { min: -Infinity, icon: "mdi:water-minus" },
  ]);
});

// ------------------------------------------------ what a custom profile refuses --

const tier = (fields) => ({ score: 1, level: "A", color: "#cc4444", zone: "outside", ...fields });
const defaultTier = (fields = {}) => ({ default: true, score: 0, level: "C", color: "#4488cc", zone: "outside", ...fields });

test("every custom-profile value rule names the path and the value written there", () => {
  const noDefault = [tier({ min: 20 })];
  const iconsWithoutDefault = [{ min: 28, icon: "mdi:fire-alert" }];
  const cases = [
    [{ unit: undefined }, "classification.unit", undefined],
    [{ unit: "hPa" }, "classification.unit", "hPa"],
    [{ comparison: ">>" }, "classification.comparison", ">>"],
    [{ bands: undefined }, "classification.bands", undefined],
    [{ bands: { comfort: { min: 25, max: 25 }, optimal: { min: 21, max: 23 } } }, "classification.bands.comfort.max", 25],
    [{ bands: { comfort: { min: 21, max: 23 }, optimal: { min: 19, max: 25 } } }, "classification.bands.optimal.min", 19],
    [{ bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 26 } } }, "classification.bands.optimal.max", 26],
    [{ scale: undefined }, "classification.scale", undefined],
    [{ scale: { min: 16, max: 28, step: 0 } }, "classification.scale.step", 0],
    [{ scale: { min: 16, max: 28, step: 2, headroom: -1 } }, "classification.scale.headroom", -1],
    [{ scale: { min: 16, max: 28, step: 2, one_sided: "yes" } }, "classification.scale.one_sided", "yes"],
    [{ scale: { min: 16, max: 28, step: 2, anchor_scale: "no" } }, "classification.scale.anchor_scale", "no"],
    // The two shapes of `scale`, and the ways of asking for neither.
    [{ scale: { step: 2 } }, "classification.scale.min", undefined],
    [{ scale: { min: 16, step: 2 } }, "classification.scale.max", undefined],
    [{ scale: { min: 16, max: 28, step: 2, anchor_scale: false } }, "classification.scale.min", 16],
    [{ scale: { max: 28, step: 2, anchor_scale: false } }, "classification.scale.max", 28],
    [{ scale: { step: 2, anchor_scale: false, one_sided: true }, icons: ICON_THRESHOLDS }, "classification.scale.one_sided", true],
    [{ tiers: [] }, "classification.tiers", []],
    [{ tiers: ["x"] }, "classification.tiers[0]", "x"],
    [{ tiers: [tier({ min: 20, default: "yes" })] }, "classification.tiers[0].default", "yes"],
    [{ tiers: [defaultTier({ min: 5 })] }, "classification.tiers[0].min", 5],
    [{ tiers: [tier({}), defaultTier()] }, "classification.tiers[0].min", undefined],
    [{ tiers: [tier({ min: 20, score: 2 }), tier({ min: 24 }), defaultTier()] }, "classification.tiers[1].min", 24],
    [{ tiers: [defaultTier({ score: 2 }), tier({ min: 20 })] }, "classification.tiers[0].default", true],
    [{ tiers: noDefault }, "classification.tiers", noDefault],
    [{ tiers: [tier({ min: 20, level: "  " }), defaultTier()] }, "classification.tiers[0].level", "  "],
    [{ tiers: [tier({ min: 20, color: "red" }), defaultTier()] }, "classification.tiers[0].color", "red"],
    [{ tiers: [tier({ min: 20, zone: "elsewhere" }), defaultTier()] }, "classification.tiers[0].zone", "elsewhere"],
    [{ tiers: [tier({ min: 20, score: "x" }), defaultTier()] }, "classification.tiers[0].score", "x"],
    [{ valid_range: {} }, "classification.valid_range", {}],
    [{ valid_range: { min: 0, max: 50, min_inclusive: "yes" } }, "classification.valid_range.min_inclusive", "yes"],
    [{ valid_range: { min: 50, max: 0 } }, "classification.valid_range.max", 0],
    [{ valid_range: 5 }, "classification.valid_range", 5],
    [{ icons: 5 }, "classification.icons", 5],
    [{ icons: { fire: 20, high: 26, normal: 19, low: 15 } }, "classification.icons.high", 26],
    [{ icons: [{ min: 28, icon: "" }, { default: true, icon: "mdi:snowflake" }] }, "classification.icons[0].icon", ""],
    [{ icons: iconsWithoutDefault }, "classification.icons", iconsWithoutDefault],
  ];
  for (const [overrides, path, value] of cases) refusedAt(validCustom(overrides), path, value);
});

// The threshold object is a temperature-only spelling; other metrics use the list form.
test("only a temperature profile may use the legacy threshold object", () => {
  const icons = { fire: 80, high: 60, normal: 40, low: 20 };
  refusedAt(
    validCustom({
      unit: "%",
      bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } },
      scale: { min: 30, max: 70, step: 5 },
      icons,
    }),
    "classification.icons",
    icons
  );
});

test("the rules run in a fixed order: the unit before the bands, the bands before the scale", () => {
  refusedAt(validCustom({ unit: "hPa", bands: undefined }), "classification.unit", "hPa");
  refusedAt(validCustom({ bands: undefined, scale: undefined }), "classification.bands", undefined);
});

test("a custom profile with a value it cannot use falls back to auto whole, and names that value", () => {
  const instead = core.fallbackOption("classification", "auto");
  assert.deepEqual(policyOf(validCustom({ comparison: ">>" })), {
    policy: AUTO,
    diagnostics: [invalid("classification.comparison", ">>", instead)],
  });
  assert.deepEqual(policyOf(fahrenheitCustom({ scale: { min: 60, max: 1e308, step: 2 } })), {
    policy: AUTO,
    diagnostics: [invalid("classification.scale.max", 1e308, instead)],
  });
});

test("a key a custom profile does not have refuses the configuration at any depth, whatever else is wrong", () => {
  const bands = { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } };
  const cases = [
    [{ bogus: 1 }, "classification.bogus is not an option of this card."],
    [{ bands: { ...bands, bogus: 1 } }, "classification.bands.bogus is not an option of this card."],
    [{ bands: { ...bands, comfort: { min: 19, max: 25, mid: 22 } } }, "classification.bands.comfort.mid is not an option of this card. Did you mean classification.bands.comfort.min?"],
    [{ scale: { min: 16, max: 28, step: 2, anchorScale: false } }, "classification.scale.anchorScale is not an option of this card. Did you mean classification.scale.anchor_scale?"],
    [{ tiers: [tier({ min: 20, bogus: 1 }), defaultTier()] }, "classification.tiers[0].bogus is not an option of this card."],
    [{ valid_range: { min: 0, maks: 50 } }, "classification.valid_range.maks is not an option of this card. Did you mean classification.valid_range.max?"],
    [{ icons: [{ min: 28, icn: "mdi:x" }, { default: true, icon: "mdi:y" }] }, "classification.icons[0].icn is not an option of this card. Did you mean classification.icons[0].icon?"],
    [{ icons: { fire: 30, hihg: 26, normal: 20, low: 14 } }, "classification.icons.hihg is not an option of this card. Did you mean classification.icons.high?"],
    // A value that is wrong as well does not hide the key: the keys are read first.
    [{ unit: "hPa", bands: { ...bands, bogus: 1 } }, "classification.bands.bogus is not an option of this card."],
  ];
  for (const [overrides, message] of cases) {
    assert.throws(() => policyOf(validCustom(overrides)), { name: "ConfigError", message: `Invalid configuration: ${message}` }, message);
  }
});

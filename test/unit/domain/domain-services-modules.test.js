"use strict";

// Direct unit tests for pure classification services beyond the profile data: profile/policy
// resolution, entity metadata, numeric classification, validity, display-unit projection,
// and profile-driven icons — the pure decisions that turn a number into a judgement, tested
// without a card, a DOM or a hass object.

const test = require("node:test");
const assert = require("node:assert/strict");

let registry;
let definitions;
let resolveModule;
let classify;
let entityAttributes;
let projection;
let icons;
let validity;

const AUTO = { source: "auto", profile: null, custom: null };
const ENTITY = { source: "entity", profile: null, custom: null };

test.before(async () => {
  registry = await import("../../../src/domain/classification/registry.js");
  definitions = await import("../../../src/domain/metrics/definitions.js");
  resolveModule = await import("../../../src/domain/classification/resolve.js");
  classify = await import("../../../src/domain/classification/classify.js");
  entityAttributes = await import("../../../src/domain/classification/entity-attributes.js");
  projection = await import("../../../src/domain/classification/projection.js");
  icons = await import("../../../src/domain/classification/icons.js");
  validity = await import("../../../src/domain/classification/validity.js");
});

const temperatureRegistry = () => registry.CLASSIFICATION_PROFILE_REGISTRY.temperature;
const tempUnit = (key) => definitions.METRIC_DEFINITIONS.temperature.unitProfiles[key];

// ------------------------------------------------- profile resolution ------

test("the default profile applies when no profile is requested", () => {
  const profile = resolveModule.resolveClassificationProfile(temperatureRegistry(), AUTO, "temperature");
  assert.equal(profile.id, "indoor");
});

test("a named profile is honoured, whatever the source", () => {
  for (const source of ["auto", "profile"]) {
    const profile = resolveModule.resolveClassificationProfile(
      temperatureRegistry(),
      { source, profile: "fridge", custom: null },
      "temperature"
    );
    assert.equal(profile.id, "fridge", `source ${source}`);
  }
});

test("a custom policy wins over the built-in profiles", () => {
  const custom = { id: "custom", metricKind: "temperature", comparison: ">=", tiers: [] };
  const profile = resolveModule.resolveClassificationProfile(
    temperatureRegistry(),
    { source: "custom", profile: null, custom },
    "temperature"
  );
  assert.equal(profile, custom);
});

test("an unknown profile name is a configuration error", () => {
  assert.throws(
    () => resolveModule.resolveClassificationProfile(temperatureRegistry(), { source: "profile", profile: "greenhouse", custom: null }, "temperature"),
    { message: 'Invalid configuration: classification profile "greenhouse" is not available for metric kind "temperature".' }
  );
});

test("a custom profile scoped to another metric kind is a configuration error", () => {
  const custom = { id: "custom", metricKind: "humidity" };
  assert.throws(
    () => resolveModule.resolveClassificationProfile(temperatureRegistry(), { source: "custom", profile: null, custom }, "temperature"),
    { message: 'Invalid configuration: custom classification unit belongs to "humidity", not detected metric kind "temperature".' }
  );
});

test("lenient resolution falls back to the default instead of throwing", () => {
  // Needed while probing an entity's own metric kind, before kind-based filtering runs.
  const unknown = resolveModule.resolveClassificationProfile(
    temperatureRegistry(),
    { source: "profile", profile: "greenhouse", custom: null },
    "temperature",
    { lenient: true }
  );
  assert.equal(unknown.id, "indoor");
  const foreign = resolveModule.resolveClassificationProfile(
    temperatureRegistry(),
    { source: "custom", profile: null, custom: { id: "custom", metricKind: "humidity" } },
    "temperature",
    { lenient: true }
  );
  assert.equal(foreign.id, "indoor");
});

test("an unregistered metric kind throws even when lenient", () => {
  assert.throws(
    () => resolveModule.resolveClassificationProfile(undefined, AUTO, "pressure", { lenient: true }),
    { message: 'No classification profiles registered for metric kind "pressure"' }
  );
});

// ------------------------------------------- value classification policy ---

test("forced entity mode uses the entity's own metadata, even partial", () => {
  const result = resolveModule.resolveValueClassification({
    policy: ENTITY,
    attributes: { value_level: "Server level", value_score: 7 },
    numericFallback: () => assert.fail("the numeric path must not run in entity mode"),
  });
  // No colour is decided here; what matters is that the entity's own value_score produced no
  // ramp position, so it can never be read as one.
  assert.deepEqual(result, {
    level: "Server level",
    levelKey: null,
    score: 7,
    zone: null,
    explicitColor: null,
    deviation: null,
    deviationSpan: null,
    invalid: false,
    source: "entity",
    profileId: null,
  });
});

test("forced entity mode degrades visibly rather than inventing a classification", () => {
  const result = resolveModule.resolveValueClassification({
    policy: ENTITY,
    attributes: null,
    numericFallback: () => assert.fail("the numeric path must not run in entity mode"),
  });
  assert.equal(result.explicitColor, null);
  assert.equal(result.level, "—");
  assert.equal(result.score, null);
  assert.equal(result.zone, null);
});

test("automatic mode prefers a COMPLETE entity classification", () => {
  const result = resolveModule.resolveValueClassification({
    policy: AUTO,
    attributes: { value_color: "#123456", value_level: "Server level" },
    numericFallback: () => assert.fail("a complete entity pair must win"),
  });
  assert.equal(result.source, "entity");
  assert.equal(result.explicitColor, "#123456");
  assert.equal(result.level, "Server level");
});

test("automatic mode ignores a partial entity classification", () => {
  for (const attributes of [
    { value_color: "#123456" },
    { value_level: "Only a level" },
    { value_score: 5, value_zone: "comfort" },
    {},
    null,
  ]) {
    const result = resolveModule.resolveValueClassification({
      policy: AUTO,
      attributes,
      numericFallback: () => ({ source: "builtin" }),
    });
    assert.equal(result.source, "builtin", JSON.stringify(attributes));
  }
});

test("the numeric path is lazy, so it cannot throw for a policy that never uses it", () => {
  let called = 0;
  resolveModule.resolveValueClassification({
    policy: ENTITY,
    attributes: { value_level: "x" },
    numericFallback: () => {
      called += 1;
      throw new Error("must not be evaluated");
    },
  });
  assert.equal(called, 0);
});

// ------------------------------------------------- entity attributes ------

test("value_color must pass hex validation to be used at all", () => {
  for (const color of ["#abc", "#aabbcc", "#aabbccdd", " #AABBCC "]) {
    const result = entityAttributes.readEntityClassification({ value_color: color, value_level: "L" });
    assert.equal(result.color, color.trim(), color);
  }
  for (const color of ["red", "rgb(1,2,3)", "#ab", "javascript:alert(1)", "#aabbcc;color:red", 5, null]) {
    const result = entityAttributes.readEntityClassification({ value_color: color, value_level: "L" }, { allowPartial: true });
    assert.equal(result.color, null, JSON.stringify(color));
  }
});

test("value_level is kept verbatim, never trimmed away or translated", () => {
  const result = entityAttributes.readEntityClassification({ value_level: "  Sehr heiß  " }, { allowPartial: true });
  assert.equal(result.level, "Sehr heiß", "surrounding whitespace is trimmed, the wording is untouched");
  assert.equal(
    entityAttributes.readEntityClassification({ value_level: "<b>bold</b>" }, { allowPartial: true }).level,
    "<b>bold</b>",
    "escaping is the renderer's job, not this layer's"
  );
  for (const level of ["", "   ", 5, null, undefined]) {
    assert.equal(
      entityAttributes.readEntityClassification({ value_level: level, value_score: 1 }, { allowPartial: true }).level,
      null,
      JSON.stringify(level)
    );
  }
});

test("value_score accepts finite numbers and rejects the sentinels Number() would turn into 0", () => {
  for (const [input, expected] of [[7, 7], ["7", 7], [0, 0], [-3.5, -3.5]]) {
    const result = entityAttributes.readEntityClassification({ value_score: input }, { allowPartial: true });
    assert.equal(result.score, expected, JSON.stringify(input));
  }
  // "", null and undefined are checked before Number(), which would turn all three into 0.
  for (const input of ["", null, undefined, "abc", {}, Infinity, NaN]) {
    const result = entityAttributes.readEntityClassification({ value_score: input, value_zone: "comfort" }, { allowPartial: true });
    assert.equal(result.score, null, JSON.stringify(String(input)));
  }
});

test("value_score: an empty array coerces to 0 — pinned as the current behaviour", () => {
  // Number([]) === 0, so an empty array passes the finite check as a score of 0. Pinned so a
  // future decision to reject it is a visible change.
  const result = entityAttributes.readEntityClassification({ value_score: [] }, { allowPartial: true });
  assert.equal(result.score, 0);
});

test("a complete pair is required without allowPartial, any field with it", () => {
  assert.equal(entityAttributes.readEntityClassification({ value_color: "#123456" }), null, "colour alone");
  assert.equal(entityAttributes.readEntityClassification({ value_level: "L" }), null, "level alone");
  assert.ok(entityAttributes.readEntityClassification({ value_color: "#123456", value_level: "L" }));

  assert.equal(entityAttributes.readEntityClassification({}, { allowPartial: true }), null, "nothing at all is still null");
  for (const attributes of [{ value_color: "#123456" }, { value_level: "L" }, { value_score: 0 }, { value_zone: "comfort" }]) {
    assert.ok(entityAttributes.readEntityClassification(attributes, { allowPartial: true }), JSON.stringify(attributes));
  }
});

test("a missing attribute object is null, not a crash", () => {
  for (const absent of [null, undefined]) {
    assert.equal(entityAttributes.readEntityClassification(absent), null);
    assert.equal(entityAttributes.readEntityClassification(absent, { allowPartial: true }), null);
  }
});

test("a prototype-polluting attribute set cannot smuggle values in", () => {
  const hostile = Object.assign(Object.create({ value_level: "inherited" }), { value_score: 1 });
  const result = entityAttributes.readEntityClassification(hostile, { allowPartial: true });
  assert.equal(result.level, "inherited", "inherited properties are read as plain property access does");
  assert.equal(result.score, 1);
  // Nothing about the attribute object can reach a colour that failed validation.
  const spoofed = entityAttributes.readEntityClassification({ value_color: "#ggg", value_level: "L" }, { allowPartial: true });
  assert.equal(spoofed.color, null);
});

// -------------------------------------------------- numeric classification --

test("classifyNumericValue() returns tokens, not translated text", () => {
  const profile = temperatureRegistry().profiles.indoor;
  const result = classify.classifyNumericValue(profile, 22);
  assert.equal(result.level, null, "a built-in tier has no literal level");
  assert.equal(result.levelKey, "level.optimal");
  assert.equal(result.zone, "optimal");
  assert.equal(result.score, 0, "optimal is zero steps from optimal");
  // No colour: what comes out is the distance the palette is later asked about, plus how far
  // this profile reaches.
  assert.equal(result.color, undefined);
  assert.equal(result.explicitColor, null);
  assert.equal(result.deviation, 0);
  assert.deepEqual(result.deviationSpan, { above: 5, below: 5 });
  assert.equal(result.invalid, false);
});

test("classifyNumericValue() keeps a custom profile's own level string", () => {
  const custom = {
    comparison: ">=",
    tiers: [
      { min: 24, score: 2, level: "Custom warm", color: "#cc4444", zone: "outside" },
      { min: -Infinity, score: 1, level: "Custom cold", color: "#4488cc", zone: "outside" },
    ],
  };
  assert.equal(classify.classifyNumericValue(custom, 25).level, "Custom warm");
  assert.equal(classify.classifyNumericValue(custom, 25).levelKey, undefined);
  assert.equal(classify.classifyNumericValue(custom, 10).level, "Custom cold");
});

test("classifyNumericValue() honours the comparison operator at a boundary", () => {
  const inclusive = { comparison: ">=", tiers: [{ min: 5, levelKey: "hi", color: "#111111", zone: "outside", score: 2 }, { min: -Infinity, levelKey: "lo", color: "#222222", zone: "outside", score: 1 }] };
  const exclusive = { ...inclusive, comparison: ">" };
  assert.equal(classify.classifyNumericValue(inclusive, 5).levelKey, "hi", '">=" includes the boundary');
  assert.equal(classify.classifyNumericValue(exclusive, 5).levelKey, "lo", '">" excludes it');
  assert.equal(classify.classifyNumericValue(exclusive, 5.0001).levelKey, "hi");
});

test("an invalid reading short-circuits to the invalid classification", () => {
  const profile = registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor;
  const result = classify.classifyNumericValue(profile, 150);
  assert.equal(result.zone, "invalid");
  assert.equal(result.levelKey, "level.invalidReading");
  assert.equal(result.score, null, "an unusable reading has no distance from optimal to report");
});

test("a reading no tier covers is invalid too, rather than a crash", () => {
  // selectTier() is partial: a `>` profile's open-ended tier sits at -Infinity, and nothing
  // is strictly above -Infinity, so no tier matches. The classifier must produce the invalid
  // answer rather than read `.color` off undefined. This profile declares no invalidWhen, so
  // only the missing tier can produce that answer.
  const exclusive = {
    comparison: ">",
    tiers: [
      { min: 5, levelKey: "hi", color: "#111111", zone: "outside", score: 2 },
      { min: -Infinity, levelKey: "lo", color: "#222222", zone: "outside", score: 1 },
    ],
  };
  assert.equal(classify.selectTier(exclusive, -Infinity), undefined, "the case is what it says it is");
  const result = classify.classifyNumericValue(exclusive, -Infinity);
  assert.equal(result.invalid, true);
  assert.equal(result.zone, "invalid");
  assert.equal(result.levelKey, "level.invalidReading");
  assert.equal(result.score, null);
  assert.equal(result.deviation, null, "there is no distance from optimal for a value off the ramp");

  // With an invalidWhen that never fires the answer is the same, so the tier check does the
  // work rather than riding on the validity check.
  const guarded = { ...exclusive, invalidWhen: () => false };
  assert.equal(classify.classifyNumericValue(guarded, -Infinity).invalid, true);

  // No finite reading is touched: every one is strictly above -Infinity.
  for (const value of [-1e308, -1, 0, 5, 5.0001, 1e308]) {
    assert.equal(classify.classifyNumericValue(exclusive, value).invalid, false, String(value));
  }
});

test("an inclusive profile has a tier for -Infinity and is classified by it", () => {
  // `>=` admits -Infinity into the open-ended tier, so the classifier finds one.
  const inclusive = {
    comparison: ">=",
    tiers: [
      { min: 5, levelKey: "hi", color: "#111111", zone: "outside", score: 2 },
      { min: -Infinity, levelKey: "lo", color: "#222222", zone: "outside", score: 1 },
    ],
  };
  const result = classify.classifyNumericValue(inclusive, -Infinity);
  assert.equal(result.invalid, false);
  assert.equal(result.levelKey, "lo");
});

test("a profile without an explicit invalid classification uses the neutral fallback", () => {
  const profile = {
    comparison: ">=",
    invalidWhen: (v) => v < 0,
    tiers: [{ min: -Infinity, levelKey: "x", color: "#111111", zone: "outside", score: 1 }],
  };
  const result = classify.classifyNumericValue(profile, -1);
  assert.equal(result.levelKey, "level.invalidReading");
  assert.equal(result.explicitColor, null, "the palette's invalid colour, decided later");
  assert.equal(result.zone, "invalid");
  assert.equal(result.score, null);
  assert.equal(result.invalid, true);
  assert.equal(result.deviation, null, "off the scale, not at one end of it");
  assert.equal(result.deviationSpan, null);
});

// A profile may carry a score on its invalid classification; reading it as a distance would
// paint an impossible reading in a ramp colour.
test("an invalid reading takes no distance, whatever score it carries", () => {
  const profile = {
    comparison: ">=",
    invalidWhen: (v) => v < 0,
    invalidClassification: { score: 1, levelKey: "level.invalidReading", zone: "invalid" },
    tiers: [{ min: -Infinity, levelKey: "x", zone: "outside", score: 0 }],
  };
  const result = classify.classifyNumericValue(profile, -1);
  assert.equal(result.score, 1, "the score itself is untouched, it is simply not a distance");
  assert.equal(result.deviation, null);
  assert.equal(result.invalid, true);
});

test("invalid and ordinary tier metadata preserve literal values and apply only documented fallbacks", () => {
  const invalidProfile = {
    comparison: ">=",
    invalidWhen: (value) => value < 0,
    invalidClassification: { score: 4, level: "Sensor fault", levelKey: "fault" },
    tiers: [{ min: -Infinity, levelKey: "ordinary", score: 2 }],
  };
  const invalid = classify.classifyNumericValue(invalidProfile, -1);
  assert.equal(invalid.level, "Sensor fault");
  assert.equal(invalid.levelKey, "fault");
  assert.equal(invalid.score, 4);
  assert.equal(invalid.zone, "invalid", "only an omitted invalid zone takes the documented fallback");

  const ordinary = classify.classifyNumericValue(invalidProfile, 1);
  assert.equal(ordinary.score, 2, "a non-zero palette distance must survive classification");
  assert.equal(ordinary.deviation, 2);
  assert.equal(ordinary.level, null);
});

// -------------------------------------------------------------- validity --

test("isPhysicallyValid() only rejects what a profile declares impossible", () => {
  const humidity = registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor;
  assert.equal(validity.isPhysicallyValid(humidity, 50), true);
  assert.equal(validity.isPhysicallyValid(humidity, -1), false);
  assert.equal(validity.isPhysicallyValid(humidity, 101), false);

  const co2 = registry.CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor;
  assert.equal(validity.isPhysicallyValid(co2, -1), false, "a negative concentration is not data");
  assert.equal(validity.isPhysicallyValid(co2, 0), true, "zero is possible; whether a sensor is stuck is a different question");
  assert.equal(validity.isPhysicallyValid(co2, 400), true);

  const temperature = temperatureRegistry().profiles.indoor;
  assert.equal(validity.isPhysicallyValid(temperature, -300), false, "nothing is colder than absolute zero");
  assert.equal(validity.isPhysicallyValid(temperature, -273.15), true, "the limit itself is a reading");
});

test("physicalRange() states one window and answers with both fields the card reads", () => {
  const floorOnly = validity.physicalRange({ min: 0 });
  assert.deepEqual(floorOnly.validRange, { min: 0, max: null, minInclusive: true, maxInclusive: true });
  assert.equal(floorOnly.invalidWhen(-0.001), true);
  assert.equal(floorOnly.invalidWhen(0), false);
  assert.equal(floorOnly.invalidWhen(1e308), false, "no upper bound means no upper limit");

  const ceilingOnly = validity.physicalRange({ max: 100 });
  assert.deepEqual(ceilingOnly.validRange, { min: null, max: 100, minInclusive: true, maxInclusive: true });
  assert.equal(ceilingOnly.invalidWhen(-1e308), false, "no lower bound means no lower limit");
  assert.equal(ceilingOnly.invalidWhen(100), false);
  assert.equal(ceilingOnly.invalidWhen(100.001), true);
});

test("isPhysicallyValid() treats a missing profile as valid", () => {
  assert.equal(validity.isPhysicallyValid(null, 42), true);
  assert.equal(validity.isPhysicallyValid(undefined, 42), true);
});

// ------------------------------------------------------------ projection --

test("projecting into the canonical unit returns the profile untouched", () => {
  const canonical = temperatureRegistry().profiles.indoor;
  const projected = projection.projectProfileToDisplayUnit(
    canonical,
    definitions.METRIC_DEFINITIONS.temperature,
    tempUnit("celsius"),
    "temperature"
  );
  assert.equal(projected, canonical, "same object, no copy");
});

test("an omitted unit profile falls back to canonical", () => {
  const canonical = temperatureRegistry().profiles.indoor;
  assert.equal(
    projection.projectProfileToDisplayUnit(canonical, definitions.METRIC_DEFINITIONS.temperature, null, "temperature"),
    canonical
  );
});

test("projecting to Fahrenheit rounds every boundary to a whole number", () => {
  const canonical = temperatureRegistry().profiles.indoor;
  const projected = projection.projectProfileToDisplayUnit(
    canonical,
    definitions.METRIC_DEFINITIONS.temperature,
    tempUnit("fahrenheit"),
    "temperature"
  );
  assert.deepEqual(projected.comfort, { min: 68, max: 75 });
  assert.deepEqual(projected.optimal, { min: 70, max: 73 });
  assert.deepEqual(projected.scale, { min: 66, max: 77 });
  for (const tier of projected.tiers) {
    if (Number.isFinite(tier.min)) assert.equal(Number.isInteger(tier.min), true, `tier ${tier.min}`);
  }
  assert.equal(projected.tiers[projected.tiers.length - 1].min, -Infinity);
  assert.deepEqual(projected.iconTiers.map((t) => t.min), [82, 79, 68, 64, -Infinity]);
});

test("projecting to Fahrenheit converts the step as a delta, not an absolute", () => {
  const projected = projection.projectProfileToDisplayUnit(
    temperatureRegistry().profiles.indoor,
    definitions.METRIC_DEFINITIONS.temperature,
    tempUnit("fahrenheit"),
    "temperature"
  );
  // 1 °C step is 1.8 °F, not 33.8 °F.
  assert.ok(Math.abs(projected.step - 1.8) < 1e-9, `got ${projected.step}`);
});

test("projecting to Kelvin shifts by the offset and leaves deltas alone", () => {
  const projected = projection.projectProfileToDisplayUnit(
    temperatureRegistry().profiles.indoor,
    definitions.METRIC_DEFINITIONS.temperature,
    tempUnit("kelvin"),
    "temperature"
  );
  assert.ok(Math.abs(projected.comfort.min - 293.15) < 1e-9);
  assert.ok(Math.abs(projected.comfort.max - 297.15) < 1e-9);
  assert.equal(projected.step, 1, "Kelvin and Celsius share a step size");
});

test("projection re-derives a custom valid_range in the display unit", () => {
  const canonical = {
    id: "custom",
    metricKind: "temperature",
    comparison: ">=",
    tiers: [{ min: 24, score: 2, level: "A", color: "#cc4444", zone: "outside" }, { min: -Infinity, score: 1, level: "B", color: "#4488cc", zone: "outside" }],
    comfort: { min: 19, max: 25 },
    optimal: { min: 21, max: 23 },
    scale: { min: 16, max: 28 },
    step: 2,
    validRange: { min: 0, max: 40, minInclusive: true, maxInclusive: true },
  };
  const projected = projection.projectProfileToDisplayUnit(
    canonical,
    definitions.METRIC_DEFINITIONS.temperature,
    tempUnit("fahrenheit"),
    "temperature"
  );
  assert.deepEqual(projected.validRange, { min: 32, max: 104, minInclusive: true, maxInclusive: true });
  assert.equal(projected.invalidWhen(31), true, "the predicate now speaks Fahrenheit");
  assert.equal(projected.invalidWhen(32), false);
  assert.equal(projected.invalidWhen(105), true);
});

test("a profile whose gaps collapse under rounding is rejected with a usable message", () => {
  const canonical = {
    id: "custom",
    metricKind: "temperature",
    comparison: ">=",
    // 22.0 and 22.3 °C both round to 72 °F.
    tiers: [
      { min: 24, score: 3, level: "A", color: "#cc4444", zone: "outside" },
      { min: 22.3, score: 2, level: "B", color: "#ccaa44", zone: "comfort" },
      { min: 22.0, score: 1, level: "C", color: "#44cc66", zone: "optimal" },
      { min: -Infinity, score: 0, level: "D", color: "#4488cc", zone: "outside" },
    ],
    comfort: { min: 19, max: 25 },
    optimal: { min: 21, max: 23 },
    scale: { min: 16, max: 28 },
    step: 2,
  };
  assert.throws(
    () => projection.projectProfileToDisplayUnit(canonical, definitions.METRIC_DEFINITIONS.temperature, tempUnit("fahrenheit"), "temperature"),
    /becomes degenerate when rounded to °F \(tier thresholds collapse near 72°F\)/
  );
});

test("the built-in profiles survive projection into every temperature unit", () => {
  for (const id of ["indoor", "outdoor", "fridge"]) {
    for (const unit of ["celsius", "fahrenheit", "kelvin"]) {
      assert.doesNotThrow(
        () =>
          projection.projectProfileToDisplayUnit(
            temperatureRegistry().profiles[id],
            definitions.METRIC_DEFINITIONS.temperature,
            tempUnit(unit),
            "temperature"
          ),
        `${id} -> ${unit}`
      );
    }
  }
});

// ----------------------------------------------------------------- icons --

test("temperature icons come from the same descending tiers every other measurement uses", () => {
  const indoor = temperatureRegistry().profiles.indoor;
  assert.equal(icons.profileIconForValue(30, indoor), "mdi:fire-alert");
  assert.equal(icons.profileIconForValue(27, indoor), "mdi:thermometer-high");
  assert.equal(icons.profileIconForValue(22, indoor), "mdi:thermometer");
  assert.equal(icons.profileIconForValue(19, indoor), "mdi:thermometer-low");
  assert.equal(icons.profileIconForValue(5, indoor), "mdi:snowflake");
  // Boundaries follow the profile's own comparison operator, which is ">=" here.
  assert.equal(icons.profileIconForValue(28, indoor), "mdi:fire-alert");
  assert.equal(icons.profileIconForValue(26, indoor), "mdi:thermometer-high");
});

test("the same reading gets a different icon per temperature profile", () => {
  const { indoor, outdoor, fridge } = temperatureRegistry().profiles;
  assert.equal(icons.profileIconForValue(12, indoor), "mdi:snowflake");
  assert.equal(icons.profileIconForValue(12, outdoor), "mdi:thermometer-low");
  assert.equal(icons.profileIconForValue(12, fridge), "mdi:fire-alert");
});

// The icon list is read with the profile's own operator, like the classification tiers, so
// the two never disagree about the value on a threshold.
test("icon boundaries follow the profile's comparison operator", () => {
  const inclusive = temperatureRegistry().profiles.indoor;
  const exclusive = { ...inclusive, comparison: ">" };
  assert.equal(icons.profileIconForValue(28, inclusive), "mdi:fire-alert");
  assert.equal(icons.profileIconForValue(28, exclusive), "mdi:thermometer-high");
});

test("non-temperature icons come from the descending icon tiers", () => {
  const humidity = registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor;
  assert.equal(icons.profileIconForValue(80, humidity), "mdi:water-percent-alert");
  assert.equal(icons.profileIconForValue(65, humidity), "mdi:water-plus");
  assert.equal(icons.profileIconForValue(50, humidity), "mdi:water-percent");
  assert.equal(icons.profileIconForValue(20, humidity), "mdi:water-minus");
});

// The measurement is not an argument, so "no icon tiers" means the same for every metric.
test("profileIconForValue() returns null when a profile declares no icon tiers", () => {
  assert.equal(icons.profileIconForValue.length, 2, "value and profile, nothing about the metric");
  for (const withoutTiers of [{ comparison: ">=", tiers: [] }, { comparison: ">=", tiers: [], iconTiers: null }]) {
    assert.equal(icons.profileIconForValue(50, withoutTiers), null);
  }
});

test("a built-in profile's icon threshold belongs to the icon it names", () => {
  // The same rule the tiers follow: an icon and a tier cannot disagree about the value on a
  // threshold, because both go through the profile's own operator.
  const pm25 = registry.CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor;
  assert.equal(pm25.comparison, ">=");
  assert.equal(icons.profileIconForValue(4.99, pm25), "mdi:molecule");
  assert.equal(icons.profileIconForValue(5, pm25), "mdi:weather-hazy", "exactly 5 passes an inclusive boundary");
});

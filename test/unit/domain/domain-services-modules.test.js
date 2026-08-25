"use strict";

// Direct unit tests for pure domain services:
// src/domain/classification/* (beyond the profile data) and src/domain/scale/*.
//
// These are the decisions that turn a number into a judgement — which profile
// applies, what the number means in the unit the user sees, whether it is a
// reading at all, and where it sits on the axis. All of it is pure, so it is
// tested without a card, a DOM or a hass object.

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
let scaleConfig;
let dynamicScaleModule;
let geometry;

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
  scaleConfig = await import("../../../src/domain/scale/scale-config.js");
  dynamicScaleModule = await import("../../../src/domain/scale/dynamic-scale.js");
  geometry = await import("../../../src/domain/scale/geometry.js");
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
  // Needed while probing an entity's own metric kind, before kind-based filtering
  // has decided whether the card-wide profile is even relevant.
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
  // No colour is decided here. The integration supplied none, and the resolver turns
  // that into the neutral colour later — what matters at this seam is that the entity's
  // own value_score produced NO ramp position, so it can never be read as one.
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
  // "", null and undefined are checked explicitly BEFORE Number(), which would
  // otherwise turn all three into a plausible-looking 0.
  for (const input of ["", null, undefined, "abc", {}, Infinity, NaN]) {
    const result = entityAttributes.readEntityClassification({ value_score: input, value_zone: "comfort" }, { allowPartial: true });
    assert.equal(result.score, null, JSON.stringify(String(input)));
  }
});

test("value_score: an empty array coerces to 0 — pinned as the current behaviour", () => {
  // Number([]) === 0, so an empty array passes the finite check and is accepted
  // as a score of 0. This is pre-existing behaviour that the source split
  // deliberately preserves rather than quietly tightening; it is recorded here
  // so a future decision to reject it is a visible, intentional change.
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
  // The important part: nothing about the attribute object can reach a colour
  // that failed validation.
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
  // No colour, and no colour to be had here: what comes out is the DISTANCE the palette
  // is later asked about, plus how far this profile reaches.
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

// The trap this guards: a profile may carry a score on its invalid classification, and
// reading that score as a distance would paint an impossible reading in a ramp colour.
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

// -------------------------------------------------------------- validity --

test("isPhysicallyValid() only rejects what a profile declares impossible", () => {
  const humidity = registry.CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor;
  assert.equal(validity.isPhysicallyValid(humidity, 50), true);
  assert.equal(validity.isPhysicallyValid(humidity, -1), false);
  assert.equal(validity.isPhysicallyValid(humidity, 101), false);

  const co2 = registry.CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor;
  assert.equal(validity.isPhysicallyValid(co2, 0), false, "a stuck 0 ppm reading is not data");
  assert.equal(validity.isPhysicallyValid(co2, 400), true);

  const temperature = temperatureRegistry().profiles.indoor;
  assert.equal(validity.isPhysicallyValid(temperature, -300), true, "temperature declares no limit");
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

// The icon list is read with the profile's own comparison operator, exactly like the
// classification tiers — so a profile whose boundaries are exclusive has exclusive icon
// boundaries too, and the two can never disagree about the value ON a threshold.
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

// The measurement is not an argument, so "no icon tiers" cannot mean one thing for
// temperature and another for the rest: the function has no way to tell them apart.
test("profileIconForValue() returns null when a profile declares no icon tiers", () => {
  assert.equal(icons.profileIconForValue.length, 2, "value and profile, nothing about the metric");
  for (const withoutTiers of [{ comparison: ">=", tiers: [] }, { comparison: ">=", tiers: [], iconTiers: null }]) {
    assert.equal(icons.profileIconForValue(50, withoutTiers), null);
  }
});

test("icon tiers honour the profile's comparison operator", () => {
  const pm25 = registry.CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor;
  assert.equal(pm25.comparison, ">");
  assert.equal(icons.profileIconForValue(5, pm25), "mdi:molecule", "exactly 5 does not pass an exclusive boundary");
  assert.equal(icons.profileIconForValue(5.1, pm25), "mdi:weather-hazy");
});

// ----------------------------------------------------------- scale config --

test("scaleConfigFor() makes the two defaults explicit", () => {
  const indoor = scaleConfig.scaleConfigFor(temperatureRegistry().profiles.indoor);
  assert.deepEqual(indoor.comfort, { min: 20, max: 24 });
  assert.equal(indoor.step, 1);
  assert.equal(indoor.oneSided, false, "an absent oneSided becomes false");
  assert.equal(indoor.anchorScale, true, "an absent anchorScale becomes true");
  assert.equal(indoor.headroom, undefined);

  const outdoor = scaleConfig.scaleConfigFor(temperatureRegistry().profiles.outdoor);
  assert.equal(outdoor.anchorScale, false, "outdoor opts out of the anchored axis");
  assert.equal(outdoor.scale, null, "and therefore declares no reference range to anchor to");
  assert.equal(
    scaleConfig.scaleConfigFor({ ...temperatureRegistry().profiles.indoor, scale: undefined }).scale,
    null,
    "an absent range normalizes to the same null the config layer produces"
  );

  const co2 = scaleConfig.scaleConfigFor(registry.CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor);
  assert.equal(co2.oneSided, true);
  assert.equal(co2.headroom, 100);
});

// ---------------------------------------------------------- dynamic scale --

const INDOOR_C = { comfort: { min: 20, max: 24 }, optimal: { min: 21, max: 23 }, scale: { min: 19, max: 25 }, step: 1, oneSided: false, headroom: undefined, anchorScale: true };

test("an anchored axis never shrinks below the reference scale", () => {
  const result = dynamicScaleModule.dynamicScale(21, 22, INDOOR_C, undefined);
  assert.deepEqual(result, { min: 19, max: 25, step: 1 });
});

test("an anchored axis grows outwards with a one-step buffer", () => {
  assert.deepEqual(dynamicScaleModule.dynamicScale(15, 30, INDOOR_C, undefined), { min: 14, max: 31, step: 1 });
  assert.deepEqual(dynamicScaleModule.dynamicScale(18.5, 25.5, INDOOR_C, undefined), { min: 17, max: 27, step: 1 });
});

test("an unanchored axis follows the data only", () => {
  const outdoor = { ...INDOOR_C, scale: null, anchorScale: false };
  assert.deepEqual(dynamicScaleModule.dynamicScale(-3, 9, outdoor, undefined), { min: -4, max: 10, step: 1 });
  assert.deepEqual(
    dynamicScaleModule.dynamicScale(20, 20, outdoor, undefined),
    { min: 19, max: 21, step: 1 },
    "a single reading gives the narrow axis around it that following the data means"
  );
});

// The reference range is the only thing an unanchored profile does not have, and both
// remaining readers of it — the anchoring clamp and the non-finite fallback — have to
// cope. Every call site feeds finite values (see buildScaleAxis()), so this covers the
// defensive path rather than a reachable one: it must still produce an axis that can be
// divided by, because every marker position does exactly that.
test("an unanchored axis stays finite and ordered even without usable readings", () => {
  const unanchored = { ...INDOOR_C, scale: null, anchorScale: false };
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x"]) {
    const result = dynamicScaleModule.dynamicScale(bad, bad, unanchored, undefined);
    assert.ok(Number.isFinite(result.min) && Number.isFinite(result.max), JSON.stringify(String(bad)));
    assert.ok(result.min < result.max, JSON.stringify(String(bad)));
  }
});

test("a one-sided axis keeps its lower bound rooted", () => {
  const co2 = { comfort: { min: 0, max: 1000 }, optimal: { min: 0, max: 800 }, scale: { min: 0, max: 1200 }, step: 200, oneSided: true, headroom: 100, anchorScale: true };
  assert.deepEqual(dynamicScaleModule.dynamicScale(400, 1500, co2, undefined), { min: 0, max: 1600, step: 200 });
  assert.deepEqual(dynamicScaleModule.dynamicScale(-500, 500, co2, undefined), { min: 0, max: 1200, step: 200 }, "a negative low cannot pull the axis below zero");
});

test("an explicit headroom replaces the one-step buffer", () => {
  const wide = { ...INDOOR_C, headroom: 5 };
  assert.deepEqual(dynamicScaleModule.dynamicScale(20, 26, wide, undefined), { min: 15, max: 31, step: 1 });
});

test("non-finite bounds fall back to the reference scale", () => {
  for (const bad of [NaN, Infinity, -Infinity, null, undefined, "x"]) {
    const result = dynamicScaleModule.dynamicScale(bad, bad, INDOOR_C, undefined);
    assert.ok(Number.isFinite(result.min) && Number.isFinite(result.max), JSON.stringify(String(bad)));
    assert.ok(result.min < result.max, JSON.stringify(String(bad)));
  }
});

test("a degenerate axis is widened by one step rather than dividing by zero", () => {
  const degenerate = { comfort: { min: 5, max: 6 }, optimal: { min: 5, max: 6 }, scale: { min: 5, max: 5 }, step: 1, oneSided: true, headroom: 0, anchorScale: false };
  const result = dynamicScaleModule.dynamicScale(5, 5, degenerate, undefined);
  assert.ok(result.max > result.min, `got ${JSON.stringify(result)}`);
});

test("Fahrenheit's dynamic steps widen with the displayed span", () => {
  const steps = [
    { maxSpan: 20, step: 2 },
    { maxSpan: 40, step: 5 },
    { maxSpan: Infinity, step: 10 },
  ];
  const base = { min: 66, max: 77 };
  for (const [low, high, expected] of [[68, 75, 2], [50, 80, 5], [-10, 110, 10]]) {
    const step = dynamicScaleModule.resolveDynamicStep(2, steps, low, high, base.min, base.max, true);
    assert.equal(step, expected, `span ${low}..${high}`);
  }
});

test("resolveDynamicStep() keeps the fixed step when a profile declares none", () => {
  assert.equal(dynamicScaleModule.resolveDynamicStep(5, undefined, 0, 100, 35, 65, true), 5);
  assert.equal(dynamicScaleModule.resolveDynamicStep(200, null, 0, 5000, 0, 1200, true), 200);
});

test("resolveDynamicStep() measures the anchored span, not just the data span", () => {
  const steps = [{ maxSpan: 20, step: 2 }, { maxSpan: Infinity, step: 10 }];
  // Data span is 4, but anchoring widens it to 66..90 = 24.
  assert.equal(dynamicScaleModule.resolveDynamicStep(2, steps, 86, 90, 66, 77, true), 10);
  assert.equal(dynamicScaleModule.resolveDynamicStep(2, steps, 86, 90, 66, 77, false), 2, "unanchored sees only the data");
});

// -------------------------------------------------------------- geometry --

test("rangePosition() returns a left edge and a width in percent", () => {
  const band = geometry.rangePosition(20, 24, 19, 25);
  // Asserted with a tolerance: the width is computed as right-minus-left, which
  // is not bit-identical to (4/6)*100.
  assert.ok(Math.abs(band.left - (1 / 6) * 100) < 1e-9, `left ${band.left}`);
  assert.ok(Math.abs(band.width - (4 / 6) * 100) < 1e-9, `width ${band.width}`);
  assert.deepEqual(geometry.rangePosition(19, 25, 19, 25), { left: 0, width: 100 });
});

test("rangePosition() tolerates an inverted pair and clamps outside values", () => {
  const inverted = geometry.rangePosition(24, 20, 19, 25);
  const normal = geometry.rangePosition(20, 24, 19, 25);
  assert.deepEqual(inverted, normal, "the band is the same either way round");
  assert.deepEqual(geometry.rangePosition(-100, 100, 0, 10), { left: 0, width: 100 }, "clamped, never negative or past 100");
});

test("scaleGeometry() reports band positions and their centres", () => {
  const result = geometry.scaleGeometry(20, 24, 21, 23, 19, 25);
  assert.equal(result.scaleMin, 19);
  assert.equal(result.scaleMax, 25);
  assert.equal(result.optimalMin, 21);
  assert.equal(result.optimalMax, 23);
  assert.ok(Math.abs(result.comfortCenter - 50) < 1e-9);
  assert.ok(Math.abs(result.optimalCenter - 50) < 1e-9);
  assert.equal(result.comfortVisible, true);
  assert.equal(result.optimalVisible, true);
});

test("a band wholly outside the axis is reported as not visible", () => {
  // A winter outdoor axis at -8..-2 cannot show a 14..26 comfort band.
  const result = geometry.scaleGeometry(14, 26, 18, 22, -8, -2);
  assert.equal(result.comfortVisible, false);
  assert.equal(result.optimalVisible, false);
  assert.equal(result.scaleMin, -8, "the configured bounds stay in the model regardless");
});

test("a band touching the axis edge is still not visible", () => {
  assert.equal(geometry.scaleGeometry(25, 30, 26, 28, 19, 25).comfortVisible, false, "starts exactly at scaleMax");
  assert.equal(geometry.scaleGeometry(10, 19, 12, 15, 19, 25).comfortVisible, false, "ends exactly at scaleMin");
  assert.equal(geometry.scaleGeometry(10, 19.1, 12, 15, 19, 25).comfortVisible, true, "the slightest overlap counts");
});

test("markerPositions() maps every named marker onto the axis", () => {
  const result = geometry.markerPositions({ avg: 22, coolest: 19, warmest: 25 }, 19, 25);
  assert.equal(result.coolest, 0);
  assert.equal(result.warmest, 100);
  assert.equal(result.avg, 50);
});

test("markerPositions() clamps markers outside the axis and handles no markers", () => {
  const result = geometry.markerPositions({ below: -100, above: 1000 }, 0, 10);
  assert.equal(result.below, 0);
  assert.equal(result.above, 100);
  assert.deepEqual(geometry.markerPositions({}, 0, 10), {});
  assert.deepEqual(geometry.markerPositions(null, 0, 10), {});
  assert.deepEqual(geometry.markerPositions(undefined, 0, 10), {});
});

"use strict";

// CUSTOM CLASSIFICATION PROFILES: authoritative YAML profiles, their scale and
// unit projection, validation, and interaction with resolved metric context.
// This file drives those user-authored profiles through the assembled card; the neighbouring
// classification-profiles.test.js owns shipped/profile-source precedence instead.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { HUMIDITY, TEMPERATURE_C, TEMPERATURE_F } = require("../../fixtures/attributes.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Direct imports make the owning module of each classification contract explicit.
let access;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  access = await import("../../../src/domain/metrics/access.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function temperatureHass(value = 25.5, attributes = {}) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", value, {
      device_class: "temperature",
      unit_of_measurement: "°C",
      ...attributes,
    }),
  });
}

function createTemperatureCard(classification, value = 25.5, attributes = {}) {
  const config = { entity: "sensor.avg" };
  if (classification !== undefined) config.classification = classification;
  return env.createCard(config, temperatureHass(value, attributes));
}

const customProfile = {
  source: "custom",
  unit: "°C",
  comparison: ">=",
  bands: {
    comfort: { min: 10, max: 30 },
    optimal: { min: 18, max: 22 },
  },
  scale: { min: 0, max: 40, step: 2 },
  tiers: [
    { min: 30, score: 3, level: "Custom hot", color: "#AA0000", zone: "outside" },
    { min: 18, score: 2, level: "Custom ideal", color: "#00AA00", zone: "optimal" },
    { default: true, score: 1, level: "Custom cold", color: "#0000AA", zone: "outside" },
  ],
};

test("custom profile is authoritative and drives classification plus scale as one object", () => {
  const card = createTemperatureCard(customProfile, 25, {
    value_color: "#123456",
    value_level: "Entity level",
  });
  const data = card._computeViewModel();
  assert.equal(data.tone.color, "#00AA00");
  assert.equal(data.tone.label, "Custom ideal");
  assert.equal(data.tone.score, 2);
  assert.equal(data.tone.zone, "optimal");
  assert.equal(data.tone.source, "custom");
  assert.deepEqual({ min: data.comfort.min, max: data.comfort.max }, { min: 10, max: 30 });
  assert.deepEqual({ min: data.scale.optimalMin, max: data.scale.optimalMax }, { min: 18, max: 22 });
  assert.equal(data.scale.scaleMin, 0);
  assert.equal(data.scale.scaleMax, 40);
  env.cleanup(card);
});

// The card invites users to write their own profiles, so anything a built-in profile can
// say must be sayable in YAML too. `anchor_scale` was the one exception: outdoor.js lets
// the rendered axis follow the season's actual readings rather than a declared range,
// and no configuration key reached that field.
//
// Asserted as a COMPARISON against the built-in profile rather than against copied
// numbers: the claim is "a custom profile can now be outdoor", and a test that restates
// outdoor's arithmetic would keep passing if the two ever drifted apart.
const outdoorAsCustomProfile = {
  source: "custom",
  unit: "°C",
  comparison: ">=",
  bands: {
    comfort: { min: 14, max: 26 },
    optimal: { min: 18, max: 22 },
  },
  // No min/max: this is the whole point of anchor_scale, and declaring both would be a
  // contradiction the normalizer refuses.
  scale: { step: 1, anchor_scale: false },
  tiers: [
    { min: 35, score: 11, level: "Very hot", color: "#B85F67", zone: "outside" },
    { min: 30, score: 10, level: "Hot", color: "#C67277", zone: "outside" },
    { min: 28, score: 9, level: "Very warm", color: "#C98A67", zone: "outside" },
    { min: 26, score: 8, level: "Warm", color: "#C0A752", zone: "outside" },
    { min: 22, score: 7, level: "Slightly warm", color: "#9DA85A", zone: "comfort" },
    { min: 18, score: 6, level: "Optimal", color: "#79A86C", zone: "optimal" },
    { min: 14, score: 5, level: "Slightly cool", color: "#69A78B", zone: "comfort" },
    { min: 10, score: 4, level: "Fresh", color: "#67A7AE", zone: "outside" },
    { min: 5, score: 3, level: "Cool", color: "#76A0C0", zone: "outside" },
    { min: 0, score: 2, level: "Cold", color: "#8192C8", zone: "outside" },
    { default: true, score: 1, level: "Very cold", color: "#8A88C9", zone: "outside" },
  ],
  icons: { fire: 35, high: 30, normal: 14, low: 5 },
};

test("a custom profile that declares no reference range behaves exactly like outdoor", () => {
  const custom = createTemperatureCard(outdoorAsCustomProfile);
  const builtIn = createTemperatureCard("outdoor");
  const celsius = access.getUnitProfile("temperature", "celsius");

  const customScale = internals.scaleConfigFor(custom, "temperature", celsius);
  const builtInScale = internals.scaleConfigFor(builtIn, "temperature", celsius);
  assert.equal(customScale.anchorScale, false, "the YAML switch has to survive normalization and projection");
  assert.equal(customScale.anchorScale, builtInScale.anchorScale);
  assert.equal(customScale.scale, null, "and so does the absence of a reference range");
  assert.equal(builtInScale.scale, null);

  // Winter, summer, and a span that straddles the declared reference range: an anchored
  // axis would answer differently to all three.
  for (const [low, high] of [[2, 8], [-12, -4], [28, 36], [12, 28]]) {
    assert.deepEqual(
      normalize(internals.dynamicScale(custom, low, high, "temperature", celsius)),
      normalize(internals.dynamicScale(builtIn, low, high, "temperature", celsius)),
      `a custom outdoor profile must render the same axis as the built-in one for ${low}..${high}`
    );
  }
  env.cleanup(custom);
  env.cleanup(builtIn);
});

test("declaring a range instead keeps the anchored axis a profile has by default", () => {
  const anchored = createTemperatureCard({
    ...outdoorAsCustomProfile,
    scale: { min: 10, max: 30, step: 1 },
  });
  const celsius = access.getUnitProfile("temperature", "celsius");
  assert.equal(internals.scaleConfigFor(anchored, "temperature", celsius).anchorScale, true);
  assert.deepEqual(
    normalize(internals.dynamicScale(anchored, 2, 8, "temperature", celsius)),
    { min: 1, max: 30, step: 1 },
    "the declared reference range still pins the top of the axis when it is not opted out of"
  );
  env.cleanup(anchored);
});

// The bar is a window onto the value range and bands are clipped into it, so a comfort
// band reaching past the declared axis is drawn as far as the axis goes — the same thing
// that happens to any anchored profile before its axis has grown to meet a band. The
// configuration used to be refused for it; this is the whole of what that removal means
// in the rendered card.
test("a comfort band wider than the declared axis is clipped into it, not rejected", () => {
  const card = createTemperatureCard(
    {
      source: "custom",
      unit: "°C",
      bands: { comfort: { min: 10, max: 30 }, optimal: { min: 20, max: 22 } },
      scale: { min: 20, max: 24, step: 2 },
      icons: { fire: 30, high: 26, normal: 20, low: 14 },
      tiers: [
        { min: 22, score: 3, level: "Warm", color: "#AA0000", zone: "outside" },
        { min: 20, score: 2, level: "Ideal", color: "#00AA00", zone: "optimal" },
        { default: true, score: 1, level: "Cool", color: "#0000AA", zone: "outside" },
      ],
    },
    21
  );
  const data = card._computeViewModel();
  assert.deepEqual([data.scale.scaleMin, data.scale.scaleMax], [18, 24], "the axis is the declared range, grown by one step towards the reading");
  assert.equal(data.scale.comfortVisible, true);
  assert.equal(data.scale.comfortLeft, 0, "the part of the band below the axis is clipped away, not drawn off the edge");
  assert.equal(data.scale.comfortWidth, 100, "and the rest of it fills the bar");
  assert.equal(data.scale.optimalLeft, (20 - 18) / (24 - 18) * 100);
  env.cleanup(card);
});

test("custom Fahrenheit thresholds are canonicalized and project back coherently", () => {
  const fahrenheitProfile = {
    source: "custom",
    unit: "°F",
    valid_range: { min: 32, max: 104 },
    bands: {
      comfort: { min: 50, max: 86 },
      optimal: { min: 64, max: 72 },
    },
    scale: { min: 32, max: 104, step: 2 },
    tiers: [
      { min: 86, score: 3, level: "Hot F", color: "#AA0000", zone: "outside" },
      { min: 64, score: 2, level: "Ideal F", color: "#00AA00", zone: "optimal" },
      { default: true, score: 1, level: "Cold F", color: "#0000AA", zone: "outside" },
    ],
  };
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 70, {
      device_class: "temperature",
      unit_of_measurement: "°F",
    }),
  });
  const card = env.createCard({ entity: "sensor.avg", classification: fahrenheitProfile }, hass);
  const data = card._computeViewModel();
  assert.equal(data.tone.label, "Ideal F");
  assert.deepEqual({ min: data.comfort.min, max: data.comfort.max }, { min: 50, max: 86 });
  assert.deepEqual({ min: data.scale.optimalMin, max: data.scale.optimalMax }, { min: 64, max: 72 });
  env.cleanup(card);

  const outsideRange = env.createCard(
    { entity: "sensor.avg", classification: fahrenheitProfile },
    mkHass({
      "sensor.avg": mkState("sensor.avg", 110, {
        device_class: "temperature",
        unit_of_measurement: "°F",
      }),
    })
  );
  assert.equal(outsideRange._computeViewModel().empty, true);
  env.cleanup(outsideRange);
});

test("custom profile validation fails fast with path-specific errors", () => {
  const cases = [
    [{ ...customProfile, unexpected: true }, /classification\.unexpected/],
    [{ ...customProfile, unit: "hPa" }, /classification\.unit/],
    [{ ...customProfile, bands: { ...customProfile.bands, optimal: { min: 5, max: 22 } } }, /classification\.bands\.optimal/],
    [{ ...customProfile, scale: { min: 40, max: 0, step: 2 } }, /classification\.scale/],
    [{ ...customProfile, tiers: customProfile.tiers.slice(0, 2) }, /default tier/],
    [{ ...customProfile, tiers: [customProfile.tiers[1], customProfile.tiers[0], customProfile.tiers[2]] }, /descending/],
    [{
      ...customProfile,
      tiers: [
        { ...customProfile.tiers[0], color: "red; background:black" },
        ...customProfile.tiers.slice(1),
      ],
    }, /classification\.tiers\[0\]\.color/],
    [{
      ...customProfile,
      unit: "%",
      icons: { fire: 90, high: 75, normal: 40, low: 20 },
    }, /classification\.icons must be a list/],
    [{ ...customProfile, icons: { fire: 30, high: 26, normal: 20, low: 24 } }, /classification\.icons.*descend/],
  ];

  for (const [classification, expected] of cases) {
    assert.throws(() => createTemperatureCard(classification), expected);
  }
});

// The reference axis is a window, not an outer bound: it says which part of the range
// the bar draws, and the bands are clipped into it. A window narrower than the comfort
// band is therefore a legitimate choice, not a contradiction.
test("a reference axis narrower than the comfort band is accepted and clipped", () => {
  const card = createTemperatureCard({ ...customProfile, scale: { min: 12, max: 40, step: 2 } }, 25);
  const celsius = access.getUnitProfile("temperature", "celsius");
  const scale = internals.scaleConfigFor(card, "temperature", celsius);
  assert.deepEqual(normalize(scale.scale), { min: 12, max: 40 });
  assert.deepEqual(normalize(scale.comfort), { min: 10, max: 30 }, "the band keeps its own values");
  env.cleanup(card);
});

test("a built-in profile cannot be applied to the wrong metric kind", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 50, {
      device_class: "humidity",
      unit_of_measurement: "%",
    }),
  });
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", classification: "outdoor" }, hass),
    /profile "outdoor".*humidity/
  );
});

// A profile scoped to the primary's kind must not be validated against a
// configured room of another metric kind. The card-wide profile must
// only ever be enforced against the resolved kind and its same-kind
// participants -- a foreign-kind room is simply irrelevant to it.
test("a foreign-kind room does not break profile resolution for the primary's own kind (auto + profile shorthand)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 25, TEMPERATURE_C),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
  });
  const card = env.createCard(
    { entity: "sensor.avg", classification: "outdoor", rooms: [{ entity: "sensor.hum1" }] },
    hass
  );
  const context = card._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.deepEqual(normalize(context.excludedRoomIds), ["sensor.hum1"]);
  assert.ok(
    context.diagnostics.some((d) => d.code === "excluded_foreign_metric_kind" && d.entityId === "sensor.hum1"),
    "the foreign-kind room must be excluded and diagnosed, not cause a throw"
  );
  const data = card._computeViewModel();
  assert.equal(data.empty, false);
  assert.equal(data.tone.score, 1); // 25°C falls in the outdoor profile's [22,26) "slightlyWarm" tier
  assert.equal(data.tone.zone, "comfort");
  env.cleanup(card);
});

test("a foreign-kind room does not break profile resolution for the primary's own kind (source: custom)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 25, TEMPERATURE_C),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
  });
  const card = env.createCard(
    { entity: "sensor.avg", classification: customProfile, rooms: [{ entity: "sensor.hum1" }] },
    hass
  );
  const context = card._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.deepEqual(normalize(context.excludedRoomIds), ["sensor.hum1"]);
  assert.ok(
    context.diagnostics.some((d) => d.code === "excluded_foreign_metric_kind" && d.entityId === "sensor.hum1")
  );
  assert.equal(card._computeViewModel().empty, false);
  env.cleanup(card);
});

// _classificationProfileForDisplay() rounds
// each projected boundary independently (Math.round for Fahrenheit) with
// no check afterward that the rounded result still forms a coherent,
// non-degenerate profile. A custom profile authored in Celsius with a
// gap narrower than the ~0.56°C needed to survive integer Fahrenheit
// rounding can have two distinct boundaries round to the SAME displayed
// value -- silently collapsing a band to zero width or making a tier
// unreachable, both of which then feed directly into the actual
// classification decision (_classifyNumericValue()), not just an icon.
function fahrenheitHass(value = 68) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", value, TEMPERATURE_F),
  });
}

test("custom profile with a comfort band narrower than Fahrenheit's rounding grid throws a clear, specific error", () => {
  const collapsingProfile = {
    source: "custom",
    unit: "°C",
    comparison: ">=",
    bands: {
      comfort: { min: 20.0, max: 20.2 }, // 68.0°F and 68.36°F both round to 68°F
      optimal: { min: 20.05, max: 20.15 },
    },
    scale: { min: 15, max: 25, step: 1 },
    tiers: [
      { min: 22, score: 2, level: "High", color: "#AA0000", zone: "outside" },
      { default: true, score: 1, level: "Low", color: "#0000AA", zone: "outside" },
    ],
  };
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", classification: collapsingProfile }, fahrenheitHass()),
    /becomes degenerate when rounded to °F \(comfort band collapses\)/
  );
});

test("custom profile with two tier thresholds narrower than Fahrenheit's rounding grid throws a clear, specific error", () => {
  const collapsingTierProfile = {
    source: "custom",
    unit: "°C",
    comparison: ">=",
    bands: {
      comfort: { min: 10, max: 30 },
      optimal: { min: 18, max: 22 },
    },
    scale: { min: 0, max: 40, step: 2 },
    tiers: [
      { min: 25.2, score: 3, level: "Very high", color: "#AA0000", zone: "outside" },
      { min: 25.0, score: 2, level: "High", color: "#AA5500", zone: "outside" }, // 77.36°F and 77.0°F both round to 77°F
      { default: true, score: 1, level: "Low", color: "#0000AA", zone: "outside" },
    ],
  };
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", classification: collapsingTierProfile }, fahrenheitHass()),
    /becomes degenerate when rounded to °F \(tier thresholds collapse/
  );
});

test("custom profile with gaps just wide enough to survive Fahrenheit rounding does not throw (no false positive)", () => {
  const safeProfile = {
    source: "custom",
    unit: "°C",
    comparison: ">=",
    bands: {
      comfort: { min: 20.0, max: 20.6 }, // 68.0°F -> 69.08°F, rounds to 68/69: distinct
      optimal: { min: 20.1, max: 20.5 },
    },
    scale: { min: 15, max: 25, step: 1 },
    tiers: [
      { min: 22, score: 2, level: "High", color: "#AA0000", zone: "outside" },
      { default: true, score: 1, level: "Low", color: "#0000AA", zone: "outside" },
    ],
  };
  const card = env.createCard({ entity: "sensor.avg", classification: safeProfile }, fahrenheitHass());
  assert.equal(card._computeViewModel().empty, false);
  env.cleanup(card);
});


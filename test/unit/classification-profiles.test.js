"use strict";

// Classification-profile architecture: YAML policy normalization, strict
// entity-attribute precedence, built-in indoor/outdoor temperature profiles,
// custom user profiles, display-unit projection, and profile-driven icons.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Direct imports make the owning module of each classification contract explicit.
let access;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  access = await import("../../src/domain/metrics/access.js");
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

test("omitted classification normalizes to auto + metric default profile", () => {
  const card = createTemperatureCard();
  assert.deepEqual(normalize(card._config.classification), {
    source: "auto",
    profile: null,
    custom: null,
  });
  assert.equal(internals.canonicalProfile(card, "temperature").id, "indoor");
  env.cleanup(card);
});

test("classification: outdoor is the shorthand for auto + outdoor", () => {
  const card = createTemperatureCard("outdoor");
  assert.deepEqual(normalize(card._config.classification), {
    source: "auto",
    profile: "outdoor",
    custom: null,
  });
  assert.equal(internals.canonicalProfile(card, "temperature").id, "outdoor");
  env.cleanup(card);
});

test("outdoor profile owns tiers and bands but declares no reference range at all", () => {
  const card = createTemperatureCard("outdoor");
  const celsius = access.getUnitProfile("temperature", "celsius");
  const scale = internals.scaleConfigFor(card, "temperature", celsius);
  assert.deepEqual(normalize(scale.comfort), { min: 14, max: 26 });
  assert.deepEqual(normalize(scale.optimal), { min: 18, max: 22 });
  assert.equal(scale.scale, null, "an axis that follows the data has no reference range to declare");
  assert.equal(scale.step, 1);
  assert.equal(scale.anchorScale, false);

  assert.equal(internals.fallbackTone(card, 25.99, "temperature", celsius).score, 1);
  assert.equal(internals.fallbackTone(card, 25.99, "temperature", celsius).zone, "comfort");
  assert.equal(internals.fallbackTone(card, 26, "temperature", celsius).score, 2);
  assert.equal(internals.fallbackTone(card, 18, "temperature", celsius).score, 0);
  assert.equal(internals.fallbackTone(card, 14, "temperature", celsius).score, -1);
  assert.equal(internals.fallbackTone(card, 10, "temperature", celsius).score, -2);
  env.cleanup(card);
});

test("outdoor dynamic scale uses only the live data range plus the shared headroom, while indoor remains base-anchored", () => {
  const outdoor = createTemperatureCard("outdoor");
  const indoor = createTemperatureCard("indoor");
  const celsius = access.getUnitProfile("temperature", "celsius");

  assert.deepEqual(
    normalize(internals.dynamicScale(outdoor, 2, 8, "temperature", celsius)),
    { min: 1, max: 9, step: 1 },
    "winter outdoor values must not drag the obsolete 10-30 reference scale into the rendered axis"
  );
  assert.deepEqual(
    normalize(internals.dynamicScale(indoor, 2, 8, "temperature", celsius)),
    { min: 1, max: 25, step: 1 },
    "the existing anchored expansion policy must remain byte-for-byte equivalent for indoor temperature"
  );
  env.cleanup(outdoor);
  env.cleanup(indoor);
});

test("outdoor main and range scales share the same unanchored winter bounds and suppress fully off-axis semantic bands", () => {
  const card = env.createCard(
    {
      entity: "sensor.avg",
      classification: "outdoor",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "range_scale" }, { type: "scale" }],
    },
    mkHass({
      "sensor.avg": mkState("sensor.avg", 3, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r1": mkState("sensor.r1", -2, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkState("sensor.r2", 8, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkState("sensor.range", 10, { unit_of_measurement: "°C", minimum: -2, maximum: 8 }),
    })
  );
  const data = card._computeViewModel();
  assert.deepEqual(normalize([data.scale.scaleMin, data.scale.scaleMax]), [-3, 9]);
  assert.deepEqual(normalize([data.rangeScale.scaleMin, data.rangeScale.scaleMax]), [-3, 9]);
  assert.equal(data.scale.comfortVisible, false);
  assert.equal(data.scale.optimalVisible, false);
  assert.equal(data.rangeScale.comfortVisible, false);
  assert.equal(data.rangeScale.optimalVisible, false);
  assert.match(internals.viewMarkup(card, "scale", data), /rtc-comfort-band[^>]* hidden/);
  assert.match(internals.viewMarkup(card, "range_scale", data), /rtc-optimal-band[^>]* hidden/);
  env.cleanup(card);
});

test("outdoor off-axis bands reappear through the partial-update path when live values move back into their range", () => {
  const config = {
    entity: "sensor.avg",
    classification: "outdoor",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    views: [{ type: "scale" }],
  };
  const winter = mkHass({
    "sensor.avg": mkState("sensor.avg", 3, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", -2, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 8, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const card = env.createCard(config, winter);
  const scaleView = card.shadowRoot.querySelector(".rtc-scale-view");
  assert.equal(scaleView.querySelector(".rtc-comfort-band").hidden, true);
  assert.equal(scaleView.querySelector(".rtc-optimal-band").hidden, true);

  card.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
  });

  assert.equal(card.shadowRoot.querySelector(".rtc-scale-view"), scaleView);
  assert.equal(scaleView.querySelector(".rtc-comfort-band").hidden, false);
  assert.equal(scaleView.querySelector(".rtc-optimal-band").hidden, false);
  assert.equal(scaleView.querySelector(".rtc-scale-comfort-label").hidden, false);
  assert.equal(scaleView.querySelector(".rtc-scale-label-center").hidden, false);
  env.cleanup(card);
});

test("outdoor temperature icons follow outdoor thresholds instead of indoor thresholds", () => {
  const card = createTemperatureCard("outdoor");
  const celsius = access.getUnitProfile("temperature", "celsius");
  assert.equal(internals.profileIcon(card, 35, "temperature", celsius), "mdi:fire-alert");
  assert.equal(internals.profileIcon(card, 30, "temperature", celsius), "mdi:thermometer-high");
  assert.equal(internals.profileIcon(card, 14, "temperature", celsius), "mdi:thermometer");
  assert.equal(internals.profileIcon(card, 5, "temperature", celsius), "mdi:thermometer-low");
  assert.equal(internals.profileIcon(card, 4.99, "temperature", celsius), "mdi:snowflake");
  env.cleanup(card);
});

test("classification: fridge is a built-in temperature profile independent of indoor/outdoor", () => {
  const card = createTemperatureCard("fridge");
  assert.equal(internals.canonicalProfile(card, "temperature").id, "fridge");
  env.cleanup(card);
});

test("fridge profile targets an appliance-appropriate band, not room temperature", () => {
  const card = createTemperatureCard("fridge");
  const celsius = access.getUnitProfile("temperature", "celsius");
  const scale = internals.scaleConfigFor(card, "temperature", celsius);
  assert.deepEqual(normalize(scale.comfort), { min: 1, max: 6 });
  assert.deepEqual(normalize(scale.optimal), { min: 3, max: 5 });
  assert.deepEqual(normalize(scale.scale), { min: 0, max: 8 });
  assert.equal(scale.step, 1);
  assert.equal(scale.anchorScale, true, "unlike outdoor, fridge keeps a fixed reference axis");
  env.cleanup(card);
});

test("fridge classification tiers follow food-safety-appropriate boundaries", () => {
  const card = createTemperatureCard("fridge");
  const celsius = access.getUnitProfile("temperature", "celsius");
  const at = (value) => internals.fallbackTone(card, value, "temperature", celsius);
  assert.equal(at(12).score, 5);
  assert.equal(at(12).zone, "outside");
  assert.equal(at(6).score, 2);
  assert.equal(at(6).zone, "outside");
  assert.equal(at(5).score, 1);
  assert.equal(at(5).zone, "comfort");
  assert.equal(at(4).score, 0);
  assert.equal(at(4).zone, "optimal");
  assert.equal(at(3).score, 0);
  assert.equal(at(3).zone, "optimal");
  assert.equal(at(1).score, -1);
  assert.equal(at(1).zone, "comfort");
  assert.equal(at(0).score, -2);
  assert.equal(at(0).zone, "outside");
  assert.equal(at(-4).score, -4);
  assert.equal(at(-5).score, -5);
  env.cleanup(card);
});

test("fridge temperature icons follow fridge-specific thresholds, not room thresholds", () => {
  const card = createTemperatureCard("fridge");
  const celsius = access.getUnitProfile("temperature", "celsius");
  assert.equal(internals.profileIcon(card, 12, "temperature", celsius), "mdi:fire-alert");
  assert.equal(internals.profileIcon(card, 10, "temperature", celsius), "mdi:thermometer-high");
  assert.equal(internals.profileIcon(card, 4, "temperature", celsius), "mdi:thermometer");
  assert.equal(internals.profileIcon(card, -2, "temperature", celsius), "mdi:thermometer-low");
  assert.equal(internals.profileIcon(card, -2.01, "temperature", celsius), "mdi:snowflake");
  env.cleanup(card);
});

test("fridge profile is projected atomically into Fahrenheit without collapsing tiers", () => {
  const card = createTemperatureCard("fridge");
  const fahrenheit = access.getUnitProfile("temperature", "fahrenheit");
  const scale = internals.scaleConfigFor(card, "temperature", fahrenheit);
  assert.deepEqual(normalize(scale.comfort), { min: 34, max: 43 });
  assert.deepEqual(normalize(scale.optimal), { min: 37, max: 41 });
  assert.deepEqual(normalize(scale.scale), { min: 32, max: 46 });

  const table = internals.displayProfile(card, "temperature", fahrenheit);
  const warmTier = table.tiers.find((tier) => tier.score === 2);
  assert.equal(warmTier.min, 43, "6 °C must become the rounded 43 °F tier boundary");
  assert.equal(internals.profileIcon(card, 54, "temperature", fahrenheit), "mdi:fire-alert");
  assert.equal(internals.profileIcon(card, 28, "temperature", fahrenheit), "mdi:thermometer-low");
  env.cleanup(card);
});

test("fridge cannot be applied to a non-temperature metric kind", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", classification: "fridge" }, hass),
    /profile "fridge".*humidity/
  );
});

test("humidity, CO2, and PM2.5 header icons follow metric-specific profile thresholds", () => {
  const cases = [
    {
      deviceClass: "humidity",
      unit: "%",
      readings: [
        [75, "mdi:water-percent-alert"],
        [60, "mdi:water-plus"],
        [40, "mdi:water-percent"],
        [39.9, "mdi:water-minus"],
      ],
    },
    {
      deviceClass: "carbon_dioxide",
      unit: "ppm",
      readings: [
        [2000, "mdi:alert-circle-outline"],
        [800, "mdi:molecule-co2"],
      ],
    },
    {
      deviceClass: "pm25",
      unit: "µg/m³",
      readings: [
        [50.1, "mdi:alert-circle-outline"],
        [25.1, "mdi:weather-dust"],
        [5.1, "mdi:weather-hazy"],
        [5, "mdi:molecule"],
      ],
    },
  ];

  for (const { deviceClass, unit, readings } of cases) {
    for (const [value, expectedIcon] of readings) {
      const card = env.createCard(
        { entity: "sensor.avg" },
        mkHass({
          "sensor.avg": mkState("sensor.avg", value, {
            device_class: deviceClass,
            unit_of_measurement: unit,
          }),
        })
      );
      assert.equal(card._computeViewModel().tone.icon, expectedIcon, `${deviceClass} at ${value}${unit}`);
      env.cleanup(card);
    }
  }
});

const customHumidityWithIcons = {
  source: "custom",
  unit: "%",
  comparison: ">=",
  bands: { comfort: { min: 30, max: 70 }, optimal: { min: 40, max: 60 } },
  scale: { min: 0, max: 100, step: 10 },
  tiers: [
    { min: 70, score: 2, level: "Humid", color: "#3388FF", zone: "outside" },
    { default: true, score: 1, level: "Normal", color: "#33AA33", zone: "comfort" },
  ],
  icons: [
    { min: 60, icon: "mdi:water-percent-alert" },
    { min: 30, icon: "mdi:water-percent" },
    { default: true, icon: "mdi:water-minus" },
  ],
};

function humidityCardWithIcons(value, classification = customHumidityWithIcons) {
  return env.createCard(
    { entity: "sensor.avg", classification },
    mkHass({ "sensor.avg": mkState("sensor.avg", value, { device_class: "humidity", unit_of_measurement: "%" }) })
  );
}

test("a custom non-temperature profile can configure icons as a descending {min, icon} list", () => {
  const above = humidityCardWithIcons(65);
  assert.equal(above._computeViewModel().tone.icon, "mdi:water-percent-alert");
  env.cleanup(above);

  const mid = humidityCardWithIcons(45);
  assert.equal(mid._computeViewModel().tone.icon, "mdi:water-percent");
  env.cleanup(mid);

  const low = humidityCardWithIcons(10);
  assert.equal(low._computeViewModel().tone.icon, "mdi:water-minus");
  env.cleanup(low);
});

// Omitting `icons` means one thing, and it means it for every measurement: the profile
// declares none, so the card shows the icon that measurement always carries. Temperature
// is in this list like the rest — it has no derivation of its own to fall back on.
test("a custom profile without icons shows the metric's static icon, for every measurement", () => {
  const cases = [
    ["temperature", "°C", 22, { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } }, { min: 16, max: 28, step: 2 }, 24, "mdi:thermometer"],
    ["humidity", "%", 48, { comfort: { min: 30, max: 70 }, optimal: { min: 40, max: 60 } }, { min: 0, max: 100, step: 10 }, 70, "mdi:water-percent"],
    ["carbon_dioxide", "ppm", 700, { comfort: { min: 400, max: 1000 }, optimal: { min: 400, max: 800 } }, { min: 400, max: 2000, step: 100 }, 1000, "mdi:molecule-co2"],
    ["pm25", "µg/m³", 8, { comfort: { min: 0, max: 25 }, optimal: { min: 0, max: 10 } }, { min: 0, max: 75, step: 5 }, 25, "mdi:molecule"],
  ];
  for (const [deviceClass, unit, value, bands, scale, warmMin, expected] of cases) {
    const card = env.createCard(
      {
        entity: "sensor.avg",
        classification: {
          source: "custom",
          unit,
          bands,
          scale,
          tiers: [
            { min: warmMin, score: 2, level: "High", color: "#3388FF", zone: "outside" },
            { default: true, score: 1, level: "Normal", color: "#33AA33", zone: "comfort" },
          ],
        },
      },
      mkHass({ "sensor.avg": mkState("sensor.avg", value, { device_class: deviceClass, unit_of_measurement: unit }) })
    );
    assert.equal(card._computeViewModel().tone.icon, expected, deviceClass);
    env.cleanup(card);
  }
});

test("custom non-temperature icons: validation reuses the shared tiers list contract", () => {
  const cases = [
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: "mdi:water-percent-alert" }] }, /default tier/],
    [{ ...customHumidityWithIcons, icons: [{ min: 30, icon: "mdi:a" }, { min: 60, icon: "mdi:b" }, { default: true, icon: "mdi:c" }] }, /descending/],
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: 42 }, { default: true, icon: "mdi:c" }] }, /classification\.icons\[0\]\.icon/],
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: "mdi:a", bogus: true }, { default: true, icon: "mdi:c" }] }, /classification\.icons\[0\]\.bogus/],
    // The threshold object is a temperature-only input spelling; every other metric has
    // only the shared list.
    [{ ...customHumidityWithIcons, icons: { fire: 90, high: 75, normal: 40, low: 20 } }, /classification\.icons must be a list/],
  ];
  for (const [classification, expected] of cases) {
    assert.throws(() => humidityCardWithIcons(65, classification), expected);
  }
});

test("outdoor profile is projected atomically into Fahrenheit", () => {
  const card = createTemperatureCard("outdoor");
  const fahrenheit = access.getUnitProfile("temperature", "fahrenheit");
  const scale = internals.scaleConfigFor(card, "temperature", fahrenheit);
  assert.deepEqual(normalize(scale.comfort), { min: 57, max: 79 });
  assert.deepEqual(normalize(scale.optimal), { min: 64, max: 72 });
  assert.equal(scale.scale, null, "there is no reference range to re-express in another unit");

  const table = internals.displayProfile(card, "temperature", fahrenheit);
  const warmTier = table.tiers.find((tier) => tier.score === 2);
  assert.equal(warmTier.min, 79, "26 °C must become the rounded 79 °F tier boundary");
  assert.equal(internals.profileIcon(card, 95, "temperature", fahrenheit), "mdi:fire-alert");
  assert.equal(internals.profileIcon(card, 86, "temperature", fahrenheit), "mdi:thermometer-high");
  env.cleanup(card);
});

test("auto accepts entity classification only when both color and level are valid", () => {
  const complete = createTemperatureCard(undefined, 25.5, {
    value_color: "#123456",
    value_level: "Entity level",
    value_score: 42,
    value_zone: "comfort",
  });
  assert.equal(complete._computeViewModel().tone.color, "#123456");
  assert.equal(complete._computeViewModel().tone.label, "Entity level");
  env.cleanup(complete);

  const colorOnly = createTemperatureCard(undefined, 25.5, {
    value_color: "#123456",
  });
  const colorOnlyTone = colorOnly._computeViewModel().tone;
  assert.equal(colorOnlyTone.color, "#C98A67", "the entire incomplete entity classification must fall back to indoor");
  assert.equal(colorOnlyTone.label, "Very warm");
  env.cleanup(colorOnly);

  const levelOnly = createTemperatureCard(undefined, 25.5, {
    value_level: "Entity level",
  });
  const levelOnlyTone = levelOnly._computeViewModel().tone;
  assert.equal(levelOnlyTone.color, "#C98A67");
  assert.equal(levelOnlyTone.label, "Very warm", "entity level must not be mixed with a profile color");
  env.cleanup(levelOnly);
});

test("source entity deliberately accepts partial attributes but never fills them from a numeric profile", () => {
  const colorOnly = createTemperatureCard({ source: "entity" }, 25.5, {
    value_color: "#123456",
    value_score: 9,
    value_zone: "outside",
  });
  const tone = colorOnly._computeViewModel().tone;
  assert.equal(tone.color, "#123456");
  assert.equal(tone.label, "—");
  assert.equal(tone.score, 9);
  assert.equal(tone.zone, "outside");
  env.cleanup(colorOnly);

  const noAttributes = createTemperatureCard({ source: "entity" });
  const neutral = noAttributes._computeViewModel().tone;
  assert.equal(neutral.color, "#7D7D7D", "the card's own neutral grey, which belongs to no palette");
  assert.equal(neutral.label, "—");
  assert.equal(neutral.source, "entity");
  env.cleanup(noAttributes);
});

test("source profile ignores even a complete entity classification", () => {
  const card = createTemperatureCard(
    { source: "profile", profile: "outdoor" },
    25.5,
    {
      value_color: "#123456",
      value_level: "Entity level",
      value_score: 99,
      value_zone: "optimal",
    }
  );
  const tone = card._computeViewModel().tone;
  assert.equal(tone.color, "#9DA85A");
  assert.equal(tone.label, "Slightly warm");
  assert.equal(tone.score, 1);
  assert.equal(tone.zone, "comfort");
  assert.equal(tone.source, "builtin");
  env.cleanup(card);
});

test("live setConfig profile changes patch level, icon, and bands without stale indoor semantics", () => {
  const card = createTemperatureCard("indoor", 31);
  const statusNode = card.shadowRoot.querySelector(".rtc-status-pill");
  const iconNode = card.shadowRoot.querySelector(".rtc-icon-badge ha-icon");
  assert.equal(statusNode.textContent, "Very hot");
  assert.equal(iconNode.getAttribute("icon"), "mdi:fire-alert");

  card.setConfig({ entity: "sensor.avg", classification: "outdoor" });
  const data = card._computeViewModel();
  assert.equal(card.shadowRoot.querySelector(".rtc-status-pill"), statusNode);
  assert.equal(card.shadowRoot.querySelector(".rtc-icon-badge ha-icon"), iconNode);
  assert.equal(statusNode.textContent, "Hot");
  assert.equal(iconNode.getAttribute("icon"), "mdi:thermometer-high");
  assert.deepEqual({ min: data.comfort.min, max: data.comfort.max }, { min: 14, max: 26 });
  assert.deepEqual({ min: data.scale.optimalMin, max: data.scale.optimalMax }, { min: 18, max: 22 });
  env.cleanup(card);
});

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
    "sensor.avg": mkState("sensor.avg", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
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
    "sensor.avg": mkState("sensor.avg", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
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
    "sensor.avg": mkState("sensor.avg", value, { device_class: "temperature", unit_of_measurement: "°F" }),
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

// ---------------------------------------------------------------- palettes --

// End to end through a real card: the palette option is what decides the colour a value
// is shown in, and the profile decides only where on the ramp that value sits.
function paletteCard(palette, value = 22) {
  return env.createCard({ entity: "sensor.avg", palette }, temperatureHass(value));
}

test("a card shows its configured palette's colour for the same reading", () => {
  const soft = paletteCard(undefined);
  const bold = paletteCard("vivid");
  const softColor = soft._computeViewModel().tone.color;
  const boldColor = bold._computeViewModel().tone.color;
  assert.equal(softColor, "#79A86C", "the default palette is the card's own ramp, unchanged");
  assert.notEqual(boldColor, softColor);
  assert.match(boldColor, /^#[0-9A-Fa-f]{6}$/);
  env.cleanup(soft);
  env.cleanup(bold);
});

test("a palette written out in YAML colours the card from its own ramp", () => {
  // Five colours per wing, matching the indoor profile's reach, so the mapping is one
  // to one and visible.
  const written = {
    below: ["#0B0B0B", "#0C0C0C", "#0D0D0D", "#0E0E0E", "#0F0F0F"],
    optimal: "#060606",
    above: ["#010101", "#020202", "#030303", "#040404", "#050505"],
  };
  const optimal = paletteCard(written, 22);
  assert.equal(optimal._computeViewModel().tone.color, "#060606", "22 °C is optimal for the indoor profile");
  env.cleanup(optimal);
  const warm = paletteCard(written, 23.5);
  assert.equal(warm._computeViewModel().tone.color, "#010101", "one step above optimal");
  env.cleanup(warm);
  const cold = paletteCard(written, 10);
  assert.equal(cold._computeViewModel().tone.color, "#0F0F0F", "as far below as the profile goes");
  env.cleanup(cold);
});

// A palette with less resolution than the profile is a legitimate choice, not an error:
// it simply says "three colours is all I want to distinguish".
test("a palette shorter than the profile collapses onto what it has", () => {
  const tiny = { below: ["#0000FF"], optimal: "#00FF00", above: ["#FF0000"] };
  for (const [value, expected] of [[30, "#FF0000"], [23.5, "#FF0000"], [22, "#00FF00"], [20.5, "#0000FF"], [10, "#0000FF"]]) {
    const card = paletteCard(tiny, value);
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }
});

test("an unknown palette name stops the card with a message naming the known ones", () => {
  assert.throws(
    () => env.createCard({ entity: "sensor.avg", palette: "neon" }, temperatureHass()),
    /palette "neon" is neither a palette nor a color — the palettes are "pastel", "vivid", "color-vision", "protan-deutan", "protan", "deutan", "tritan", "signal"/
  );
});

// The two roads a single word can take, through a real card.
test("a colour name gives a ramp in that colour, and a palette name still wins", () => {
  const teal = env.createCard({ entity: "sensor.avg", palette: "teal" }, temperatureHass(22));
  // The promise of a monochrome palette, through a real card: name a colour, get that
  // colour. 22 °C is optimal, so the middle of the ramp — and the middle IS #008080.
  assert.equal(teal._computeViewModel().tone.color, "#008080");
  env.cleanup(teal);

  const hex = env.createCard({ entity: "sensor.avg", palette: "#3366CC" }, temperatureHass(22));
  assert.match(hex._computeViewModel().tone.color, /^#[0-9A-F]{6}$/, "a hex base works the same way");
  env.cleanup(hex);

  const shipped = env.createCard({ entity: "sensor.avg", palette: "pastel" }, temperatureHass(22));
  assert.equal(shipped._computeViewModel().tone.color, "#79A86C");
  env.cleanup(shipped);
});

test("a custom profile without tier colours takes them from the palette", () => {
  const colourless = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 1, level: "Warm", zone: "outside" },
      { min: 20, score: 0, level: "Ok", zone: "optimal" },
      { default: true, score: -1, level: "Cold", zone: "outside" },
    ],
  };
  // Three tiers on an eleven-colour ramp: the two ends reach the ramp's ends rather than
  // picking neighbours out of its middle, and optimal is its middle.
  for (const [value, expected] of [[25, "#B85F67"], [22, "#79A86C"], [10, "#8A88C9"]]) {
    const card = env.createCard({ entity: "sensor.avg", classification: colourless }, temperatureHass(value));
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }

  // And the same profile under the other palette moves with it.
  const bold = env.createCard({ entity: "sensor.avg", classification: colourless, palette: "vivid" }, temperatureHass(25));
  assert.equal(bold._computeViewModel().tone.color, "#CC2B2B");
  env.cleanup(bold);

  // A tier that names its own colour keeps it, whatever the palette is.
  const painted = env.createCard(
    {
      entity: "sensor.avg",
      palette: "vivid",
      classification: { ...colourless, tiers: colourless.tiers.map((tier) => ({ ...tier, color: "#ABCDEF" })) },
    },
    temperatureHass(22)
  );
  assert.equal(painted._computeViewModel().tone.color, "#ABCDEF");
  env.cleanup(painted);
});

// The two traps, through a real card rather than through the resolver alone.
test("entity mode without a value_color stays neutral, and never borrows a ramp colour", () => {
  const card = env.createCard(
    { entity: "sensor.avg", classification: "entity", palette: "vivid" },
    temperatureHass(22, { value_score: 1, value_level: "From the integration" })
  );
  assert.equal(card._computeViewModel().tone.color, "#7D7D7D");
  env.cleanup(card);
});

// A physically impossible reading never reaches the classifier from a rendered card —
// it is filtered upstream and shown as no data, in either palette. Pinned here because
// the alternative reading of the palette work would be that such a value now takes a
// ramp colour, and it must not: the classifier's own invalid branch is covered in
// classification-palettes.test.js.
test("a physically impossible reading is no data, not a colour from the ramp", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 120, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  for (const palette of [undefined, "vivid"]) {
    const card = env.createCard({ entity: "sensor.avg", palette }, hass);
    assert.equal(card._computeViewModel().tone.color, "#7F8792", String(palette));
    env.cleanup(card);
  }
});

// A profile that reaches further than the palette does needs no declaration: both are
// anchored at optimal, so the wings simply scale.
test("a profile reaching further than the palette is spread across it", () => {
  const twenty = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 10, level: "Top", zone: "outside" },
      { min: 20, score: 0, level: "Middle", zone: "optimal" },
      { default: true, score: -10, level: "Bottom", zone: "outside" },
    ],
  };
  const cases = [[26, "#B85F67"], [22, "#79A86C"], [10, "#8A88C9"]];
  for (const [value, expected] of cases) {
    const card = env.createCard({ entity: "sensor.avg", classification: twenty }, temperatureHass(value));
    assert.equal(card._computeViewModel().tone.color, expected, `${value} °C`);
    env.cleanup(card);
  }
});

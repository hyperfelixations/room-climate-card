"use strict";

// Built-in classification and precedence: where the card's default "comfortable" comes
// from and which source wins. Four sources with strict precedence — YAML classification,
// entity self-classification via attributes, a built-in metric profile, and projection of
// any of those into the displayed unit. Covered: YAML policy selection, entity-attribute
// precedence, built-in temperature profiles, profile icons, live profile replacement.
// Custom-profile projection and palette integration have separate owners.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { HUMIDITY, TEMPERATURE_C } = require("../../fixtures/attributes.js");

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
      "sensor.avg": mkState("sensor.avg", 3, TEMPERATURE_C),
      "sensor.r1": mkState("sensor.r1", -2, TEMPERATURE_C),
      "sensor.r2": mkState("sensor.r2", 8, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 3, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", -2, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 8, TEMPERATURE_C),
  });
  const card = env.createCard(config, winter);
  const scaleView = card.shadowRoot.querySelector(".rtc-scale-view");
  assert.equal(scaleView.querySelector(".rtc-comfort-band").hidden, true);
  assert.equal(scaleView.querySelector(".rtc-optimal-band").hidden, true);

  card.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 24, TEMPERATURE_C),
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
    "sensor.avg": mkState("sensor.avg", 50, HUMIDITY),
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
        [50, "mdi:alert-circle-outline"],
        [25, "mdi:weather-dust"],
        [5, "mdi:weather-hazy"],
        [4.9, "mdi:molecule"],
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
    mkHass({ "sensor.avg": mkState("sensor.avg", value, HUMIDITY) })
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

// No `icons` means the profile declares none and the card shows the measurement's static
// icon — temperature included, it has no derivation of its own to fall back on.
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

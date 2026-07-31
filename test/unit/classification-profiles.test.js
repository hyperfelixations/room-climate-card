"use strict";

// Classification-profile architecture: YAML policy normalization, strict
// entity-attribute precedence, built-in indoor/outdoor temperature profiles,
// custom user profiles, display-unit projection, and profile-driven icons.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// The compositions the element used to expose only for tests (see the helper).
let internals;

// The modules under test, imported directly. These used to be reached through
// thin delegating methods on the custom element; the element no longer carries
// them, and naming the real module is what makes each test say where its subject
// actually lives.
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

test("outdoor profile owns tiers and bands but explicitly opts out of the retained 10-30 reference-scale anchor", () => {
  const card = createTemperatureCard("outdoor");
  const celsius = access.getUnitProfile("temperature", "celsius");
  const scale = internals.scaleConfigFor(card, "temperature", celsius);
  assert.deepEqual(normalize(scale.comfort), { min: 14, max: 26 });
  assert.deepEqual(normalize(scale.optimal), { min: 18, max: 22 });
  assert.deepEqual(normalize(scale.scale), { min: 10, max: 30 });
  assert.equal(scale.step, 1);
  assert.equal(scale.anchorScale, false);

  assert.equal(internals.fallbackTone(card, 25.99, "temperature", celsius).score, 7);
  assert.equal(internals.fallbackTone(card, 25.99, "temperature", celsius).zone, "comfort");
  assert.equal(internals.fallbackTone(card, 26, "temperature", celsius).score, 8);
  assert.equal(internals.fallbackTone(card, 18, "temperature", celsius).score, 6);
  assert.equal(internals.fallbackTone(card, 14, "temperature", celsius).score, 5);
  assert.equal(internals.fallbackTone(card, 10, "temperature", celsius).score, 4);
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
  assert.equal(internals.temperatureIcon(card, 35, celsius), "mdi:fire-alert");
  assert.equal(internals.temperatureIcon(card, 30, celsius), "mdi:thermometer-high");
  assert.equal(internals.temperatureIcon(card, 14, celsius), "mdi:thermometer");
  assert.equal(internals.temperatureIcon(card, 5, celsius), "mdi:thermometer-low");
  assert.equal(internals.temperatureIcon(card, 4.99, celsius), "mdi:snowflake");
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
  assert.equal(at(12).score, 11);
  assert.equal(at(12).zone, "outside");
  assert.equal(at(6).score, 8);
  assert.equal(at(6).zone, "outside");
  assert.equal(at(5).score, 7);
  assert.equal(at(5).zone, "comfort");
  assert.equal(at(4).score, 6);
  assert.equal(at(4).zone, "optimal");
  assert.equal(at(3).score, 6);
  assert.equal(at(3).zone, "optimal");
  assert.equal(at(1).score, 5);
  assert.equal(at(1).zone, "comfort");
  assert.equal(at(0).score, 4);
  assert.equal(at(0).zone, "outside");
  assert.equal(at(-4).score, 2);
  assert.equal(at(-5).score, 1);
  env.cleanup(card);
});

test("fridge temperature icons follow fridge-specific thresholds, not room thresholds", () => {
  const card = createTemperatureCard("fridge");
  const celsius = access.getUnitProfile("temperature", "celsius");
  assert.equal(internals.temperatureIcon(card, 12, celsius), "mdi:fire-alert");
  assert.equal(internals.temperatureIcon(card, 10, celsius), "mdi:thermometer-high");
  assert.equal(internals.temperatureIcon(card, 4, celsius), "mdi:thermometer");
  assert.equal(internals.temperatureIcon(card, -2, celsius), "mdi:thermometer-low");
  assert.equal(internals.temperatureIcon(card, -2.01, celsius), "mdi:snowflake");
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
  const warmTier = table.tiers.find((tier) => tier.score === 8);
  assert.equal(warmTier.min, 43, "6 °C must become the rounded 43 °F tier boundary");
  assert.equal(internals.temperatureIcon(card, 54, fahrenheit), "mdi:fire-alert");
  assert.equal(internals.temperatureIcon(card, 28, fahrenheit), "mdi:thermometer-low");
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

test("a custom non-temperature profile without icons: keeps the metric's static default icon", () => {
  const card = humidityCardWithIcons(65, { ...customHumidityWithIcons, icons: undefined });
  assert.equal(card._computeViewModel().tone.icon, "mdi:water-percent");
  env.cleanup(card);
});

test("custom non-temperature icons: validation reuses the shared tiers list contract", () => {
  const cases = [
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: "mdi:water-percent-alert" }] }, /default tier/],
    [{ ...customHumidityWithIcons, icons: [{ min: 30, icon: "mdi:a" }, { min: 60, icon: "mdi:b" }, { default: true, icon: "mdi:c" }] }, /descending/],
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: 42 }, { default: true, icon: "mdi:c" }] }, /classification\.icons\[0\]\.icon/],
    [{ ...customHumidityWithIcons, icons: [{ min: 60, icon: "mdi:a", bogus: true }, { default: true, icon: "mdi:c" }] }, /classification\.icons\[0\]\.bogus/],
    [{ ...customHumidityWithIcons, icons: { fire: 90, high: 75, normal: 40, low: 20 } }, /classification\.icons.*non-temperature profile/],
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
  assert.deepEqual(normalize(scale.scale), { min: 50, max: 86 });

  const table = internals.displayProfile(card, "temperature", fahrenheit);
  const warmTier = table.tiers.find((tier) => tier.score === 8);
  assert.equal(warmTier.min, 79, "26 °C must become the rounded 79 °F tier boundary");
  assert.equal(internals.temperatureIcon(card, 95, fahrenheit), "mdi:fire-alert");
  assert.equal(internals.temperatureIcon(card, 86, fahrenheit), "mdi:thermometer-high");
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
  assert.equal(neutral.color, "#B4B2A9");
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
  assert.equal(tone.score, 7);
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
    [{ ...customProfile, scale: { min: 12, max: 40, step: 2 } }, /classification\.scale/],
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
    }, /classification\.icons.*non-temperature profile/],
    [{ ...customProfile, icons: [{ min: 30, icon: "mdi:fire" }, { default: true, icon: "mdi:snowflake" }] }, /classification\.icons.*temperature profile/],
  ];

  for (const [classification, expected] of cases) {
    assert.throws(() => createTemperatureCard(classification), expected);
  }
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

// P1 review fix (post-2.30.0): a profile scoped to the PRIMARY's own kind
// (here temperature's "outdoor") used to throw as soon as ANY configured
// room had a different metric kind, because _buildEntityModel() probed
// that room's own kind against the same card-wide profile before AP-02's
// kind filter ever got a chance to exclude it. The card-wide profile must
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
  assert.equal(data.tone.score, 7); // 25°C falls in the outdoor profile's [22,26) "slightlyWarm" tier
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

// P2 review fix (post-2.30.0): _classificationProfileForDisplay() rounds
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

"use strict";

// Home Assistant calls setConfig() before hass on a first load and in the editor preview, and
// hass before setConfig() on a live edit. A classification profile the sensors cannot use is
// only decidable with both, so the card must end up the same either way: the default profile,
// one warning, no console error. Boundary: which profile applies is
// application/classification-policy.test.js's to pin; this file checks the lifecycle only.
// See internal dev doc §5 "Klassifikations-Rückfall".

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { HUMIDITY, TEMPERATURE_C, TEMPERATURE_F } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const HUMIDITY_PROFILE = {
  source: "custom",
  unit: "%",
  bands: { comfort: { min: 30, max: 70 }, optimal: { min: 40, max: 60 } },
  scale: { min: 0, max: 100, step: 10 },
  tiers: [
    { min: 70, score: 1, level: "Humid", zone: "outside" },
    { default: true, score: 0, level: "Normal", zone: "comfort" },
  ],
};

// 22.0 and 22.3 °C both round to 72 °F.
const COLLAPSING_IN_FAHRENHEIT = {
  source: "custom",
  unit: "°C",
  bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
  scale: { min: 16, max: 28, step: 2 },
  tiers: [
    { min: 24, score: 4, level: "A", color: "#cc4444", zone: "outside" },
    { min: 22.3, score: 3, level: "B", color: "#ccaa44", zone: "comfort" },
    { min: 22.0, score: 2, level: "C", color: "#44cc66", zone: "optimal" },
    { default: true, score: 1, level: "D", color: "#4488cc", zone: "outside" },
  ],
};

const CASES = [
  {
    name: "a named profile the measurement does not have",
    config: { entity: "sensor.avg", classification: "outdoor" },
    states: () => ({ "sensor.avg": mkState("sensor.avg", 50, HUMIDITY) }),
    warning: '"outdoor" is not a classification profile for Humidity. Using default: indoor.',
  },
  {
    name: "a custom profile written in another measurement's unit",
    config: { entity: "sensor.avg", classification: HUMIDITY_PROFILE },
    states: () => ({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) }),
    warning: 'classification.unit "%" does not fit Temperature. Using default: indoor.',
  },
  {
    name: "a custom profile the display unit cannot represent",
    config: { entity: "sensor.avg", classification: COLLAPSING_IN_FAHRENHEIT },
    states: () => ({ "sensor.avg": mkState("sensor.avg", 72, TEMPERATURE_F) }),
    warning: "The custom profile cannot be shown in °F. Using default: indoor.",
  },
];

function recordErrors(body) {
  const view = env.window;
  const original = view.console.error;
  const errors = [];
  view.console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    return { result: body(), errors };
  } finally {
    view.console.error = original;
  }
}

function hassFirst(config, states) {
  return env.createCard(config, mkHass(states));
}

function configFirst(config, states) {
  const el = env.document.createElement("room-climate-card");
  env.document.body.appendChild(el);
  el.setConfig(config);
  el.hass = mkHass(states);
  return el;
}

for (const entry of CASES) {
  test(`${entry.name}: the same card whichever arrives first`, () => {
    const one = recordErrors(() => hassFirst(entry.config, entry.states()));
    const other = recordErrors(() => configFirst(entry.config, entry.states()));
    for (const [order, { result: el, errors }] of [["hass first", one], ["config first", other]]) {
      assert.deepEqual(errors, [], `${order}: nothing reaches console.error`);
      assert.equal(el.shadowRoot.querySelector(".rtc-warning-text")?.textContent, entry.warning, order);
      assert.equal(el.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "data", `${order}: the card has data`);
    }
    assert.equal(one.result.shadowRoot.innerHTML, other.result.shadowRoot.innerHTML);
    env.cleanup(one.result);
    env.cleanup(other.result);
  });
}

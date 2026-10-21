"use strict";

// A language change reaches every text the card shows. A change that arrives with `hass` or
// with the `language` option patches the mounted card in place; afterwards its DOM must equal
// a card rendered fresh in that language, for every supported language and for each card shape
// that carries language-dependent text: both scale views, the extremes view, the room grid, the
// "no view available" hint and the "everything is hidden" hint. jsdom has no layout, so the
// label forms the layout would pick are the long ones on both sides of the comparison. See
// internal dev doc §4 "Render-Primitive-/Composition-Vertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");
// Every supported language is iterated here, so the matrix imports the list rather than copying it.
const { LANGUAGES } = require("../../manifests/product-surface.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const STATES = {
  "sensor.avg": mkState("sensor.avg", 21.4, TEMPERATURE_C),
  "sensor.r1": mkState("sensor.r1", 20.1, TEMPERATURE_C),
  "sensor.r2": mkState("sensor.r2", 23.2, TEMPERATURE_C),
  "sensor.r3": mkState("sensor.r3", "unavailable", TEMPERATURE_C),
  "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  "sensor.trend": mkState("sensor.trend", 0.4, { unit_of_measurement: "°C/h" }),
};
const hassIn = (language) => mkHass({ ...STATES }, language);

const ROOMS = [{ entity: "sensor.r1", name: "Living room" }, { entity: "sensor.r2", name: "Bedroom" }, { entity: "sensor.r3" }];
const SHAPES = {
  "range scale": { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] },
  "every view and the room grid": { entity: "sensor.avg", range_entity: "sensor.range", trend_entity: "sensor.trend", rooms: ROOMS },
  "no view available": { entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] },
  "everything hidden": { entity: "sensor.avg", show: { icon: false, title: false, subtitle: false, pill: false, panel: false, rooms: false } },
};

// The slide animation's delay (inline and in the instance stylesheet) follows the clock, not the language.
const markup = (el) => el.shadowRoot.innerHTML.replace(/animation-delay:\s*-?\d+ms/g, "animation-delay: <clock>");

function assertPatchedLikeFresh(shape, language, patched, fresh) {
  assert.equal(markup(patched), markup(fresh), `${shape}: patched to ${language} differs from a fresh ${language} card`);
}

for (const [shape, config] of Object.entries(SHAPES)) {
  test(`${shape}: a language change through hass patches every text into the new language`, () => {
    for (const language of LANGUAGES.filter((code) => code !== "en")) {
      const patched = env.createCard(config, hassIn("en"));
      const root = patched.shadowRoot.querySelector(".rtc-root");
      patched.hass = hassIn(language);
      assert.equal(patched.shadowRoot.querySelector(".rtc-root"), root, `${shape} -> ${language}: patched, not rebuilt`);
      const fresh = env.createCard(config, hassIn(language));
      assertPatchedLikeFresh(shape, language, patched, fresh);
      env.cleanup(patched);
      env.cleanup(fresh);
    }
  });

  test(`${shape}: a language change through the language option patches every text into the new language`, () => {
    for (const language of LANGUAGES.filter((code) => code !== "en")) {
      const patched = env.createCard({ ...config, language: "en" }, hassIn("en"));
      const root = patched.shadowRoot.querySelector(".rtc-root");
      patched.setConfig({ ...config, language });
      assert.equal(patched.shadowRoot.querySelector(".rtc-root"), root, `${shape} -> ${language}: patched, not rebuilt`);
      const fresh = env.createCard({ ...config, language }, hassIn("en"));
      assertPatchedLikeFresh(shape, language, patched, fresh);
      env.cleanup(patched);
      env.cleanup(fresh);
    }
  });
}

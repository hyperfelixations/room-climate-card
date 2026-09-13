"use strict";

// setConfig() is all-or-nothing: a configuration it refuses leaves a running card exactly as
// it was — config, screen, timers and render bookkeeping. HA's live YAML editor calls
// setConfig() per keystroke, so refused calls are the norm. A fault only a render can find (a
// classification profile the sensors cannot use) is not a refusal: the card applies the
// measurement's default profile with a warning, whichever of setConfig() and hass comes first
// (config-order-invariance.test.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
let RENDER_PATH;

test.before(async () => {
  env = createTestEnvironment();
  ({ RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
});
test.after(() => env.cleanupAll());

const C = TEMPERATURE_C;

function runningCard() {
  return env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", name: "Kitchen" }, { entity: "sensor.r2", name: "Bedroom" }] },
    mkHass({
      "sensor.avg": mkState("sensor.avg", 22, C),
      "sensor.r1": mkState("sensor.r1", 20.5, C),
      "sensor.r2": mkState("sensor.r2", 23.5, C),
    })
  );
}

// Everything a refused setConfig() must leave untouched: config, screen, scheduled timers.
function observableState(card) {
  return {
    config: JSON.stringify(card._config, (key, value) => (typeof value === "function" ? "[Function]" : value)),
    color: card._computeViewModel().tone.color,
    html: card.shadowRoot.innerHTML,
    activeIndex: card._carousel.activeIndex,
    timerArmed: card._carousel.accessibilityTimerHandle !== null,
    renderPending: card._renderController.isRenderPending,
  };
}

// A typo of an option: refused before any value is read.
const REFUSED = { entity: "sensor.avg", pallete: "vivid" };
const REFUSAL = /^Invalid configuration: pallete is not an option of this card\. Did you mean palette\?$/;

// Valid on its own, impossible for this °C card — the mismatch is only decidable with entities.
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

test("a refused setConfig() leaves a running card exactly as it was", () => {
  const card = runningCard();
  const before = observableState(card);
  assert.equal(before.color, "#79A86C", "the card starts out classified and rendered");

  assert.throws(() => card.setConfig(REFUSED), { message: REFUSAL });

  const after = observableState(card);
  for (const key of Object.keys(before)) {
    assert.deepEqual(after[key], before[key], `${key} must be untouched by a refused setConfig()`);
  }
  env.cleanup(card);
});

// The render bookkeeping must be untouched too: the commit phase invalidates the data
// signature, so if it had run, an unchanged repeat would re-render instead of being skipped.
test("a refused setConfig() does not disturb the render bookkeeping", () => {
  const card = runningCard();
  const hass = card._hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "an unchanged repeat is skipped, so the card is settled");

  assert.throws(() => card.setConfig(REFUSED), { message: REFUSAL });

  card.hass = hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "still settled: nothing about the render state moved");
  env.cleanup(card);
});

// The card must still be usable — a refused keystroke may not cost the next, correct one.
test("a card that refused a configuration still accepts the next one", () => {
  const card = runningCard();
  assert.throws(() => card.setConfig(REFUSED), { message: REFUSAL });

  card.setConfig({ entity: "sensor.avg", classification: "outdoor" });
  assert.equal(card._config.classification.profile, "outdoor");
  assert.equal(card._computeViewModel().tone.color, "#9DA85A", "22 °C is one step above optimal outdoors");
  env.cleanup(card);
});

test("a profile the sensors cannot use is accepted on a running card, with a warning and the default profile", () => {
  const card = runningCard();
  card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE });
  assert.equal(card._config.classification.source, "custom", "accepted as written");
  assert.equal(
    card.shadowRoot.querySelector(".rtc-warning-text").textContent,
    'classification.unit "%" does not fit Temperature. Using default: indoor.'
  );
  assert.equal(card._computeViewModel().tone.color, "#79A86C", "classified with the default profile");
  env.cleanup(card);
});

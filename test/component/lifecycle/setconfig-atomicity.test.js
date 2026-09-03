"use strict";

// setConfig() is all-or-nothing, including for errors only a render can find. A
// classification profile is scoped to a measurement, and which measurement a card shows
// comes from its entities, so "profile in %, sensor in °C" is only decidable once both
// exist — the check lives in the model builders and throws. HA's live YAML editor calls
// setConfig() per keystroke, so a doomed call that committed before the render rejected it
// would leave the card dark until a full reload. Asserted end to end on a running card,
// the only state in which the bug is reachable.

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

// Everything a rejected setConfig() must leave untouched: config, screen, scheduled timers.
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

test("a rejected setConfig() leaves a running card exactly as it was", () => {
  const card = runningCard();
  const before = observableState(card);
  assert.equal(before.color, "#79A86C", "the card starts out classified and rendered");

  assert.throws(
    () => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }),
    /custom classification unit belongs to "humidity", not detected metric kind "temperature"/
  );

  const after = observableState(card);
  for (const key of Object.keys(before)) {
    assert.deepEqual(after[key], before[key], `${key} must be untouched by a rejected setConfig()`);
  }
  env.cleanup(card);
});

// The render bookkeeping must be untouched too: the commit phase invalidates the data
// signature, so if it had run, an unchanged repeat would re-render instead of being skipped.
test("a rejected setConfig() does not disturb the render bookkeeping", () => {
  const card = runningCard();
  const hass = card._hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "an unchanged repeat is skipped, so the card is settled");

  assert.throws(() => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }), /humidity/);

  card.hass = hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "still settled: nothing about the render state moved");
  env.cleanup(card);
});

// The card must still be usable — a rejected keystroke may not cost the next, correct one.
test("a card that rejected a configuration still accepts the next one", () => {
  const card = runningCard();
  assert.throws(() => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }), /humidity/);

  card.setConfig({ entity: "sensor.avg", classification: "outdoor" });
  assert.equal(card._config.classification.profile, "outdoor");
  assert.equal(card._computeViewModel().tone.color, "#9DA85A", "22 °C is one step above optimal outdoors");
  env.cleanup(card);
});

// The rehearsal runs the real render path, so it could leave memoized context or a
// deduplicated warning behind. It must not — for an accepted configuration either.
test("the rehearsal leaves no memoized state behind, accepted or rejected", () => {
  const card = runningCard();
  const before = { hass: card._metricContextCacheHass, config: card._metricContextCacheConfig };

  assert.throws(() => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }), /humidity/);
  assert.equal(card._metricContextCacheHass, before.hass, "rejected: the context cache key is untouched");
  assert.equal(card._metricContextCacheConfig, before.config);

  card.setConfig({ entity: "sensor.avg", classification: "fridge" });
  assert.equal(
    card._metricContextCacheConfig === card._config || card._metricContextCacheConfig === before.config,
    true,
    "accepted: the cache is either cold or keyed on the configuration now installed"
  );
  assert.notEqual(card._computeViewModel().tone.color, null);
  env.cleanup(card);
});

// With no hass there is nothing to rehearse against, so an entity-dependent failure is still accepted.
test("a configuration set before hass arrives is not rehearsed", () => {
  const card = env.document.createElement("room-climate-card");
  env.document.body.appendChild(card);
  card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE });
  assert.equal(card._config.classification.source, "custom", "accepted: there is nothing to check it against yet");
  card.remove();
});

"use strict";

// setConfig() is all-or-nothing, including for the errors that only a RENDER can find.
//
// Some configuration mistakes are invisible in the configuration alone. A classification
// profile is scoped to a measurement, and which measurement a card shows comes from its
// entities — so "this profile is written in %, but your sensor reads °C" cannot be
// decided until both are present. The check therefore lives in the model builders, and
// it throws.
//
// Home Assistant's live YAML editor calls setConfig() on every keystroke, so most calls
// during editing are invalid. If one of those committed its configuration before the
// render rejected it, the card would be left holding a configuration that every later
// render throws on too: one keystroke, and a working card is dark until the whole
// dashboard is reloaded. Nothing about the failure would point at the keystroke.
//
// So this file asserts the guarantee end to end on a card that is already RUNNING —
// which is the only state in which the bug is reachable, and the reason it hid for so
// long behind tests that only ever rejected a first configuration.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");

let env;
let RENDER_PATH;

test.before(async () => {
  env = createTestEnvironment();
  ({ RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
});
test.after(() => env.cleanupAll());

const C = { device_class: "temperature", unit_of_measurement: "°C" };

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

// Everything a rejected setConfig() must leave untouched, read the way a user would
// notice it: what is configured, what is on screen, and what is still scheduled.
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

// Valid on its own — it normalizes without complaint — and impossible for this card,
// which reads °C. The mismatch is only decidable once the entities are known.
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

// The other half of the guarantee, and the one a snapshot cannot see: the render
// bookkeeping must be untouched too. The commit phase invalidates the data signature, so
// if any of it had run, an unchanged repeat would re-render instead of being skipped.
test("a rejected setConfig() does not disturb the render bookkeeping", () => {
  const card = runningCard();
  const hass = card._hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "an unchanged repeat is skipped, so the card is settled");

  assert.throws(() => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }), /humidity/);

  card.hass = hass;
  assert.equal(card._render(), RENDER_PATH.SKIPPED, "still settled: nothing about the render state moved");
  env.cleanup(card);
});

// And the card must still be usable afterwards — a rejected keystroke may not cost the
// next, correct one.
test("a card that rejected a configuration still accepts the next one", () => {
  const card = runningCard();
  assert.throws(() => card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE }), /humidity/);

  card.setConfig({ entity: "sensor.avg", classification: "outdoor" });
  assert.equal(card._config.classification.profile, "outdoor");
  assert.equal(card._computeViewModel().tone.color, "#9DA85A", "22 °C is one step above optimal outdoors");
  env.cleanup(card);
});

// The rehearsal runs the real render path, so it could in principle leave the memoized
// context or the deduplicated warning behind. It must not — for an ACCEPTED
// configuration either, or the next render would read a context keyed on a
// configuration that is no longer installed.
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

// With no hass there is nothing to rehearse against — and nothing renders either, so a
// configuration that can only fail against entities must still be accepted here.
test("a configuration set before hass arrives is not rehearsed", () => {
  const card = env.document.createElement("room-climate-card");
  env.document.body.appendChild(card);
  card.setConfig({ entity: "sensor.avg", classification: HUMIDITY_PROFILE });
  assert.equal(card._config.classification.source, "custom", "accepted: there is nothing to check it against yet");
  card.remove();
});

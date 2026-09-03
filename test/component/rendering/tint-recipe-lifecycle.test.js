"use strict";

// When the tint adjustment is computed, and when it is merely looked up. The search behind
// it walks a few thousand candidates — fine once per palette, far too slow inside a render,
// which is exactly where a score changes (22.9 → 23.1 °C moves a ramp step and repaints the
// pill). So the whole ramp is prepared once, when palette and surface are both known, and
// everything after is a lookup. It reruns only when the palette/its config or the background
// changes — a sensor value never does, tier boundary or not. The proof is object identity:
// the table lives in one memo slot keyed on colours + surface, so a table still identical
// after a hundred updates was never rebuilt.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
let toneLegibility;
let adaptation;
let registry;

test.before(async () => {
  env = createTestEnvironment();
  toneLegibility = await import("../../../src/domain/classification/tone-legibility.js");
  adaptation = await import("../../../src/domain/classification/palettes/adaptation.js");
  registry = await import("../../../src/domain/classification/palettes/registry.js");
});
test.after(() => {
  env.cleanupAll();
});

const ROOMS = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }];
const statesAt = (value) =>
  mkHass({
    "sensor.avg": mkState("sensor.avg", value, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", value - 2, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", value + 2, TEMPERATURE_C),
  });

// The same table the card's domain model would ask for, through the same memo slot.
function tableOf(card, paletteName) {
  const surface = card._surface();
  const palette = adaptation.adaptPalette(registry.paletteForColor(paletteName), surface);
  const colors = [...palette.below, palette.optimal, ...palette.above, palette.invalid, registry.NEUTRAL_COLOR];
  return toneLegibility.tintRecipesFor(colors, surface);
}

test("a hundred readings, and a tier boundary crossed, do not rebuild it", () => {
  const card = env.createCard({ entity: "sensor.avg", rooms: ROOMS, palette: "yellow", auto_slide: false }, statesAt(22));
  const prepared = tableOf(card, "yellow");

  for (let step = 0; step < 100; step += 1) card.hass = statesAt(20 + step * 0.1);

  // 20.0-29.9 crosses every indoor tier, so the pill recoloured repeatedly — the case that must not cost a search.
  assert.equal(tableOf(card, "yellow"), prepared, "the prepared table was rebuilt during ordinary updates");
  env.cleanup(card);
});

test("the pill really did change colour along the way", () => {
  // Without this the test above would pass on a card that never repainted at all, which is a
  // different bug wearing the same result.
  const card = env.createCard({ entity: "sensor.avg", rooms: ROOMS, palette: "yellow", auto_slide: false }, statesAt(22));
  const inkAt = () => card.shadowRoot.querySelector(".rtc-root").getAttribute("style").match(/--tone-ink:([^;]+)/)[1];
  const optimal = inkAt();
  card.hass = statesAt(29);
  assert.notEqual(inkAt(), optimal, "the card showed the same ink for an optimal and a far-too-warm reading");
  env.cleanup(card);
});

test("a different background rebuilds it, because the answer depends on one", () => {
  const card = env.createCard({ entity: "sensor.avg", rooms: ROOMS, palette: "yellow", auto_slide: false }, statesAt(22));
  const onLight = tableOf(card, "yellow");

  card._platform.readBackgroundSamples = () => ["#1C1C1C"];
  card._surfaceCacheKey = undefined;
  assert.notEqual(tableOf(card, "yellow"), onLight, "the same table was reused on a different background");
  env.cleanup(card);
});

test("a different palette rebuilds it, because the colours are different", () => {
  const card = env.createCard({ entity: "sensor.avg", rooms: ROOMS, palette: "yellow", auto_slide: false }, statesAt(22));
  const yellow = tableOf(card, "yellow");
  assert.notEqual(tableOf(card, "navy"), yellow);
  env.cleanup(card);
});

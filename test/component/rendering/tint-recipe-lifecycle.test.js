"use strict";

// WHEN THE ADJUSTMENT IS WORKED OUT, AND WHEN IT IS MERELY LOOKED UP.
//
// The search behind it is a walk over a few thousand candidates — cheap enough to run once for
// a palette, far too expensive to run inside a render. And a render is exactly where a score
// changes: a reading moving from 22.9 °C to 23.1 °C moves the card from one ramp step to the
// next and repaints the pill in a different colour.
//
// So the whole ramp is prepared together, the moment the palette and the surface are both
// known, and everything after that is a lookup. What may make it run again is a change to one
// of its two inputs and nothing else:
//
//   the palette or its configuration     different colours to prepare
//   the background the card stands on    the same colours, a different answer
//
// A sensor value is neither, whether or not it crosses a tier boundary.
//
// THE PROOF IS OBJECT IDENTITY, and it is a complete one. The table lives in a single memo
// slot keyed on the colours and the surface together. Asking for it again with the same key
// returns the stored table without doing any work; asking with ANY other key replaces what is
// stored. So a table that is still the same object after a hundred updates was never rebuilt —
// there is no third possibility. A wall-clock budget would look like the stronger assertion
// and would in fact be the weaker one: a hundred renders of a card in jsdom cost far more than
// the search does, so the number would be dominated by everything except the thing under test.

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

// The table the card's own domain model would have asked for, fetched through the same single
// slot it filled. Identical by reference when the slot still holds it.
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

  // 20.0 through 29.9 crosses every tier the indoor profile has, so the pill changed colour
  // repeatedly along the way — which is the case that must not cost a search.
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

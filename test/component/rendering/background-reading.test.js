"use strict";

// How the card reads the surface it is painted on. Split from the measurement it feeds
// (test/unit/domain/palette-fit.test.js): the colour-on-background maths is pure, but where
// the card gets that background is a question about the assembled element and its platform
// adapter. A surface is two readings: the colours the card sits on, and the theme's text
// colour (the scale track and chip backgrounds are tints of the latter — see paint-roles.js).
// jsdom paints nothing, so these reach only the last rung of the ladder; the live reading is
// test/browser/visual/palette-fit-calibration.spec.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { scenario } = require("../../fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

test("the element reads the colour it is painted on, and falls back to the theme flag", () => {
  const built = scenario().rooms(2).build();
  const card = env.createCard(built.config, { ...built.hass, themes: { darkMode: true } });
  const surface = card._surface();
  assert.ok(Array.isArray(surface.samples) && surface.samples.length >= 1, JSON.stringify(surface));
  for (const sample of surface.samples) assert.match(sample, /^#[0-9A-Fa-f]{6}$/i, sample);
  // Null is a legitimate answer and not a failure: jsdom sets no text colour, and the roles
  // fall back to the card rather than inventing one.
  assert.ok(surface.text === null || /^#[0-9A-Fa-f]{6}$/i.test(surface.text), String(surface.text));
  env.cleanup(card);
});

test("the surface is read once and reused until it changes", () => {
  const built = scenario().rooms(1).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(card._surface(), card._surface(), "nothing changed, so nothing may be rebuilt");
  env.cleanup(card);
});

test("with no theme and nothing painted, the answer is Home Assistant's own default", () => {
  // jsdom paints nothing, so this is the last rung of the ladder; live reading: palette-fit-calibration.spec.js.
  const built = scenario().rooms(1).build();
  const card = env.createCard(built.config, built.hass);
  // normalize() because the card runs in its own V8 realm and assert/strict compares
  // prototypes — see load-card.jsdom.js.
  assert.deepEqual(normalize(card._surface().samples), ["#FFFFFF"]);
  env.cleanup(card);
});

test("the surface is part of what brings the card back for a repaint", async () => {
  const { entityDataSignature } = await import("../../../src/controllers/render/render-signatures.js");
  const { surfaceOf } = await import("../../../src/domain/classification/paint-roles.js");
  const args = {
    config: { entity: "sensor.avg", rooms: [], rotation_seconds: 8, slide_seconds: 0.4 },
    states: { "sensor.avg": { state: "22", last_updated: "T0" } },
    language: "en",
    activeViewIndex: 0,
  };
  assert.notEqual(
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"]) }),
    entityDataSignature({ ...args, surface: surfaceOf(["#1C1C1C"]) }),
    "switching theme changes no entity, so the signature is the only thing that can notice"
  );
  assert.notEqual(
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"]) }),
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF", "#000000"]) }),
    "a gradient is not the same background as its first stop"
  );
  // The text colour is the surface's second half; a theme can change it without touching the card background.
  assert.notEqual(
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"], "#212121") }),
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"], "#727272") }),
    "the track and the chip are tints of the text colour, so it changes what a step is painted on"
  );
  assert.notEqual(
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"]) }),
    entityDataSignature({ ...args, surface: surfaceOf(["#FFFFFF"], "#212121") }),
    "a theme that states its text colour is not the same surface as one that does not"
  );
});

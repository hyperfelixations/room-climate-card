"use strict";

// HOW THE CARD READS THE SURFACE IT IS PAINTED ON.
//
// Split from the measurement it feeds (test/unit/domain/palette-fit.test.js): what a colour
// looks like on a background is a pure calculation, and where the card gets that background
// from is a question about the assembled element, its platform adapter and the ladder between
// them. Different subjects, different layers, different files.
//
// A SURFACE IS TWO READINGS, not one. The colours the card sits on, and the theme's text
// colour — because the scale track and a room chip's background are tints of the latter, so a
// palette step painted on either is not painted on the card. See paint-roles.js.
//
// jsdom paints nothing, so what these can reach is the LAST rung of the ladder and the
// plumbing around it. The live reading — a card-mod colour applied after the first paint, a
// gradient, a translucent card composited onto its parent — needs a real CSSOM and lives in
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
  // jsdom paints nothing, so this exercises the last rung of the ladder rather than the
  // first. The live reading — including a card-mod override applied after the first paint —
  // needs a real CSSOM and lives in test/browser/visual/palette-fit-calibration.spec.js.
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
  // The text colour is the second half of the surface, and a theme can change it without
  // changing the card background at all — a light theme with near-black text and one with
  // grey text put the scale track in two different places.
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

"use strict";

// ONE COLOUR PER SCORE, AND ONLY THE TINT MOVES.
//
// The card paints a classification colour in five places: the scale marker, the accent line
// across the top, the status pill, the header icon and a room chip's direction mark — and the
// chip's own fill and border are that colour too. Two repairs act on that, and this file is
// about the line between them.
//
// The PALETTE repair (domain/classification/palettes/legible.js) may move the colour, and when
// it does it moves everywhere at once, because there is only one of it. The TINT repair
// (domain/classification/tone-legibility.js) may not: where a colour is readable as a marker
// and swallowed by its own 20% tint in the pill, what gets out of the way is the tint.
//
// This is the assembled card rather than the view-model modules, because the property being
// checked is that the two repairs meet correctly across four layers — the surface is read in
// the element, the palette is repaired in the domain model, and the tint is worked out in the
// presentation layer from the colour that came out of it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
let paletteFit;
let toneLegibility;
let paintRoles;
let color;
let oklch;

test.before(async () => {
  env = createTestEnvironment();
  paletteFit = await import("../../../src/domain/classification/palette-fit.js");
  toneLegibility = await import("../../../src/domain/classification/tone-legibility.js");
  paintRoles = await import("../../../src/domain/classification/paint-roles.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
});
test.after(() => {
  env.cleanupAll();
});

// Three rooms spread across the band, so the chips carry a cold step, an optimal one and a warm
// one — which is what makes the chip marks worth looking at.
const STATES = () =>
  mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 18.4, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 22.1, TEMPERATURE_C),
    "sensor.r3": mkState("sensor.r3", 26.8, TEMPERATURE_C),
  });

const ROOMS = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }];
const alphaOf = (rgba) => Number(rgba.match(/rgba\(([^)]+)\)/)[1].split(",")[3]);
const hexOfRgba = (rgba) => {
  const [r, g, b] = rgba.match(/rgba\(([^)]+)\)/)[1].split(",").map((part) => Number(part.trim()));
  return "#" + [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
};

test("the chip's fill, its border and its mark all carry the colour the palette ended up with", () => {
  // The supervisor's rule, as a test: if the palette repair moves a colour, everything painted
  // with that colour moves with it. A chip whose fill kept the old colour while its mark took
  // the new one would be two colours for one score.
  const element = env.createCard({ entity: "sensor.avg", palette: "lime", rooms: ROOMS }, STATES());
  const view = element._computeViewModel();

  for (const chip of view.rooms.chips) {
    if (chip.unavailable) continue;
    assert.match(chip.color, /^#[0-9A-F]{6}$/i, "a chip carries a resolved colour");
    assert.equal(hexOfRgba(chip.markBackground), chip.color.toUpperCase(), "the mark's tint is a tint of the chip's own colour");
    if (chip.out) {
      assert.equal(hexOfRgba(chip.background), chip.color.toUpperCase(), "and so is the fill of a chip outside the band");
      assert.equal(hexOfRgba(chip.border), chip.color.toUpperCase(), "and its border");
    }
  }
  env.cleanup(element);
});

test("a colour that reads on its own tint keeps the weight the design gave it", () => {
  // The common case, and the one that has to stay exact: nothing about a comfortable card
  // changes, down to the alpha in its custom properties.
  const element = env.createCard({ entity: "sensor.avg", rooms: ROOMS }, STATES());
  const view = element._computeViewModel();
  assert.equal(alphaOf(view.tone.soft), 0.2, "the status pill and the icon badge keep their 20%");
  // A room INSIDE the comfort band sits on the neutral chip, which is nearly the card — so its
  // mark has the whole separation the colour has and keeps the weight the design gave it. A
  // room outside the band sits on a tint of its own colour, and pastel's coldest steps do need
  // the thinner tint on a white card; that case is the next test's subject.
  for (const chip of view.rooms.chips) {
    if (chip.unavailable || chip.out) continue;
    assert.equal(alphaOf(chip.markBackground), 0.18, chip.entity + ": the mark keeps its 18%");
  }
  env.cleanup(element);
});

test("a colour its own tint would swallow gets a thinner tint, and the colour itself does not move", () => {
  // `palette: lime` on a light card. The middle is legible where it is painted on the card — the
  // scale marker reads — and unreadable in the pill, because the pill paints it on 20% of
  // itself. The repair is the pill's, not the palette's.
  const element = env.createCard({ entity: "sensor.avg", palette: "lime", rooms: ROOMS }, STATES());
  const view = element._computeViewModel();
  const surface = element._surface();
  const card = paintRoles.pointOf(surface.samples[0], surface.text).card;

  const tone = view.tone;
  assert.ok(alphaOf(tone.soft) < 0.2, "the pill's tint had to come down, got " + tone.soft);
  assert.equal(hexOfRgba(tone.soft), tone.color.toUpperCase(), "and it is still a tint of the same colour");

  // The colour is the one the palette produced, unchanged by anything the pill needed.
  const required = paletteFit.requiredSeparationOf("toneLabel");
  assert.equal(
    alphaOf(tone.soft),
    toneLegibility.legibleTintAlpha(tone.color, card, 0.2, required),
    "the alpha is the one the model computes for this colour on this card"
  );
  env.cleanup(element);
});

test("nothing about the tint depends on the palette having been repaired", () => {
  // The two repairs are independent, and this is what says so. `palette: lime` on a light card
  // has BOTH: its palest steps cannot be seen at all, so the ramp is rebuilt; and its middle is
  // fine as a marker and not as a word, so the pill thins its tint. The second happens whether
  // or not the first did — it is a question about where a colour is painted, not about where it
  // came from.
  const light = env.createCard({ entity: "sensor.avg", palette: "lime", rooms: ROOMS }, STATES());
  const lightView = light._computeViewModel();
  const lightSurface = light._surface();
  env.cleanup(light);

  // The same palette on a card the ramp suits: the colour is untouched, and so is the tint.
  const green = env.createCard({ entity: "sensor.avg", palette: "#17A93F", rooms: ROOMS }, STATES());
  const greenView = green._computeViewModel();
  assert.equal(alphaOf(greenView.tone.soft), 0.2);
  env.cleanup(green);

  assert.deepEqual([...lightSurface.samples], ["#FFFFFF"], "the jsdom harness paints a light card");
  assert.ok(alphaOf(lightView.tone.soft) < 0.2);
});

test("a colour no tint can rescue takes the thinnest one there is, rather than pretending", () => {
  // The honest limit, on the card rather than in the unit. At no tint at all the colour sits on
  // the card itself, and the pill asks for nearly half again what a scale marker does — so a
  // colour between those two bars is readable as a marker and not as a word. The card does what
  // it can and stops there; moving the colour would be repairing the wrong thing.
  const element = env.createCard({ entity: "sensor.avg", palette: "yellow", rooms: ROOMS }, STATES());
  const view = element._computeViewModel();
  const surface = element._surface();
  const card = surface.samples[0];

  const required = paletteFit.requiredSeparationOf("toneLabel");
  const bestPossible = oklch.screenDistance(view.tone.color, color.compositeOver(view.tone.color, 0, card));
  const alpha = alphaOf(view.tone.soft);
  const reached = oklch.screenDistance(view.tone.color, color.compositeOver(view.tone.color, alpha, card));

  if (bestPossible < required) {
    assert.equal(alpha, 0, "with nothing left to give, the tint goes all the way out of the way");
  } else {
    assert.ok(reached >= required - 1e-6, "and where it can be read, it is: " + reached.toFixed(4) + " of " + required.toFixed(4));
  }
  // Either way the colour is the palette's, not something the pill invented.
  assert.equal(hexOfRgba(view.tone.soft), view.tone.color.toUpperCase());
  env.cleanup(element);
});

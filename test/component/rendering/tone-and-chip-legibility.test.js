"use strict";

// One colour per score, and one adjustment for the three places that paint a colour on a
// tint of itself. The card paints a classification colour in several places (scale marker,
// accent line, status pill, header icon, chip direction mark, chip fill/border). The palette
// repair (palettes/legible.js) may move the colour everywhere at once; the tint repair
// (tone-legibility.js) acts only on the three self-tinted places and produces one adjustment
// all three apply unchanged. Tested on the assembled card because the property is that four
// layers meet correctly: the surface is read in the element, palette + adjustment in the
// domain model, and presentation only looks the answer up.

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

// Three rooms across the band: a cold, an optimal and a warm chip step.
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
const toneStyleOf = (card) => card.shadowRoot.querySelector(".rtc-root").getAttribute("style");
const propertyOf = (style, name) => style.match(new RegExp(`${name}:([^;]+)`))[1];

function cardWith(palette) {
  const built = { entity: "sensor.avg", rooms: ROOMS, palette, views: [{ type: "scale" }], auto_slide: false };
  return env.createCard(built, STATES());
}

test("the pill, the icon and the chip mark all carry the same ink", () => {
  // --tone-ink (pill text, icon glyph) and --room-color (chip mark) must be the same for the same score.
  const card = cardWith("yellow");
  const ink = propertyOf(toneStyleOf(card), "--tone-ink").trim();

  // Average 22 °C is the optimal tier, same as the middle room, so its chip mark matches the header.
  const chips = [...card.shadowRoot.querySelectorAll(".rtc-room-chip")];
  const middle = chips.find((chip) => chip.getAttribute("data-entity") === "sensor.r2");
  assert.equal(propertyOf(middle.getAttribute("style"), "--room-color").trim(), ink);
  env.cleanup(card);
});

test("the tint of all three moves by the same factor, from their own weights", () => {
  // The pill keeps its 0.20 and the chip mark its 0.18; the one factor multiplies each. An absolute alpha would merge the constants.
  const card = cardWith("yellow");
  const soft = alphaOf(propertyOf(toneStyleOf(card), "--tone-soft"));
  const middle = [...card.shadowRoot.querySelectorAll(".rtc-room-chip")].find(
    (chip) => chip.getAttribute("data-entity") === "sensor.r2"
  );
  const mark = alphaOf(propertyOf(middle.getAttribute("style"), "--room-mark-bg"));

  const softDefault = paintRoles.TINT_ALPHAS.toneSoft;
  const markDefault = paintRoles.TINT_ALPHAS.chipMark;
  assert.ok(
    Math.abs(soft / softDefault - mark / markDefault) < 1e-6,
    `pill factor ${(soft / softDefault).toFixed(4)} vs chip-mark factor ${(mark / markDefault).toFixed(4)}`
  );
  env.cleanup(card);
});

test("the marker keeps the palette's own colour, and so does the chip's fill", () => {
  // --tone-color (accent line, focus ring) and the chip fill/border are the palette colour; none is self-tinted, so none follows the ink.
  const card = cardWith("yellow");
  const style = toneStyleOf(card);
  const paletteColour = propertyOf(style, "--tone-color").trim();
  assert.equal(hexOfRgba(propertyOf(style, "--tone-band")), paletteColour, "the optimal band is the palette colour");
  assert.equal(hexOfRgba(propertyOf(style, "--tone-soft")), paletteColour, "and so is the tint the pill sits on");

  const outer = [...card.shadowRoot.querySelectorAll(".rtc-room-chip")].find(
    (chip) => chip.getAttribute("data-entity") === "sensor.r3"
  );
  const chipStyle = outer.getAttribute("style");
  assert.equal(
    hexOfRgba(propertyOf(chipStyle, "--room-bg")),
    hexOfRgba(propertyOf(chipStyle, "--room-mark-bg")),
    "a chip's fill and the tint under its mark are the same colour"
  );
  assert.equal(hexOfRgba(propertyOf(chipStyle, "--room-border")), hexOfRgba(propertyOf(chipStyle, "--room-bg")));
  env.cleanup(card);
});

test("palette: yellow on a light card becomes readable in all three places", () => {
  // The reported case: pure yellow on a 20% tint of itself over white is nearly the same colour twice.
  const card = cardWith("yellow");
  const style = toneStyleOf(card);
  const paletteColour = propertyOf(style, "--tone-color").trim();
  const ink = propertyOf(style, "--tone-ink").trim();
  const surface = card._surface();
  const point = paintRoles.pointOf(surface.samples[0], surface.text);
  const required = paletteFit.requiredSeparationOf("chipMark");

  const pillBackdrop = color.compositeOver(paletteColour, alphaOf(propertyOf(style, "--tone-soft")), point.card);
  assert.ok(
    oklch.screenDistance(ink, pillBackdrop) >= required,
    `the pill reaches ${oklch.screenDistance(ink, pillBackdrop).toFixed(3)} of ${required.toFixed(3)}`
  );

  const outer = [...card.shadowRoot.querySelectorAll(".rtc-room-chip")].find(
    (chip) => chip.getAttribute("data-entity") === "sensor.r3"
  );
  const chipStyle = outer.getAttribute("style");
  const chipColour = hexOfRgba(propertyOf(chipStyle, "--room-bg"));
  const chipSurface = color.compositeOver(chipColour, alphaOf(propertyOf(chipStyle, "--room-bg")), point.card);
  const markBackdrop = color.compositeOver(chipColour, alphaOf(propertyOf(chipStyle, "--room-mark-bg")), chipSurface);
  const markInk = propertyOf(chipStyle, "--room-color").trim();
  assert.ok(
    oklch.screenDistance(markInk, markBackdrop) >= required,
    `the chip mark reaches ${oklch.screenDistance(markInk, markBackdrop).toFixed(3)} of ${required.toFixed(3)}`
  );
  env.cleanup(card);
});

test("the ink is the same hue as the colour it stands for", () => {
  // Whatever the pill shows must be recognisably the colour of the marker beside it.
  for (const palette of ["yellow", "gold", "navy", "deeppink"]) {
    const card = cardWith(palette);
    const style = toneStyleOf(card);
    const before = oklch.hexToOklch(propertyOf(style, "--tone-color").trim());
    const after = oklch.hexToOklch(propertyOf(style, "--tone-ink").trim());
    if (before.chroma >= 0.01 && after.chroma >= 0.01) {
      assert.ok(Math.abs(after.hue - before.hue) < 1, `${palette}: hue drifted ${(after.hue - before.hue).toFixed(2)}°`);
    }
    env.cleanup(card);
  }
});

test("a written-out palette keeps its ramp exactly, and still gets a readable pill", () => {
  // The repair touches the recipe, never the palette: a YAML palette is on screen as typed; only the pill's ink may differ.
  const card = cardWith({ optimal: "FFFF00", above: "DFDF00, A3A300", below: "FFFFAA, FFFFDD" });
  const style = toneStyleOf(card);
  assert.equal(propertyOf(style, "--tone-color").trim(), "#FFFF00", "the colour the user typed, untouched");
  assert.equal(hexOfRgba(propertyOf(style, "--tone-band")), "#FFFF00");

  const surface = card._surface();
  const point = paintRoles.pointOf(surface.samples[0], surface.text);
  const backdrop = color.compositeOver("#FFFF00", alphaOf(propertyOf(style, "--tone-soft")), point.card);
  const ink = propertyOf(style, "--tone-ink").trim();
  assert.ok(
    oklch.screenDistance(ink, backdrop) >= paletteFit.requiredSeparationOf("chipMark"),
    "the pill of a hand-written palette is readable too"
  );
  env.cleanup(card);
});

test("a palette that needs nothing is left completely alone", () => {
  // A card whose colours are comfortable must be bit-for-bit unchanged, ink included.
  const card = cardWith("vivid");
  const style = toneStyleOf(card);
  assert.equal(propertyOf(style, "--tone-ink").trim(), propertyOf(style, "--tone-color").trim());
  assert.equal(alphaOf(propertyOf(style, "--tone-soft")), paintRoles.TINT_ALPHAS.toneSoft);
  for (const chip of card.shadowRoot.querySelectorAll(".rtc-room-chip")) {
    const chipStyle = chip.getAttribute("style");
    assert.equal(alphaOf(propertyOf(chipStyle, "--room-mark-bg")), paintRoles.TINT_ALPHAS.chipMark);
  }
  env.cleanup(card);
});

test("the no-data card carries its neutral colour at both names", () => {
  // Nothing to classify, nothing to adjust; the neutral grey must still arrive as a complete tone.
  const card = env.createCard({ entity: "sensor.avg", rooms: ROOMS }, mkHass({}));
  const style = toneStyleOf(card);
  assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "no-data");
  assert.match(propertyOf(style, "--tone-ink").trim(), /^#[0-9A-F]{6}$/i);
  assert.equal(propertyOf(style, "--tone-ink").trim(), propertyOf(style, "--tone-color").trim());
  env.cleanup(card);
});

test("the adjustment is prepared for every score, not for the one on screen", () => {
  // A boundary crossing changes the pill colour, but that is a lookup: the table covers the whole ramp, so 22.9 -> 23.1 costs nothing.
  const surface = env.createCard({ entity: "sensor.avg", rooms: ROOMS, palette: "yellow" }, STATES())._surface();
  const registry = require("../../../src/domain/classification/palettes/registry.js");
  return import("../../../src/domain/classification/palettes/adaptation.js").then((adaptation) => {
    const palette = adaptation.adaptPalette(registry.paletteForColor("yellow"), surface);
    const ramp = [...palette.below, palette.optimal, ...palette.above, palette.invalid];
    const recipes = toneLegibility.tintRecipesFor([...ramp, "#7F8792"], surface);
    for (const step of ramp) {
      assert.ok(recipes.has(step), `no recipe was prepared for ${step}`);
    }
  });
});

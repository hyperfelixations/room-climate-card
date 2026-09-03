"use strict";

// The tint recipe: the status pill, header icon and chip direction mark each paint a palette
// colour on a tint of itself, so the legibility adjustment is computed once and applied to
// all three. This file is about that one computation. Its invariants: hue never moves;
// lightness, chroma and tint move in whichever direction is the smaller answer; a
// comfortable colour comes back by identity; caps forbid reaching for contrast; the answer
// clears a target above the floor, not the floor itself. Every colour below is one a real
// palette produces after adaptation.
// Boundary: that the three places receive the same answer is
// test/component/rendering/tone-and-chip-legibility.test.js. See internal dev doc §5 "Die
// legible-Anpassungsstrategie" and §5 "Tönungsanpassung von Pille, Icon und Chipmarke".

const test = require("node:test");
const assert = require("node:assert/strict");

let tone;
let oklch;
let color;
let paletteFit;
let roles;

test.before(async () => {
  tone = await import("../../../src/domain/classification/tone-legibility.js");
  oklch = await import("../../../src/core/oklch.js");
  color = await import("../../../src/core/color.js");
  paletteFit = await import("../../../src/domain/classification/palette-fit.js");
  roles = await import("../../../src/domain/classification/paint-roles.js");
});

const LIGHT = "#FFFFFF";
const DARK = "#1C1C1C";

// What the mechanic itself is measured on: the colour on a tint of itself over the card.
function separationOf(recipe, paletteColor, card) {
  const search = tone.TINT_SEARCH;
  const tint = search.structuralTint + (1 - search.structuralTint) * search.recipeTint * recipe.tintFactor;
  return oklch.screenDistance(recipe.ink, color.compositeOver(paletteColor, tint, card));
}

test("the hue never moves, on any colour, on either theme", () => {
  // A repair that bends the hue has replaced the colour, and the marker beside it is still
  // the old one.
  const hues = [];
  for (const card of [LIGHT, DARK]) {
    for (const hex of ["#FFFF00", "#FFD700", "#00FF00", "#0020A3", "#008080", "#FF1493", "#B7B7B7", "#FFA500"]) {
      const recipe = tone.legibleTintRecipe(hex, card);
      if (recipe.ink === hex) continue;
      const before = oklch.hexToOklch(hex);
      const after = oklch.hexToOklch(recipe.ink);
      // Achromatic colours have no hue to preserve.
      if (before.chroma < 0.01 || after.chroma < 0.01) continue;
      hues.push([hex, card, Math.abs(after.hue - before.hue)]);
    }
  }
  assert.ok(hues.length >= 6, `only ${hues.length} colours moved at all`);
  for (const [hex, card, drift] of hues) {
    // The Oklch round trip is exact to well under a degree; more is a deliberate move.
    assert.ok(drift < 1, `${hex} on ${card} drifted ${drift.toFixed(2)}° of hue`);
  }
});

test("lightening wins where lightening is the smaller move", () => {
  // `palette: yellow` at its deep end on the dark theme, a dark olive on near-black: nowhere
  // darker helps, so the answer goes up.
  const recipe = tone.legibleTintRecipe("#686800", DARK);
  const before = oklch.hexToOklch("#686800");
  const after = oklch.hexToOklch(recipe.ink);
  assert.ok(after.lightness > before.lightness, `${recipe.ink} is not lighter than #686800`);
});

test("darkening wins where darkening is the smaller move", () => {
  // The same palette at its middle on the light theme: bright yellow text on a pale yellow
  // tint over a white card.
  const recipe = tone.legibleTintRecipe("#DFDF00", LIGHT);
  const before = oklch.hexToOklch("#DFDF00");
  const after = oklch.hexToOklch(recipe.ink);
  assert.ok(after.lightness < before.lightness, `${recipe.ink} is not darker than #DFDF00`);
});

test("saturation moves in whichever direction is part of the smaller answer", () => {
  // Both directions occur: pure yellow loses chroma going darker (the gamut has none to give
  // there), a washed-out yellow gains it.
  const deeper = oklch.hexToOklch(tone.legibleTintRecipe("#FFFF00", LIGHT).ink);
  assert.ok(deeper.chroma < oklch.hexToOklch("#FFFF00").chroma, "pure yellow kept its chroma");

  const richer = oklch.hexToOklch(tone.legibleTintRecipe("#F9FC9F", LIGHT).ink);
  assert.ok(richer.chroma > oklch.hexToOklch("#F9FC9F").chroma, "a washed-out yellow gained no chroma");
});

test("the tint moves in both directions too, and thinning it is not the default", () => {
  const thinner = tone.legibleTintRecipe("#FDFE5B", LIGHT);
  assert.ok(thinner.tintFactor < 1, `expected a thinner tint, got ${thinner.tintFactor}`);

  // Upwards is not a mistake: with the ink moved away from the colour, a stronger tint of the
  // original colour is further from the ink.
  const stronger = tone.legibleTintRecipe("#00001B", DARK);
  assert.ok(stronger.tintFactor > 1, `expected a stronger tint, got ${stronger.tintFactor}`);

  // The tint is not reached for first: over a ramp it stays at its designed weight more often
  // than it moves, and the ink does the work. This is `palette: yellow` on a white card,
  // after palette adaptation has made its steps readable as markers.
  const ramp = ["#A3A57F", "#C7C96C", "#ECED44", "#FFFF00", "#DFDF00", "#C1C100", "#A3A300", "#858500", "#686800"];
  const untouched = ramp.filter((hex) => tone.legibleTintRecipe(hex, LIGHT).tintFactor === 1).length;
  assert.ok(untouched >= ramp.length / 2, `the tint moved on ${ramp.length - untouched} of ${ramp.length}`);
});

test("a colour that is already comfortable comes back untouched", () => {
  for (const hex of ["#686800", "#858500", "#A3A300"]) {
    const recipe = tone.legibleTintRecipe(hex, LIGHT);
    assert.equal(recipe.ink, hex, `${hex} was moved for no reason`);
    assert.equal(recipe.tintFactor, 1);
  }
});

test("with nothing to measure against, nothing is claimed", () => {
  // Several callers have no surface, including the render path before the first paint.
  assert.deepEqual({ ...tone.legibleTintRecipe("#FFFF00", null) }, { ink: "#FFFF00", tintFactor: 1 });
  assert.deepEqual({ ...tone.legibleTintRecipe(null, LIGHT) }, { ink: null, tintFactor: 1 });
});

test("it clears a margin above the floor rather than sitting on it", () => {
  const floor = paletteFit.requiredSeparationOf("chipMark");
  const target = floor * tone.TINT_SEARCH.comfort;
  assert.ok(tone.TINT_SEARCH.comfort > 1, "the target must be above the floor, or this is the floor");

  let checked = 0;
  for (const card of [LIGHT, DARK]) {
    for (const hex of ["#FFFF00", "#DFDF00", "#FFD700", "#0020A3", "#B7B7B7", "#FF1493", "#00FF00"]) {
      const recipe = tone.legibleTintRecipe(hex, card);
      const separation = separationOf(recipe, hex, card);
      assert.ok(separation >= target - 1e-9, `${hex} on ${card} reached only ${separation.toFixed(3)} of ${target.toFixed(3)}`);
      checked += 1;
    }
  }
  assert.equal(checked, 14);
});

test("it does not reach for contrast it was not asked for", () => {
  // The trivial answer to legibility is black text on an opaque fill; the caps forbid it.
  // Nothing lands at the ends of the lightness range, and no tint exceeds the search budget.
  const search = tone.TINT_SEARCH;
  const maxFactor = 1 + search.tintCapUp * search.tintStep;
  const minFactor = Math.max(0, 1 - search.tintCapDown * search.tintStep);
  for (const card of [LIGHT, DARK, "#808080"]) {
    for (const hex of ["#FFFF00", "#FFD700", "#00FF00", "#0020A3", "#008080", "#FF1493", "#B7B7B7", "#FFFFFF", "#000000"]) {
      const recipe = tone.legibleTintRecipe(hex, card);
      const before = oklch.hexToOklch(hex);
      const after = oklch.hexToOklch(recipe.ink);
      // The tolerance is the gamut round trip, not slack in the cap.
      assert.ok(
        Math.abs(after.lightness - before.lightness) <= search.lightnessCap * search.lightnessStep + 0.01,
        `${hex} on ${card} moved ${(after.lightness - before.lightness).toFixed(3)} of lightness`
      );
      assert.ok(recipe.tintFactor <= maxFactor + 1e-9 && recipe.tintFactor >= minFactor - 1e-9, `factor ${recipe.tintFactor}`);
    }
  }
});

test("the same question always gives the same answer, and the same frozen object shape", () => {
  const once = tone.legibleTintRecipe("#FFFF00", LIGHT);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const again = tone.legibleTintRecipe("#FFFF00", LIGHT);
    assert.equal(again.ink, once.ink);
    assert.equal(again.tintFactor, once.tintFactor);
  }
  assert.equal(Object.isFrozen(once), true, "a recipe is shared across three places and must not be editable");
});

test("a table is built once for a palette and reused by value", () => {
  const surface = roles.surfaceOf([LIGHT], "#212121");
  const colors = ["#FFFF00", "#DFDF00", "#A3A300"];
  const first = tone.tintRecipesFor(colors, surface);
  assert.equal(tone.tintRecipesFor([...colors], surface), first, "the same colours and surface must not rebuild");
  assert.notEqual(tone.tintRecipesFor(colors, roles.surfaceOf([DARK], "#E1E1E1")), first, "a different background must");
  assert.notEqual(tone.tintRecipesFor([...colors, "#000000"], surface), first, "a different palette must");
});

test("a colour nobody prepared a recipe for is left exactly as it is", () => {
  // A tier's own hex, an integration's value_color, a caller with no surface: the card leaves
  // colours it was given alone.
  const surface = roles.surfaceOf([LIGHT], "#212121");
  const recipes = tone.tintRecipesFor(["#FFFF00"], surface);
  assert.deepEqual({ ...tone.tintRecipeFor(recipes, "#123456") }, { ink: "#123456", tintFactor: 1 });
  assert.deepEqual({ ...tone.tintRecipeFor(null, "#123456") }, { ink: "#123456", tintFactor: 1 });
});

test("the whole table for a palette costs a few milliseconds, once", () => {
  // Runs once per palette and surface, never during a later render.
  const surface = roles.surfaceOf(["#808080"], null);
  const ramp = ["#3A8B8B", "#4A9B9B", "#5AABAB", "#008080", "#007070", "#006060", "#005050", "#B7B7B7", "#FFFF00", "#0020A3", "#FF1493", "#7F8792"];
  const started = process.hrtime.bigint();
  tone.tintRecipesFor(ramp, surface);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 250, `a full table took ${ms.toFixed(0)} ms`);
});

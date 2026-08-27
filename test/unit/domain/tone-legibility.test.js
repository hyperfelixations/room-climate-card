"use strict";

// THE ONE MECHANIC, AND WHAT IT IS NOT ALLOWED TO DO.
//
// Three places on the card paint a palette colour at full strength on a tint of ITSELF: the
// status pill, the header icon and a room chip's direction mark. They share one way of being
// painted, so the adjustment is worked out ONCE and applied to all three unchanged — this file
// is about that one computation. That the three actually receive the same answer is a question
// about the assembled card and lives in test/component/rendering/tone-and-chip-legibility.test.js.
//
// The invariants below are the whole specification, and each one has a case behind it rather
// than a hypothesis:
//
//   hue never moves          the colour must still be the colour the marker shows
//   both directions, thrice  lighter and darker, more and less saturated, thinner and
//                            stronger tint — the answer depends on the colour, not on a rule
//                            of thumb about which way to go
//   nothing already fine     a comfortable colour comes back by identity, so a card that never
//                            had a problem is bit for bit what it was
//   no reaching for contrast the caps exist because the cheapest way to pass any threshold is
//                            near-black text on an opaque fill, and that is not this card
//   a margin, not a boundary the floor is the role's own separation; the answer clears a
//                            target ABOVE it, so it does not sit where "passes" and "is
//                            comfortable to read" part company
//
// Every colour below is one an actual palette produces. The mechanic runs AFTER the palette
// adaptation, so a colour that reaches it has already been made readable as a marker — feeding
// it raw ramp ends would test a case the card cannot present.

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
  // The hard invariant. A repair that bends the hue has not repaired the pill, it has replaced
  // the colour — and the marker beside it would still be the old one.
  const hues = [];
  for (const card of [LIGHT, DARK]) {
    for (const hex of ["#FFFF00", "#FFD700", "#00FF00", "#0020A3", "#008080", "#FF1493", "#B7B7B7", "#FFA500"]) {
      const recipe = tone.legibleTintRecipe(hex, card);
      if (recipe.ink === hex) continue;
      const before = oklch.hexToOklch(hex);
      const after = oklch.hexToOklch(recipe.ink);
      // Achromatic colours have no hue to preserve — their angle is rounding noise, and both
      // ends of the comparison would be noise.
      if (before.chroma < 0.01 || after.chroma < 0.01) continue;
      hues.push([hex, card, Math.abs(after.hue - before.hue)]);
    }
  }
  assert.ok(hues.length >= 6, `only ${hues.length} colours moved at all`);
  for (const [hex, card, drift] of hues) {
    // The round trip through Oklch and back to eight-bit channels is exact to well under a
    // degree; anything larger is a hue that was deliberately moved.
    assert.ok(drift < 1, `${hex} on ${card} drifted ${drift.toFixed(2)}° of hue`);
  }
});

test("lightening wins where lightening is the smaller move", () => {
  // `palette: yellow` at its deep end on the dark theme: a dark olive on near-black. There is
  // nowhere darker to go that helps, and the answer goes up.
  const recipe = tone.legibleTintRecipe("#686800", DARK);
  const before = oklch.hexToOklch("#686800");
  const after = oklch.hexToOklch(recipe.ink);
  assert.ok(after.lightness > before.lightness, `${recipe.ink} is not lighter than #686800`);
});

test("darkening wins where darkening is the smaller move", () => {
  // The same palette at its own middle on the light theme, which is the case the supervisor
  // reported: bright yellow text on a pale yellow tint over a white card.
  const recipe = tone.legibleTintRecipe("#DFDF00", LIGHT);
  const before = oklch.hexToOklch("#DFDF00");
  const after = oklch.hexToOklch(recipe.ink);
  assert.ok(after.lightness < before.lightness, `${recipe.ink} is not darker than #DFDF00`);
});

test("saturation moves in whichever direction is part of the smaller answer", () => {
  // Both directions occur, and neither is a rule: pure yellow loses chroma on the way down
  // because the gamut has none to give at that lightness, and a washed-out yellow gains it.
  const deeper = oklch.hexToOklch(tone.legibleTintRecipe("#FFFF00", LIGHT).ink);
  assert.ok(deeper.chroma < oklch.hexToOklch("#FFFF00").chroma, "pure yellow kept its chroma");

  const richer = oklch.hexToOklch(tone.legibleTintRecipe("#F9FC9F", LIGHT).ink);
  assert.ok(richer.chroma > oklch.hexToOklch("#F9FC9F").chroma, "a washed-out yellow gained no chroma");
});

test("the tint moves in both directions too, and thinning it is not the default", () => {
  const thinner = tone.legibleTintRecipe("#FDFE5B", LIGHT);
  assert.ok(thinner.tintFactor < 1, `expected a thinner tint, got ${thinner.tintFactor}`);

  // Upwards is the one that looks like a mistake and is not: with the ink moved away from the
  // colour, a STRONGER tint of the original colour is further from the ink, not closer.
  const stronger = tone.legibleTintRecipe("#00001B", DARK);
  assert.ok(stronger.tintFactor > 1, `expected a stronger tint, got ${stronger.tintFactor}`);

  // And it is not reached for first. Over a whole ramp on the light theme the tint stays at
  // its designed weight far more often than it moves — the pill keeps the soft fill the card
  // is supposed to have, and the ink does the work.
  // The ramp `palette: yellow` actually produces on a white card, after the palette
  // adaptation has already made its steps readable as markers.
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
  // Every caller that has no surface — and there are several, including the whole render path
  // before the card has been painted once.
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
  // The trivial answer to every legibility question is black text on an opaque fill. The caps
  // are what forbid it, and this is the assertion that they are doing so: nothing lands at the
  // ends of the lightness range, and no tint is taken past what the search may spend.
  const search = tone.TINT_SEARCH;
  const maxFactor = 1 + search.tintCapUp * search.tintStep;
  const minFactor = Math.max(0, 1 - search.tintCapDown * search.tintStep);
  for (const card of [LIGHT, DARK, "#808080"]) {
    for (const hex of ["#FFFF00", "#FFD700", "#00FF00", "#0020A3", "#008080", "#FF1493", "#B7B7B7", "#FFFFFF", "#000000"]) {
      const recipe = tone.legibleTintRecipe(hex, card);
      const before = oklch.hexToOklch(hex);
      const after = oklch.hexToOklch(recipe.ink);
      // The tolerance is the gamut round trip, not slack in the cap: oklchToHex() resolves an
      // out-of-gamut request by pulling chroma in at fixed lightness and hue, and the eight-bit
      // result reads back a thousandth or two away from what was asked for.
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
  // A tier that named its own hex, an integration's value_color, a caller with no surface. The
  // card leaves colours it was GIVEN alone, here as everywhere else.
  const surface = roles.surfaceOf([LIGHT], "#212121");
  const recipes = tone.tintRecipesFor(["#FFFF00"], surface);
  assert.deepEqual({ ...tone.tintRecipeFor(recipes, "#123456") }, { ink: "#123456", tintFactor: 1 });
  assert.deepEqual({ ...tone.tintRecipeFor(null, "#123456") }, { ink: "#123456", tintFactor: 1 });
});

test("the whole table for a palette costs a few milliseconds, once", () => {
  // It runs once per palette and surface and never during a later render, so a few
  // milliseconds is the right budget — but "a few" has to be a number somebody checked.
  const surface = roles.surfaceOf(["#808080"], null);
  const ramp = ["#3A8B8B", "#4A9B9B", "#5AABAB", "#008080", "#007070", "#006060", "#005050", "#B7B7B7", "#FFFF00", "#0020A3", "#FF1493", "#7F8792"];
  const started = process.hrtime.bigint();
  tone.tintRecipesFor(ramp, surface);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 250, `a full table took ${ms.toFixed(0)} ms`);
});

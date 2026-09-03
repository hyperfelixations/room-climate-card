"use strict";

// The monochrome palette generator: one colour in, a whole ramp out. The ramp is calculated
// (148 CSS names plus any hex is too many to ship as files), so it has to answer for the
// same things a hand-made palette does, plus one only it can get wrong: that the colour
// asked for is the colour on the card, at the `optimal` position.
// It deliberately does not claim what a two-hue palette can — with a single hue the two
// directions read by paleness and depth, and neighbouring steps sit closer than on the
// card's own ramp. See internal dev doc §5 "Monopaletten-Generator".

const test = require("node:test");
const assert = require("node:assert/strict");
const { deltaE, measureRamp, contrastRatio, LIGHT_CARD, DARK_CARD } = require("../../helpers/color-measurement.js");

let monochromePalette;
let assertPalette;
let paletteForColor;
let paletteForName;
let paletteKeys;
let CSS_COLOR_NAMES;
let hexToOklch;

test.before(async () => {
  ({ monochromePalette } = await import("../../../src/domain/classification/palettes/monochrome.js"));
  ({ assertPalette, paletteForColor, paletteForName, paletteKeys } = await import(
    "../../../src/domain/classification/palettes/registry.js"
  ));
  ({ CSS_COLOR_NAMES } = await import("../../../src/core/color.js"));
  ({ hexToOklch } = await import("../../../src/core/oklch.js"));
});

// ------------------------------------------------------- the name table ----

test("all 148 CSS colour names are present, lower case, and valid hex", () => {
  const names = Object.keys(CSS_COLOR_NAMES);
  assert.equal(names.length, 148);
  for (const name of names) {
    assert.equal(name, name.toLowerCase(), name);
    assert.match(CSS_COLOR_NAMES[name], /^#[0-9A-F]{6}$/, name);
  }
  // Spot checks. The whole table is checked against Chromium's parser in the browser suite;
  // these fail a unit run if the table is gutted.
  assert.equal(CSS_COLOR_NAMES.rebeccapurple, "#663399");
  assert.equal(CSS_COLOR_NAMES.gray, CSS_COLOR_NAMES.grey);
  assert.equal(CSS_COLOR_NAMES.darkgray, CSS_COLOR_NAMES.darkgrey);
  assert.equal(CSS_COLOR_NAMES.aqua, CSS_COLOR_NAMES.cyan);
  assert.equal(CSS_COLOR_NAMES.white, "#FFFFFF");
  assert.equal(CSS_COLOR_NAMES.blue, "#0000FF");
});

// ------------------------------------------------------- the generator ----

test("a generated palette has the shape every palette has", () => {
  const palette = monochromePalette(CSS_COLOR_NAMES.teal, "teal");
  assert.doesNotThrow(() => assertPalette(palette, "generated"));
  assert.equal(palette.id, "teal");
  assert.ok(palette.above.length >= 1 && palette.above.length <= 5);
  assert.ok(palette.below.length >= 1 && palette.below.length <= 5);
});

test("generating twice gives the same colours", () => {
  assert.deepEqual(monochromePalette("#008080"), monochromePalette("#008080"));
});

// Naming a colour puts that exact colour at `optimal`, the position the card is at its best.
test("the colour you name is the middle of the ramp, to the digit", () => {
  for (const name of ["teal", "blue", "darkgreen", "crimson", "gold", "rebeccapurple", "white", "black"]) {
    assert.equal(monochromePalette(CSS_COLOR_NAMES[name], name).optimal, CSS_COLOR_NAMES[name], name);
  }
  assert.equal(paletteForColor("blue").optimal, "#0000FF");
  assert.equal(paletteForColor("#3366CC").optimal, "#3366CC");
});

// CIELAB puts #0000FF at hue 306° (blue-violet) and drifts further into purple away from
// full chroma; Oklab puts it at 264° and holds it. The generator works in Oklab, so the
// drift here is nil.
test("every step keeps the hue it was asked for", () => {
  for (const name of ["teal", "blue", "purple", "orange", "crimson", "forestgreen", "navy"]) {
    const palette = monochromePalette(CSS_COLOR_NAMES[name], name);
    const wanted = hexToOklch(CSS_COLOR_NAMES[name]).hue;
    for (const hex of [...palette.below, palette.optimal, ...palette.above]) {
      const step = hexToOklch(hex);
      // Hue is only meaningful where there is colour: at a chroma of a few thousandths,
      // 8-bit rounding alone moves the angle. The tolerance follows the chroma.
      if (step.chroma < 0.02) continue;
      const drift = Math.abs(((step.hue - wanted + 540) % 360) - 180);
      assert.ok(drift < 2, `${name}: ${hex} drifts ${drift.toFixed(1)}° at chroma ${step.chroma.toFixed(3)}`);
    }
  }
});

// The same claim as a person would check it: a blue ramp is blue all the way through.
test("a blue ramp is blue, which is the bug this design exists to fix", () => {
  for (const hex of Object.values(paletteForColor("blue")).flat()) {
    if (typeof hex !== "string" || !hex.startsWith("#")) continue;
    const { hue, chroma } = hexToOklch(hex);
    if (chroma < 0.02) continue;
    assert.ok(hue > 240 && hue < 285, `${hex} is at hue ${hue.toFixed(0)}, which is not blue`);
  }
});

// A single hue cannot say direction, so paleness and depth do, and both have to move.
test("below runs pale and above runs deep, in both lightness and colourfulness", () => {
  const palette = monochromePalette(CSS_COLOR_NAMES.teal);
  const middle = hexToOklch(palette.optimal);
  const pale = palette.below.map((hex) => hexToOklch(hex));
  const deep = palette.above.map((hex) => hexToOklch(hex));

  for (const [index, step] of pale.entries()) {
    const previous = index === 0 ? middle : pale[index - 1];
    assert.ok(step.lightness > previous.lightness, `below step ${index + 1} must be lighter`);
    assert.ok(step.chroma < previous.chroma + 1e-9, `below step ${index + 1} must not gain colour`);
  }
  for (const [index, step] of deep.entries()) {
    const previous = index === 0 ? middle : deep[index - 1];
    assert.ok(step.lightness < previous.lightness, `above step ${index + 1} must be darker`);
  }
  assert.ok(deltaE(palette.below.at(-1), palette.above.at(-1)) > 30, "the two extremes are unmistakable");
});

// The whole table, not a sample.
test("every one of the 148 names produces a ramp of eleven steps that never turns back", () => {
  // Eleven steps always: a derived palette answers the card's -5..+5 profiles one to one
  // (WING_STEPS in palettes/geometry.js). Only a written-out or shipped palette differs.
  let weakest = Infinity;
  let weakestName = "";
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const palette = monochromePalette(hex, name);
    assert.doesNotThrow(() => assertPalette(palette, name), name);
    assert.equal(palette.below.length, 5, name + ": below");
    assert.equal(palette.above.length, 5, name + ": above");
    assert.equal(measureRamp(palette).neverReturns, true, name + ": a step comes back towards the middle");
    for (const wing of [palette.below, palette.above]) {
      let previous = palette.optimal;
      for (const step of wing) {
        const gap = deltaE(previous, step);
        // A wing with nowhere to go repeats itself; measured separately below.
        if (gap > 0 && gap < weakest) {
          weakest = gap;
          weakestName = name;
        }
        previous = step;
      }
    }
  }
  // The weakest step of any wing that travels, as a floor: it is a property of the method.
  assert.ok(weakest > 0.3, "the weakest travelling step is " + weakestName + " at " + weakest.toFixed(2));
});

test("a ramp spends the room it has evenly, rather than jumping and then crawling", () => {
  // The gamut-corner defect: sRGB holds more chroma at some hues than others, and `blue`
  // (#0000FF) sits on a corner, so equal-parameter steps used to cost most of its chroma in
  // the first step. The generator places steps at even shares of the painted path
  // (placeAlong in geometry.js) and aims wings at colours the gamut can hold.
  let worst = { ratio: 0, name: null };
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const palette = monochromePalette(hex, name);
    for (const wing of [palette.below, palette.above]) {
      const path = [palette.optimal, ...wing];
      const gaps = path.slice(1).map((step, index) => deltaE(path[index], step));
      // A wing with nowhere to go has no spacing to be even about.
      if (Math.max(...gaps) < 1) continue;
      const ratio = Math.max(...gaps) / Math.max(Math.min(...gaps), 1e-6);
      if (ratio > worst.ratio) worst = { ratio, name };
    }
  }
  // Measured at 4.3 (`lavender`, whose pale wing has almost no room).
  assert.ok(worst.ratio <= 4.5, worst.name + " has a step " + worst.ratio.toFixed(1) + " times its smallest");
});

// A grey has no hue, and needs no rule: chroma is scaled proportionally, so a base with
// none keeps none.
test("a colour with no hue gives a greyscale, without a special case for it", () => {
  for (const name of ["white", "black", "gray", "gainsboro", "whitesmoke"]) {
    const palette = monochromePalette(CSS_COLOR_NAMES[name], name);
    for (const hex of [...palette.below, palette.optimal, ...palette.above]) {
      assert.ok(hexToOklch(hex).chroma < 0.005, `${name}: ${hex} must carry no colour`);
    }
    assert.equal(measureRamp(palette).neverReturns, true, name + ": still a ramp");
  }
  // A greyscale reads identically under every kind of colour vision: the ordering survives
  // when the hue does not.
  const grey = monochromePalette(CSS_COLOR_NAMES.gray);
  for (const hex of [...grey.below, grey.optimal, ...grey.above]) {
    assert.ok(hexToOklch(hex).chroma < 0.005, `gray: ${hex} carries colour`);
  }
});

// Anchoring at the named colour means `white` has nothing paler and `black` nothing deeper.
// The wing stays five steps long (five tiers on that side) but has nowhere to travel, so
// every step is the colour that was named.
test("a colour at the very edge gets a wing that stands still rather than a wing that lies", () => {
  const white = monochromePalette(CSS_COLOR_NAMES.white, "white");
  assert.deepEqual(white.below, ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"], "nothing is paler than white");
  assert.equal(new Set(white.above).size, 5, "but there is plenty of room downwards");

  const black = monochromePalette(CSS_COLOR_NAMES.black, "black");
  assert.deepEqual(black.above, ["#000000", "#000000", "#000000", "#000000", "#000000"], "nothing is deeper than black");
  assert.equal(new Set(black.below).size, 5);

  // A colour near the edge spends what room it has on all five steps, so they are close
  // together rather than few.
  const gold = monochromePalette(CSS_COLOR_NAMES.gold, "gold");
  assert.equal(gold.below.length, 5);
  assert.equal(new Set(gold.below).size, 5, "five different colours, however little room there was");
});

// A single-colour ramp cannot clear the contrast floor every shipped palette does, because
// it cannot change hue between its wings. What is claimed instead: every ramp keeps at
// least two steps comfortable on both card backgrounds, so no named colour is unreadable
// everywhere. `black` reaches the floor of two.
test("every ramp keeps at least two steps that work on both card backgrounds", () => {
  let fewest = Infinity;
  let fewestName = "";
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const palette = monochromePalette(hex, name);
    const usable = [...palette.below, palette.optimal, ...palette.above].filter(
      (step) => contrastRatio(step, LIGHT_CARD) >= 2.0 && contrastRatio(step, DARK_CARD) >= 2.6
    ).length;
    if (usable < fewest) {
      fewest = usable;
      fewestName = name;
    }
  }
  assert.ok(fewest >= 2, `${fewestName} only manages ${fewest}`);
});

// Both wings aim at the edges of the band readable on both card backgrounds, not the edges
// of the colour space; the aim is a floor, so a wing whose five steps would not fit reaches
// further out to the generator's absolute stops (`palette: blue` needs this).
test("a ramp aims at the readable band, and goes past it only when its steps would not fit", () => {
  const CEILING = 0.96;
  const FLOOR = 0.1;
  // One 8-bit channel step in Oklab lightness; a chroma-only wing still moves round-tripped
  // lightness by a fraction of it.
  const QUANTISATION = 0.005;
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const base = hexToOklch(hex).lightness;
    const palette = monochromePalette(hex, name);
    for (const step of palette.below) {
      const lightness = hexToOklch(step).lightness;
      assert.ok(lightness <= Math.max(CEILING, base) + QUANTISATION, name + ": " + step + " runs past the ceiling");
      assert.ok(lightness >= base - QUANTISATION, name + ": " + step + " is not on the pale side");
    }
    for (const step of palette.above) {
      const lightness = hexToOklch(step).lightness;
      assert.ok(lightness >= Math.min(FLOOR, base) - QUANTISATION, name + ": " + step + " runs past the floor");
      assert.ok(lightness <= base + QUANTISATION, name + ": " + step + " is not on the deep side");
    }
  }

  // Two claims: a wing never stops short of its anchor, and a good share stop exactly there
  // (the rest reach further because five steps would not otherwise fit).
  let atTheAim = 0;
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const base = hexToOklch(hex).lightness;
    const palette = monochromePalette(hex, name);
    const paleAim = Math.max(base, Math.min(CEILING, Math.max(0.76, base + 0.08)));
    const deepAim = Math.min(base, Math.max(FLOOR, Math.min(0.5, base - 0.08)));
    const pale = hexToOklch(palette.below[4]).lightness;
    const deep = hexToOklch(palette.above[4]).lightness;
    assert.ok(pale >= paleAim - QUANTISATION, name + ": the pale wing stopped short of its anchor");
    assert.ok(deep <= deepAim + QUANTISATION, name + ": the deep wing stopped short of its anchor");
    if (Math.abs(pale - paleAim) < QUANTISATION * 4) atTheAim += 1;
    if (Math.abs(deep - deepAim) < QUANTISATION * 4) atTheAim += 1;
  }
  assert.ok(atTheAim > 100, "only " + atTheAim + " of 296 wings end at their anchor");
});

// ------------------------------------------------------------- lookup ----

test("paletteForColor takes a name or a hex, and nothing else", () => {
  assert.equal(paletteForColor("TEAL").optimal, "#008080", "names are case-insensitive");
  assert.equal(paletteForColor("  teal  ").optimal, "#008080");
  assert.equal(paletteForColor("#3366cc").optimal, "#3366CC", "a hex is normalized");
  assert.equal(paletteForColor("3366cc").optimal, "#3366CC", "and works without the hash");
  // Alpha seeds an opaque ramp: ten transparencies cannot be derived from one.
  const translucent = paletteForColor("#00808080");
  assert.equal(translucent.optimal, "#008080");
  assert.deepEqual(translucent.above, paletteForColor("teal").above);
  assert.equal(paletteForColor("nonsense"), null);
  assert.equal(paletteForColor(""), null);
  assert.equal(paletteForColor(null), null);
  assert.equal(paletteForColor("teal").id, "teal", "the palette is named after what was asked for");
});

// A registered palette name always wins over a CSS colour, which is only safe while no
// shipped word is also a colour.
test("no palette key collides with a CSS colour name", () => {
  for (const key of paletteKeys()) {
    assert.equal(CSS_COLOR_NAMES[key], undefined, `"${key}" would shadow a CSS colour`);
    assert.ok(paletteForName(key), `"${key}" resolves as a palette`);
  }
});

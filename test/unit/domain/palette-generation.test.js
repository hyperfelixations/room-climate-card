"use strict";

// The monochrome palette generator: one colour in, a whole ramp out.
//
// This is the one part of the colour system that is not written down anywhere — 148 CSS
// names plus every hex a user might type is far too many to ship as files, so the ramp is
// CALCULATED. Which means the calculation has to answer for the same things a hand-made
// palette does, and for one more that only it can get wrong.
//
// THE ONE MORE: that the colour you asked for is the colour you get. An earlier draft
// took only the HUE from the base and placed the ramp at a lightness and chroma of its
// own, and it was wrong twice over — `palette: blue` produced a washed-out lilac, because
// #0000FF appeared nowhere in its own ramp and because CIELAB's hue lines bend from blue
// towards purple. Both failures are pinned here so neither can come back.
//
// What it deliberately does NOT claim is what a two-hue palette can: with a single hue,
// the two directions are told apart by paleness and depth rather than by colour, and
// neighbouring steps sit closer together than they do on the card's own ramp.

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
  // Spot checks against the CSS definitions, including the two spellings CSS itself
  // carries and the one name that came from a person rather than a colour. The whole
  // table is checked against Chromium's own parser in the browser suite; these are here
  // so a unit run still fails loudly if the table is gutted.
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

// THE PROMISE. Naming a colour has to put that exact colour on the card, at the position
// where the card is at its best — which is what `optimal` is.
test("the colour you name is the middle of the ramp, to the digit", () => {
  for (const name of ["teal", "blue", "darkgreen", "crimson", "gold", "rebeccapurple", "white", "black"]) {
    assert.equal(monochromePalette(CSS_COLOR_NAMES[name], name).optimal, CSS_COLOR_NAMES[name], name);
  }
  assert.equal(paletteForColor("blue").optimal, "#0000FF");
  assert.equal(paletteForColor("#3366CC").optimal, "#3366CC");
});

// The failure that produced a lilac ramp for `palette: blue`. CIELAB puts #0000FF at hue
// 306°, which is blue-violet, and every step away from full chroma along that line drifts
// further into purple; Oklab puts it at 264° and holds it. The generator works in Oklab
// for exactly this reason, so the drift here is not "small" — it is nil.
test("every step keeps the hue it was asked for", () => {
  for (const name of ["teal", "blue", "purple", "orange", "crimson", "forestgreen", "navy"]) {
    const palette = monochromePalette(CSS_COLOR_NAMES[name], name);
    const wanted = hexToOklch(CSS_COLOR_NAMES[name]).hue;
    for (const hex of [...palette.below, palette.optimal, ...palette.above]) {
      const step = hexToOklch(hex);
      // Hue is only meaningful where there IS colour: at the pale end the chroma is a
      // few thousandths, where eight-bit rounding alone moves the angle and no eye could
      // see it. The tolerance follows the chroma rather than pretending to a precision
      // the colour does not carry.
      if (step.chroma < 0.02) continue;
      const drift = Math.abs(((step.hue - wanted + 540) % 360) - 180);
      assert.ok(drift < 2, `${name}: ${hex} drifts ${drift.toFixed(1)}° at chroma ${step.chroma.toFixed(3)}`);
    }
  }
});

// And the same claim stated as a person would check it: a blue ramp is blue all the way
// through, not lilac at the pale end.
test("a blue ramp is blue, which is the bug this design exists to fix", () => {
  for (const hex of Object.values(paletteForColor("blue")).flat()) {
    if (typeof hex !== "string" || !hex.startsWith("#")) continue;
    const { hue, chroma } = hexToOklch(hex);
    if (chroma < 0.02) continue;
    assert.ok(hue > 240 && hue < 285, `${hex} is at hue ${hue.toFixed(0)}, which is not blue`);
  }
});

// Direction is the thing a single hue cannot say by itself, so it is said with paleness
// and depth. Both have to move, and both in the same direction, or one wing would be
// carrying the whole distinction on its own.
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

// The whole table, not a sample: a generator that worked for the colours someone thought
// to try is not a generator.
test("every one of the 148 names produces a ramp of eleven steps that never turns back", () => {
  // ELEVEN STEPS, ALWAYS. A derived palette is the card's own answer to the card's own
  // classification profiles, which run from -5 to +5, so the two map one to one — see
  // WING_STEPS in palettes/geometry.js. Only a palette somebody wrote out, or one of the four
  // the card ships, may have a different shape.
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
        // A wing with nowhere to go repeats itself, and that is measured separately below.
        if (gap > 0 && gap < weakest) {
          weakest = gap;
          weakestName = name;
        }
        previous = step;
      }
    }
  }
  // The weakest step of any wing THAT TRAVELS. Stated as a floor rather than an exact number,
  // because it is a property of the method rather than of one colour. What a wing with no room
  // does instead is the subject of its own test below.
  assert.ok(weakest > 0.3, "the weakest travelling step is " + weakestName + " at " + weakest.toFixed(2));
});

test("a ramp spends the room it has evenly, rather than jumping and then crawling", () => {
  // The gamut-corner defect, in the single-colour generator this time. sRGB holds far more
  // chroma at some hues and lightnesses than at others, and `blue` (#0000FF) sits on a corner
  // of it: stepping away by equal parameter used to cost almost all of its chroma in the first
  // step and very little afterwards. While a wing could shorten itself that stayed hidden;
  // with the length fixed it showed up as a ramp with a stutter in it.
  //
  // Two changes answer it, both in the generator: the steps are placed at even shares of the
  // path as it will be PAINTED (placeAlong in geometry.js), and the wing aims at a colour the
  // gamut can actually hold. Measured over the whole table, that took the worst ratio from
  // 30-to-1 down to where it is asserted here.
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
  // Measured at 4.3 (`lavender`, whose pale wing has almost no room and whose deep wing has
  // plenty). Before the two changes above the same measurement read 9.7.
  assert.ok(worst.ratio <= 4.5, worst.name + " has a step " + worst.ratio.toFixed(1) + " times its smallest");
});

// A grey has no hue, so there is no direction to take from it. Inventing one produced a
// green ramp from `white` in an earlier draft. Now it needs no rule at all: chroma is
// scaled proportionally, so a base with none keeps none.
test("a colour with no hue gives a greyscale, without a special case for it", () => {
  for (const name of ["white", "black", "gray", "gainsboro", "whitesmoke"]) {
    const palette = monochromePalette(CSS_COLOR_NAMES[name], name);
    for (const hex of [...palette.below, palette.optimal, ...palette.above]) {
      assert.ok(hexToOklch(hex).chroma < 0.005, `${name}: ${hex} must carry no colour`);
    }
    assert.equal(measureRamp(palette).neverReturns, true, name + ": still a ramp");
  }
  // A greyscale is the one ramp every kind of colour vision reads identically, which is
  // why it is worth having at all: the ordering survives when the hue does not.
  const grey = monochromePalette(CSS_COLOR_NAMES.gray);
  for (const hex of [...grey.below, grey.optimal, ...grey.above]) {
    assert.ok(hexToOklch(hex).chroma < 0.005, `gray: ${hex} carries colour`);
  }
});

// The honest consequence of anchoring at the named colour: `white` has nothing paler and
// `black` has nothing deeper. The wing is still there and still five steps long, because the
// profile it answers to has five tiers on that side — it simply has nowhere to travel, so its
// steps are all the colour that was named. That is what the card painted before too: a reading
// below optimal on `palette: white` showed white, because an empty wing mapped to the middle.
test("a colour at the very edge gets a wing that stands still rather than a wing that lies", () => {
  const white = monochromePalette(CSS_COLOR_NAMES.white, "white");
  assert.deepEqual(white.below, ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"], "nothing is paler than white");
  assert.equal(new Set(white.above).size, 5, "but there is plenty of room downwards");

  const black = monochromePalette(CSS_COLOR_NAMES.black, "black");
  assert.deepEqual(black.above, ["#000000", "#000000", "#000000", "#000000", "#000000"], "nothing is deeper than black");
  assert.equal(new Set(black.below).size, 5);

  // And a colour merely NEAR the edge spends what room it has on all five steps, which is what
  // makes them close together rather than what makes them few.
  const gold = monochromePalette(CSS_COLOR_NAMES.gold, "gold");
  assert.equal(gold.below.length, 5);
  assert.equal(new Set(gold.below).size, 5, "five different colours, however little room there was");
});

// WHAT A GENERATED RAMP DOES NOT PROMISE, written down as a test so nobody has to guess
// where the line is. A diverging ramp goes both paler and deeper than its middle, and each
// direction moves towards one background or the other; the hand-designed palettes escape
// that by changing HUE as well, which a single-colour ramp cannot. So the contrast floor
// every SHIPPED palette clears is not claimed here.
//
// What is claimed, and measured over the whole table: every ramp still carries at least a
// couple of steps that are comfortable on both card backgrounds, so no named colour
// produces a card that is unreadable everywhere. Two is the floor, and `black` is where it
// is reached.
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

// And the reason the ramp stops where it stops. Both wings AIM at the edges of the band that
// stays readable on both card backgrounds rather than at the edges of the colour space — but
// the aim is a floor rather than a target: a wing whose five steps would not fit inside it
// reaches further out, as far as the absolute stops the generator keeps. `palette: blue` is
// the case that needs it, sitting below the deep anchor to begin with.
test("a ramp aims at the readable band, and goes past it only when its steps would not fit", () => {
  const CEILING = 0.96;
  const FLOOR = 0.1;
  // One step of an 8-bit channel in Oklab lightness. A wing that travels in chroma alone still
  // moves its round-tripped lightness by a fraction of one, which is not the wing changing
  // sides.
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

  // THE AIM IS A FLOOR AND NOT A TARGET, which is two claims. A wing never stops SHORT of its
  // anchor — that is what makes the anchor an aim at all. And a good share of them stop exactly
  // there, which is what makes it more than a formality: measured over the table, 40 of the 148
  // pale wings and 85 of the 148 deep ones end within a rounding step of their anchor, and the
  // rest reach further because five steps would not otherwise fit between them and the middle.
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
  // Alpha seeds an opaque ramp: there is no way to derive ten more transparencies from
  // one, and a translucent middle in an otherwise opaque ramp would be worse than none.
  const translucent = paletteForColor("#00808080");
  assert.equal(translucent.optimal, "#008080");
  assert.deepEqual(translucent.above, paletteForColor("teal").above);
  assert.equal(paletteForColor("nonsense"), null);
  assert.equal(paletteForColor(""), null);
  assert.equal(paletteForColor(null), null);
  assert.equal(paletteForColor("teal").id, "teal", "the palette is named after what was asked for");
});

// The precedence that lets a future palette take a word back: a registered name always
// wins. It only stays a safe promise while no shipped word is also a colour.
test("no palette key collides with a CSS colour name", () => {
  for (const key of paletteKeys()) {
    assert.equal(CSS_COLOR_NAMES[key], undefined, `"${key}" would shadow a CSS colour`);
    assert.ok(paletteForName(key), `"${key}" resolves as a palette`);
  }
});

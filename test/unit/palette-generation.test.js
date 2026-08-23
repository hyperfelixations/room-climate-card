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
const { deltaE, measure, contrastRatio, LIGHT_CARD, DARK_CARD } = require("../helpers/color-vision.js");

let monochromePalette;
let assertPalette;
let paletteForColor;
let paletteForName;
let paletteKeys;
let CSS_COLOR_NAMES;
let hexToOklch;

test.before(async () => {
  ({ monochromePalette } = await import("../../src/domain/classification/palettes/monochrome.js"));
  ({ assertPalette, paletteForColor, paletteForName, paletteKeys } = await import(
    "../../src/domain/classification/palettes/registry.js"
  ));
  ({ CSS_COLOR_NAMES } = await import("../../src/core/color.js"));
  ({ hexToOklch } = await import("../../src/core/oklch.js"));
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
test("every one of the 148 names produces a usable ramp", () => {
  let weakest = Infinity;
  let weakestName = "";
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const palette = monochromePalette(hex, name);
    assert.doesNotThrow(() => assertPalette(palette, name), name);
    assert.ok(palette.above.length + palette.below.length >= 3, `${name}: a ramp needs steps`);
    assert.equal(measure(palette, "normal").monotone, true, `${name}: every step out is further from the middle`);
    for (const wing of [palette.below, palette.above]) {
      let previous = palette.optimal;
      for (const step of wing) {
        const gap = deltaE(previous, step);
        if (gap < weakest) {
          weakest = gap;
          weakestName = name;
        }
        previous = step;
      }
    }
  }
  // Stated as a floor rather than an exact number, because it is a property of the
  // method. The single weakest case is `black`, where CIEDE2000 and Oklab disagree about
  // how far apart two near-blacks look; even there the step is above the ~1 that counts
  // as noticeable, and every other name sits above 3.
  assert.ok(weakest > 1.5, `the weakest step is ${weakestName} at ${weakest.toFixed(1)}`);
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
    assert.equal(measure(palette, "normal").monotone, true, `${name}: still a ramp`);
  }
  // A greyscale is the one ramp every kind of colour vision reads identically.
  for (const deficiency of ["protan", "deutan", "tritan"]) {
    assert.equal(measure(monochromePalette(CSS_COLOR_NAMES.gray), deficiency).monotone, true, deficiency);
  }
});

// The honest consequence of anchoring at the named colour: `white` has nothing paler and
// `black` has nothing deeper. A wing of five identical whites would be worse than no wing
// at all, and the palette contract allows an empty one — so that is what they get.
test("a colour at the very edge gets the wing it can have, and not the other", () => {
  const white = monochromePalette(CSS_COLOR_NAMES.white, "white");
  assert.deepEqual(white.below, [], "nothing is paler than white");
  assert.ok(white.above.length >= 4, "but there is plenty of room downwards");

  const black = monochromePalette(CSS_COLOR_NAMES.black, "black");
  assert.deepEqual(black.above, [], "nothing is deeper than black");
  assert.ok(black.below.length >= 4);

  // And a colour merely NEAR the edge gets a shorter wing rather than a fake one.
  assert.ok(monochromePalette(CSS_COLOR_NAMES.gold, "gold").below.length < 5);
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

// And the reason the ramp stops where it stops: both wings aim at the edges of the band
// that stays readable on both backgrounds, rather than at the edges of the colour space.
// Only a base that already lies outside that band takes its ramp outside it.
test("a ramp stays inside the readable lightness band unless its base colour does not", () => {
  for (const [name, hex] of Object.entries(CSS_COLOR_NAMES)) {
    const base = hexToOklch(hex).lightness;
    for (const step of monochromePalette(hex, name).below) {
      assert.ok(hexToOklch(step).lightness <= Math.max(0.77, base + 0.09), `${name}: ${step} runs too pale`);
    }
    for (const step of monochromePalette(hex, name).above) {
      assert.ok(hexToOklch(step).lightness >= Math.min(0.49, base - 0.09), `${name}: ${step} runs too deep`);
    }
  }
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

"use strict";

// The gradient palette generator: two or three colours in, a whole ramp out.
//
// Its sibling next door (palette-generation.test.js) covers the ONE-colour generator, and
// the two answer for different things. A monochrome ramp has one hue and has to carry
// direction with paleness and depth; a gradient ramp has two hues and has to travel between
// them convincingly. So what is checked here is mostly about the journey — that it goes the
// short way round the hue circle, that it does not pass through a colour nobody named, and
// that its steps are spaced by what a reader sees.
//
// THE PROMISE IT SHARES with every generated palette: the colours you name are the colours
// you get, to the digit, at the ends and — with three — in the middle.
//
// THE ONE IT NEARLY BROKE. sRGB is not a box in Oklch, and a colour like `blue` sits on a
// corner of it. Stepping away by equal parameter costs almost all the chroma in the first
// step, and `blue-green-red` jumped from blue straight to teal and then crawled. Measured
// across 1100 name pairs the worst step was 4.6 times the smallest; every outlier had a
// gamut corner at one end. The spacing test below is what keeps that fixed.

const test = require("node:test");
const assert = require("node:assert/strict");

let gradientPalette;
let MAX_GRADIENT_COLORS;
let assertPalette;
let completePalette;
let paletteForColor;
let paletteForGradient;
let paletteForName;
let parseColorToken;
let CSS_COLOR_NAMES;
let hexToOklch;
let oklabDistance;

test.before(async () => {
  ({ gradientPalette, MAX_GRADIENT_COLORS } = await import("../../../src/domain/classification/palettes/gradient.js"));
  ({ assertPalette, completePalette, paletteForColor, paletteForGradient, paletteForName } = await import(
    "../../../src/domain/classification/palettes/registry.js"
  ));
  ({ parseColorToken, CSS_COLOR_NAMES } = await import("../../../src/core/color.js"));
  ({ hexToOklch, oklabDistance } = await import("../../../src/core/oklch.js"));
});

// The palette a spelling implies, straight from the generator — so these tests are about the
// calculation and not about the lookup that finds it.
const from = (spec) => gradientPalette(spec.split("-").map((token) => parseColorToken(token)), spec);
const rampOf = (palette) => [...[...palette.below].reverse(), palette.optimal, ...palette.above];

// ============================================ the promise ========================

test("the colours you name are the ends of the ramp, to the digit", () => {
  for (const spec of ["blue-red", "gold-navy", "black-white", "teal-orange", "1DB85D-FD9808"]) {
    const palette = from(spec);
    const ramp = rampOf(palette);
    const named = spec.split("-").map((token) => parseColorToken(token));
    assert.equal(ramp[0], named[0], `${spec}: the first colour is the far end of below`);
    assert.equal(ramp[ramp.length - 1], named[named.length - 1], `${spec}: the last is the far end of above`);
  }
});

test("with three colours the middle is the one that was named, whatever the profile looks like", () => {
  // Stated for a metric with no `below` at all, because that is the case where somebody
  // might expect the middle to be reinterpreted. It is not: a palette is a set of colours
  // and a classification is a set of thresholds, and they meet at the profile.
  for (const spec of ["blue-green-red", "white-teal-black", "red-yellow-red"]) {
    assert.equal(from(spec).optimal, parseColorToken(spec.split("-")[1]), spec);
  }
});

test("with two colours the middle is on the ramp rather than beside it", () => {
  // The halfway point of the same polar interpolation every other step uses, so a reader
  // travelling the ramp passes through it without a kink.
  const palette = from("blue-red");
  const ramp = rampOf(palette);
  const middle = ramp.indexOf(palette.optimal);
  const hue = (hex) => hexToOklch(hex).hue;
  // Hue increases monotonically along the short arc from blue (~264) to red (~29 = 389).
  const unwrapped = ramp.map((hex, index) => (index > 0 && hue(hex) < hue(ramp[0]) ? hue(hex) + 360 : hue(hex)));
  for (let index = 1; index < unwrapped.length; index += 1) {
    assert.ok(unwrapped[index] >= unwrapped[index - 1] - 1e-6, `hue goes back at step ${index}: ${unwrapped.join(", ")}`);
  }
  assert.ok(middle > 0 && middle < ramp.length - 1);
});

// ============================================ the journey =======================

test("blue-red travels through violet, which is the short way round", () => {
  // The long way round would pass through green, and nobody writing `blue-red` means that.
  const hues = rampOf(from("blue-red")).map((hex) => hexToOklch(hex).hue);
  const green = hues.some((hue) => hue > 120 && hue < 200);
  assert.equal(green, false, `the ramp passed through green: ${hues.map(Math.round).join(", ")}`);
  const violet = hues.some((hue) => hue > 300 && hue < 350);
  assert.equal(violet, true, `no violet in ${hues.map(Math.round).join(", ")}`);
});

test("an achromatic end borrows the hue of the other, rather than travelling to noise", () => {
  // #000000 has no hue; whatever angle it quantises to is rounding noise. Interpolating
  // TOWARDS that noise would send the ramp through a colour nobody named.
  const blackRed = rampOf(from("black-red"));
  for (const hex of blackRed) {
    const { chroma, hue } = hexToOklch(hex);
    if (chroma < 0.01) continue;
    assert.ok(hue > 0 && hue < 60, `${hex} is not a red: hue ${Math.round(hue)}`);
  }

  // And with no hue at either end there is nothing to borrow, so it stays a greyscale.
  for (const hex of rampOf(from("black-white"))) {
    assert.ok(hexToOklch(hex).chroma < 0.02, `${hex} has a hue in a black-to-white ramp`);
  }
});

test("the steps are spaced by what a reader sees, not by the interpolation parameter", () => {
  // The regression guard for the gamut-corner defect. Measured over every ordered pair and
  // green-centred triple of a representative set: before the fix the worst ramp had a step
  // 4.6 times its smallest and 94 combinations were past 3; after it, none is.
  const NAMES = ["red", "green", "blue", "yellow", "cyan", "magenta", "white", "black", "gray", "teal", "navy", "gold", "orange", "purple", "lime", "pink", "brown", "olive", "maroon", "salmon", "indigo", "turquoise", "crimson", "khaki"];
  let worst = { ratio: 0, spec: null };
  let measured = 0;
  for (const first of NAMES) {
    for (const last of NAMES) {
      if (first === last) continue;
      for (const spec of [`${first}-${last}`, `${first}-green-${last}`]) {
        const ramp = rampOf(from(spec));
        if (ramp.length < 3) continue;
        const gaps = ramp.slice(1).map((hex, index) => oklabDistance(ramp[index], hex));
        const ratio = Math.max(...gaps) / Math.min(...gaps);
        measured += 1;
        if (ratio > worst.ratio) worst = { ratio, spec };
      }
    }
  }
  assert.ok(measured > 1000, `only ${measured} combinations measured`);
  assert.ok(worst.ratio <= 3.2, `${worst.spec} has a step ${worst.ratio.toFixed(1)} times its smallest`);
});

test("no ramp ever contains two steps a reader cannot tell apart", () => {
  // The wing shortens rather than emitting a step nobody can see — and unlike the
  // monochrome generator, shortening here does not move the named end: the same two colours
  // are simply reached in fewer, larger steps.
  for (const spec of ["blue-red", "red-orange", "gold-khaki", "teal-turquoise", "blue-green-red", "salmon-pink"]) {
    const ramp = rampOf(from(spec));
    for (let index = 1; index < ramp.length; index += 1) {
      assert.ok(
        oklabDistance(ramp[index - 1], ramp[index]) >= 0.04,
        `${spec}: ${ramp[index - 1]} and ${ramp[index]} are indistinguishable`
      );
    }
  }
});

test("two colours that render alike give a palette in one colour rather than invented steps", () => {
  // The degenerate input. `optimal` is still exactly what was named, so the promise holds;
  // there is simply nowhere to go from it.
  const palette = from("teal-teal");
  assert.equal(palette.optimal, "#008080");
  assert.deepEqual(palette.below, []);
  assert.deepEqual(palette.above, []);
});

// ============================================ every combination =================

test("every pair and every triple of the 148 CSS names produces a usable palette", () => {
  // Not all 148 x 148 — that is 21904 ramps and the point is coverage of the SHAPES, not of
  // the arithmetic. Every name appears at least once at each of the three positions.
  const names = Object.keys(CSS_COLOR_NAMES);
  assert.equal(names.length, 148);
  let built = 0;
  for (let index = 0; index < names.length; index += 1) {
    const first = names[index];
    const middle = names[(index + 49) % names.length];
    const last = names[(index + 97) % names.length];
    for (const spec of [`${first}-${last}`, `${first}-${middle}-${last}`]) {
      const palette = completePalette(assertPalette(from(spec), spec));
      assert.match(palette.optimal, /^#[0-9A-Fa-f]{6}$/, spec);
      for (const hex of [...palette.above, ...palette.below]) assert.match(hex, /^#[0-9A-Fa-f]{6}$/, `${spec}: ${hex}`);
      assert.ok(palette.above.length <= 5 && palette.below.length <= 5, spec);
      built += 1;
    }
  }
  assert.equal(built, 296);
});

test("generating twice gives the same colours", () => {
  for (const spec of ["blue-red", "blue-green-red", "gold-navy"]) {
    assert.deepEqual(from(spec), from(spec), spec);
  }
});

// ============================================ the lookup ========================

test("a gradient palette is the card's own work, and says so", () => {
  const palette = paletteForGradient("blue-red");
  assert.equal(palette.origin, "derived", "so the card may adapt it, like every automated palette");
  assert.deepEqual(palette.source.colors, ["#0000FF", "#FF0000"], "and it remembers what it was built from");
  assert.equal(palette.id, "blue-red");
});

test("a registered name and a single colour both win over the split", () => {
  // The order is the whole safeguard. Two shipped palettes are spelled with a hyphen, and
  // five CSS colours can be written either way; every one of them keeps the meaning it had.
  for (const name of ["color-vision", "protan-deutan"]) {
    assert.ok(paletteForName(name), `${name} is a registered palette`);
    assert.equal(paletteForName(name).origin, "builtin");
  }
  for (const joined of ["orangered", "blueviolet", "greenyellow", "limegreen", "yellowgreen"]) {
    assert.ok(paletteForColor(joined), `${joined} is one colour`);
    assert.equal(paletteForColor(joined).below.length + paletteForColor(joined).above.length > 0, true);
  }
  // And the hyphenated spellings of those same five are gradients, because a single-colour
  // lookup cannot resolve them.
  for (const split of ["orange-red", "blue-violet", "green-yellow", "lime-green", "yellow-green"]) {
    assert.equal(paletteForColor(split), null, `${split} is not one colour`);
    assert.ok(paletteForGradient(split), `${split} is a gradient`);
  }
});

test("the lookup takes hexes as readily as names", () => {
  for (const spec of ["1DB85D-FD9808", "#1DB85D-#FD9808", "1DB85D-808080-FD9808"]) {
    const palette = paletteForGradient(spec);
    assert.ok(palette, spec);
    assert.equal(palette.source.colors[0], "#1DB85D", spec);
  }
  // Alpha is dropped from every anchor, for the reason paletteForColor gives: a ramp is a
  // statement about lightness, colourfulness and hue, and transparency does not interpolate
  // into one.
  assert.deepEqual(paletteForGradient("1DB85D80-FD9808").source.colors, ["#1DB85D", "#FD9808"]);
});

test("the lookup declines everything that is not two or three colours", () => {
  // Declining rather than throwing: the configuration layer owns the message, because it is
  // the only layer that knows what the user typed and where.
  for (const value of ["blue", "blue-", "-red", "blue--red", "blue-nonsense", "a-b-c-d", "", 42, null, undefined]) {
    assert.equal(paletteForGradient(value), null, JSON.stringify(value));
  }
  assert.equal(MAX_GRADIENT_COLORS, 3);
});

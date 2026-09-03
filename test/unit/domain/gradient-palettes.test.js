"use strict";

// The gradient palette generator: two or three colours in, a whole ramp out. Boundary: the
// one-colour generator is palette-generation.test.js next door. A gradient ramp has two
// hues and has to travel between them, so most of this is about the journey — the short way
// round the hue circle, no colour nobody named, steps spaced by what a reader sees. The
// shared promise: the named colours are the ends (and, with three, the middle), to the
// digit. See interne Doku §5 „Mehrfarbpaletten: zwei oder drei genannte Farben".

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
// CIEDE2000, which is neither of the two instruments the generators use — see the spacing test.
const { deltaE } = require("../../helpers/color-measurement.js");

test.before(async () => {
  ({ gradientPalette, MAX_GRADIENT_COLORS } = await import("../../../src/domain/classification/palettes/gradient.js"));
  ({ assertPalette, completePalette, paletteForColor, paletteForGradient, paletteForName } = await import(
    "../../../src/domain/classification/palettes/registry.js"
  ));
  ({ parseColorToken, CSS_COLOR_NAMES } = await import("../../../src/core/color.js"));
  ({ hexToOklch, oklabDistance } = await import("../../../src/core/oklch.js"));
});

// The palette a spelling implies, straight from the generator, so these tests are about the
// calculation and not the lookup.
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
  // Stated for a metric with no `below`, where the middle might be expected to be
  // reinterpreted. It is not: colours and thresholds meet at the profile.
  for (const spec of ["blue-green-red", "white-teal-black", "red-yellow-red"]) {
    assert.equal(from(spec).optimal, parseColorToken(spec.split("-")[1]), spec);
  }
});

test("with two colours the middle is on the ramp rather than beside it", () => {
  // The halfway point of the same polar interpolation every step uses, so no kink.
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
  // The long way round passes through green, which nobody writing `blue-red` means.
  const hues = rampOf(from("blue-red")).map((hex) => hexToOklch(hex).hue);
  const green = hues.some((hue) => hue > 120 && hue < 200);
  assert.equal(green, false, `the ramp passed through green: ${hues.map(Math.round).join(", ")}`);
  const violet = hues.some((hue) => hue > 300 && hue < 350);
  assert.equal(violet, true, `no violet in ${hues.map(Math.round).join(", ")}`);
});

test("an achromatic end borrows the hue of the other, rather than travelling to noise", () => {
  // #000000 has no hue; the angle it quantises to is noise, and interpolating towards it
  // would send the ramp through a colour nobody named.
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

test("every spelling gives eleven steps, whatever colours were named", () => {
  // A derived palette answers the card's -5..+5 profiles one to one (WING_STEPS in
  // palettes/geometry.js); the length never depends on the colours.
  for (const spec of ["blue-red", "red-orange", "teal-teal", "black-white", "gold-khaki", "blue-green-red", "red-white-green"]) {
    const palette = from(spec);
    assert.equal(palette.below.length, 5, spec + ": below");
    assert.equal(palette.above.length, 5, spec + ": above");
  }
});

test("the steps are spaced by what a reader sees, not by the interpolation parameter", () => {
  // Regression guard for the gamut-corner defect: a colour like `blue` sits on a corner of
  // sRGB, so equal-parameter steps cost most of its chroma in the first step. A wing whose
  // two ends are the same colour is skipped (no spacing to be even about). Measured with
  // CIEDE2000, neither instrument the card uses, so it does not just agree with itself.
  const NAMES = ["red", "green", "blue", "yellow", "cyan", "magenta", "white", "black", "gray", "teal", "navy", "gold", "orange", "purple", "lime", "pink", "brown", "olive", "maroon", "salmon", "indigo", "turquoise", "crimson", "khaki"];
  let worst = { ratio: 0, spec: null };
  let measured = 0;
  for (const first of NAMES) {
    for (const last of NAMES) {
      if (first === last) continue;
      for (const spec of [first + "-" + last, first + "-green-" + last]) {
        const palette = from(spec);
        for (const wing of [palette.below, palette.above]) {
          const path = [palette.optimal, ...wing];
          const gaps = path.slice(1).map((hex, index) => deltaE(path[index], hex));
          if (Math.max(...gaps) < 1) continue;
          measured += 1;
          const ratio = Math.max(...gaps) / Math.max(Math.min(...gaps), 1e-9);
          if (ratio > worst.ratio) worst = { ratio, spec };
        }
      }
    }
  }
  assert.ok(measured > 1000, "only " + measured + " wings measured");
  // Measured at 5.3 (`magenta-black`).
  assert.ok(worst.ratio <= 5.5, worst.spec + " has a step " + worst.ratio.toFixed(1) + " times its smallest");
});

test("two colours a reader can separate give eleven steps a reader can separate", () => {
  // The length is fixed, so two ends are always reached in five steps. Where the ends are
  // far enough apart, the eleven steps stay separable; the bar is 2.5 ΔE00, and `blue-red`
  // is the binding case at 2.6 because CIEDE2000 compresses hard in the blues.
  for (const spec of ["blue-red", "gold-navy", "teal-crimson", "blue-green-red", "black-white"]) {
    const ramp = rampOf(from(spec));
    for (let index = 1; index < ramp.length; index += 1) {
      assert.ok(
        deltaE(ramp[index - 1], ramp[index]) >= 2.5,
        spec + ": " + ramp[index - 1] + " and " + ramp[index] + " are indistinguishable"
      );
    }
  }

  // Two ends a reader can barely separate give eleven steps they cannot — what was asked for,
  // spread over the tiers it has to fill.
  const close = rampOf(from("red-orangered"));
  assert.equal(close.length, 11);
  assert.ok(
    close.slice(1).every((hex, index) => deltaE(close[index], hex) < 1),
    "two colours this close cannot give eleven separable steps"
  );
});

test("two colours that render alike give a ramp that stands on the colour that was named", () => {
  // Degenerate input: `optimal` is what was named and every step is that colour, because
  // there is nowhere to go from it.
  const palette = from("teal-teal");
  assert.equal(palette.optimal, "#008080");
  assert.deepEqual(palette.below, ["#008080", "#008080", "#008080", "#008080", "#008080"]);
  assert.deepEqual(palette.above, ["#008080", "#008080", "#008080", "#008080", "#008080"]);
});

// ============================================ every combination =================

test("every pair and every triple of the 148 CSS names produces a usable palette", () => {
  // Not all 148 x 148: the point is coverage of the shapes. Every name appears at least once
  // at each of the three positions.
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
  // The order is the safeguard: two shipped palettes and five CSS colours can be written
  // with a hyphen, and every one keeps its meaning.
  for (const name of ["color-vision", "protan-deutan"]) {
    assert.ok(paletteForName(name), `${name} is a registered palette`);
    assert.equal(paletteForName(name).origin, "builtin");
  }
  for (const joined of ["orangered", "blueviolet", "greenyellow", "limegreen", "yellowgreen"]) {
    assert.ok(paletteForColor(joined), `${joined} is one colour`);
    assert.equal(paletteForColor(joined).below.length + paletteForColor(joined).above.length > 0, true);
  }
  // The hyphenated spellings of those five are gradients, since a single-colour lookup
  // cannot resolve them.
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
  // Alpha is dropped from every anchor: transparency does not interpolate into a ramp.
  assert.deepEqual(paletteForGradient("1DB85D80-FD9808").source.colors, ["#1DB85D", "#FD9808"]);
});

test("the lookup declines everything that is not two or three colours", () => {
  // Declining rather than throwing: the configuration layer owns the message.
  for (const value of ["blue", "blue-", "-red", "blue--red", "blue-nonsense", "a-b-c-d", "", 42, null, undefined]) {
    assert.equal(paletteForGradient(value), null, JSON.stringify(value));
  }
  assert.equal(MAX_GRADIENT_COLORS, 3);
});

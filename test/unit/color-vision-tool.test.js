"use strict";

// The measuring instrument, measured.
//
// test/helpers/color-vision.js decides whether the card's colour-blind palettes are
// usable, so a fault in IT would be invisible: the palettes would simply be validated
// against nonsense. That happened once during development — plane coefficients from one
// LMS space paired with the matrices of another — and it produced a simulation in which
// a neutral grey came out green. Nothing downstream could have noticed.
//
// It happened a second time, and worse: the tritan projection was neither Brettel's nor
// Viénot's but a third thing, and it reported red as olive. The invariants below did not
// catch it, because a mathematically wrong projection can satisfy every one of them.
//
// So the tool now answers on two levels. Invariants, which say the transform is a
// simulation at all:
//
//   the neutral axis is fixed        a grey has no hue to lose
//   every matrix row sums to 1       which is WHY the neutral axis is fixed, and the
//                                    cheapest check that the transcription is right
//   red and green collapse           for protan and deutan, and only for them
//   blue and green collapse          for tritan, and only for it
//
// And fixed reference vectors, which say it is the RIGHT simulation. Those numbers were
// produced from the published Brettel matrices, not from this code, and they are what
// would have caught the tritan fault on the spot.
//
// Only then may a palette be measured with it.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BRETTEL,
  DEFICIENCIES,
  contrastRatio,
  deltaE,
  lab,
  measure,
  neutralAxisError,
  simulate,
} = require("../helpers/color-vision.js");

// --------------------------------------------------------- the invariant ----

// The one that would have caught the broken matrix pairing on the spot. A colour on the
// grey axis stimulates all three cone types in the ratio that defines white, so removing
// one cone type cannot move it.
test("every deficiency leaves the neutral axis exactly where it is", () => {
  for (const deficiency of DEFICIENCIES) {
    assert.ok(
      neutralAxisError(deficiency) < 1e-4,
      `${deficiency}: neutral axis moves by ${(neutralAxisError(deficiency) * 100).toFixed(4)} %`
    );
  }
});

test("a grey stays the same grey, not merely a grey", () => {
  for (const deficiency of DEFICIENCIES) {
    for (const grey of ["#000000", "#333333", "#808080", "#CCCCCC", "#FFFFFF"]) {
      const seen = simulate(grey, deficiency);
      assert.ok(deltaE(grey, seen) < 1.5, `${deficiency}: ${grey} -> ${seen}`);
    }
  }
});

// A near-grey is NOT on the axis, and the difference matters: the card's own invalid
// colour is a warm grey, and a tritanope does see it slightly differently. The tool has
// to report that rather than round it away.
test("a tinted grey is not treated as neutral", () => {
  const warmGrey = "#B4B2A9";
  assert.ok(Math.abs(lab(warmGrey)[2]) > 3, "the sample really does carry a tint");
  assert.ok(deltaE(warmGrey, simulate(warmGrey, "tritan")) > 1, "and the tint is reported, not swallowed");
  assert.ok(deltaE(warmGrey, simulate(warmGrey, "tritan")) < 6, "but it stays a small shift, not a hue change");
});

// The reason the neutral axis stays put, checked directly on the constants: a grey has
// equal channels, so a row that sums to 1 returns that grey unchanged. Nine numbers per
// matrix, twelve matrices, and a single mistyped digit shows up here rather than as a
// palette that quietly passed.
test("every published matrix row sums to one, which is what fixes the neutral axis", () => {
  for (const [deficiency, params] of Object.entries(BRETTEL)) {
    for (const half of ["first", "second"]) {
      const matrix = params[half];
      for (let row = 0; row < 3; row += 1) {
        const sum = matrix[row * 3] + matrix[row * 3 + 1] + matrix[row * 3 + 2];
        assert.ok(Math.abs(sum - 1) < 2e-5, `${deficiency}.${half} row ${row + 1} sums to ${sum}`);
      }
    }
  }
});

// ------------------------------------------------ the external reference ----

// Twelve colours through each deficiency, computed from the published Brettel matrices
// and frozen here. This is the check the invariants cannot be: it pins the WHOLE
// pipeline — linearisation, half-plane choice, matrix, clipping, 8-bit rounding — to
// values that did not come from the code under test.
//
// Read them as a sanity check too. Red becomes a dark olive for a protanope and stays
// red for a tritanope; green becomes yellow; white, black and mid grey come back
// untouched from all three.
const REFERENCE = {
  protan: {
    "#FF0000": "#6C5C0C", "#00FF00": "#FFED00", "#0000FF": "#0038FF", "#FFFF00": "#FFFA00",
    "#00FFFF": "#EEF2FF", "#FF00FF": "#006BFF", "#FFFFFF": "#FFFFFF", "#000000": "#000000",
    "#808080": "#808080", "#1DB85D": "#C2AC5C", "#4B0082": "#002282", "#FF8C00": "#B59C08",
  },
  deutan: {
    "#FF0000": "#A48B00", "#00FF00": "#F1D12E", "#0000FF": "#0057FE", "#FFFF00": "#FFF316",
    "#00FFFF": "#D1DFFF", "#FF00FF": "#67A1FC", "#FFFFFF": "#FFFFFF", "#000000": "#000000",
    "#808080": "#808080", "#1DB85D": "#A99962", "#4B0082": "#003881", "#FF8C00": "#CCAF00",
  },
  tritan: {
    "#FF0000": "#FF004E", "#00FF00": "#79E9FF", "#0000FF": "#006288", "#FFFF00": "#FFEEF1",
    "#00FFFF": "#47F8FF", "#FF00FF": "#EF667A", "#FFFFFF": "#FFFFFF", "#000000": "#000000",
    "#808080": "#808080", "#1DB85D": "#54ABC6", "#4B0082": "#373232", "#FF8C00": "#FF8092",
  },
};

test("the simulation reproduces the published Brettel reference, colour for colour", () => {
  for (const deficiency of DEFICIENCIES) {
    for (const [input, expected] of Object.entries(REFERENCE[deficiency])) {
      assert.equal(simulate(input, deficiency), expected, `${deficiency}: ${input}`);
    }
  }
});

// ------------------------------------------------- the confusions, by type ---

const RED = "#DD3333";
const GREEN = "#33CC33";
const BLUE = "#3366CC";

// Equiluminant probes: lightness survives every dichromacy, so two colours of different
// lightness stay apart no matter which cone is missing. Only a matched pair isolates hue,
// which is what these tests are about.
const BLUE_EQ = "#6E8FD8";
const GREEN_EQ = "#5BA96B";

// The defining symptom of red-green deficiency, and the reason the card's own pastel ramp
// needs an alternative at all: to a protanope or a deuteranope, "optimal" and "critical"
// are the same colour.
test("red and green collapse for protan and deutan, and stay apart for tritan", () => {
  const normal = deltaE(RED, GREEN);
  assert.ok(normal > 40, `normal vision must see them far apart, got ${normal.toFixed(1)}`);
  for (const deficiency of ["protan", "deutan"]) {
    const seen = deltaE(simulate(RED, deficiency), simulate(GREEN, deficiency));
    assert.ok(seen < normal / 2, `${deficiency}: ${seen.toFixed(1)} must be far below ${normal.toFixed(1)}`);
  }
  const tritan = deltaE(simulate(RED, "tritan"), simulate(GREEN, "tritan"));
  assert.ok(tritan > 40, `tritan keeps red and green apart, got ${tritan.toFixed(1)}`);
});

// The mirror image. Note WHICH pair: "blue-yellow deficiency" is the clinical name, but
// the colours a tritanope actually confuses are blue with GREEN. Designing a palette from
// the name rather than from this measurement would put its cold end exactly where it
// disappears.
test("blue and green collapse for tritan, and stay apart for protan and deutan", () => {
  const normal = deltaE(BLUE_EQ, GREEN_EQ);
  assert.ok(normal > 25, `normal vision must see them apart, got ${normal.toFixed(1)}`);
  const tritan = deltaE(simulate(BLUE_EQ, "tritan"), simulate(GREEN_EQ, "tritan"));
  assert.ok(tritan < normal / 3, `tritan: ${tritan.toFixed(1)} must be far below ${normal.toFixed(1)}`);
  for (const deficiency of ["protan", "deutan"]) {
    const seen = deltaE(simulate(BLUE_EQ, deficiency), simulate(GREEN_EQ, deficiency));
    assert.ok(seen > 20, `${deficiency} keeps blue and green apart, got ${seen.toFixed(1)}`);
  }
});

// And the pair a tritan palette can rely on.
test("red and green stay apart for tritan, which is what its palette is built on", () => {
  const seen = deltaE(simulate(RED, "tritan"), simulate(GREEN, "tritan"));
  assert.ok(seen > 40, `tritan: red and green must stay apart, got ${seen.toFixed(1)}`);
});

// A dichromat's vision is a projection: applying it to what they already see should
// change nothing. It holds here for every colour whose projection lands inside sRGB —
// the residual is eight-bit rounding.
//
// It does NOT hold where the projection lands outside sRGB and is clipped, because a
// clipped colour is no longer on the plane. Measured over the cube: about one colour in
// five clips, and a second pass then moves it by up to dE00 7,3, against 0,8 for the rest.
// That is the price of matching the reference's own gamut handling, and it is written
// down here rather than hidden behind a loose threshold.
test("simulating twice changes nothing, except where the reference had to clip", () => {
  for (const deficiency of DEFICIENCIES) {
    for (const hex of [RED, GREEN, BLUE, "#DDCC33", "#79A86C", "#8A88C9", "#808080"]) {
      const once = simulate(hex, deficiency);
      const twice = simulate(once, deficiency);
      assert.ok(deltaE(once, twice) < 1, `${deficiency}: ${hex} -> ${once} -> ${twice}`);
    }
  }
  // Pure blue is the clipping case, named rather than excluded.
  const clipped = simulate("#0000FF", "deutan");
  assert.ok(deltaE(clipped, simulate(clipped, "deutan")) < 8, "a clipped projection drifts, and by how much is known");
});

test("normal vision is the identity, so all four can be swept without a special case", () => {
  for (const hex of [RED, BLUE, "#79A86C"]) assert.equal(simulate(hex, "normal"), hex.toUpperCase());
  assert.throws(() => simulate(RED, "nonsense"), /unknown deficiency/);
});

// ----------------------------------------------------------- the metrics ----

test("deltaE is zero for a colour against itself and symmetric between two", () => {
  assert.equal(deltaE(RED, RED), 0);
  assert.ok(Math.abs(deltaE(RED, BLUE) - deltaE(BLUE, RED)) < 1e-9);
  // A just-noticeable difference is around 1; these two are unmistakable.
  assert.ok(deltaE("#808080", "#818181") < 1);
  assert.ok(deltaE(RED, BLUE) > 40);
});

test("contrast is measured against both card backgrounds, and matches the known anchors", () => {
  // The two extremes of the WCAG definition, which fixes the direction and the scale.
  assert.ok(Math.abs(contrastRatio("#000000", "#FFFFFF") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#FFFFFF", "#FFFFFF") - 1) < 0.01);
  assert.ok(Math.abs(contrastRatio("#FFFFFF", "#000000") - 21) < 0.01, "the order of the arguments must not matter");
});

// ------------------------------------------------------------- measure() ----

test("measure() reports a diverging palette from its own middle outwards", () => {
  const palette = {
    optimal: "#808080",
    below: ["#6E86A8", "#5A8CC8", "#3F90E8"],
    above: ["#A8806E", "#C8785A", "#E8703F"],
  };
  const normal = measure(palette, "normal");
  assert.equal(normal.monotone, true, "each step out is further from the middle than the last");
  assert.ok(normal.lowWing > 10 && normal.highWing > 10);
  assert.ok(normal.ends > normal.lowWing, "the two ends are further apart than either is from the middle");
  // The reported range must be the real one, ordered low to high — this used to compare a
  // value with itself and therefore asserted nothing at all.
  const lightness = [...palette.below, palette.optimal, ...palette.above].map((hex) => lab(hex)[0]);
  assert.deepEqual(normal.lightnessRange, [Math.min(...lightness), Math.max(...lightness)]);
  assert.ok(normal.lightnessRange[0] < normal.lightnessRange[1]);
  // And the neighbour gap, which is a different claim from how far the ends reach.
  assert.ok(normal.minStep > 0 && normal.minStep < normal.lowWing);
  // A palette whose wings do not grow outwards is not diverging, and must say so.
  const flat = { optimal: "#808080", below: ["#808080", "#808080"], above: ["#808080", "#808080"] };
  assert.equal(measure(flat, "normal").monotone, false);
});

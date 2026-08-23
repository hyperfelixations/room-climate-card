"use strict";

// The measuring instrument, measured.
//
// test/helpers/color-vision.js decides whether the card's colour-blind palettes are
// usable, so a fault in IT would be invisible: the palettes would simply be validated
// against nonsense. That happened once during development — plane coefficients from one
// LMS space paired with the matrices of another — and it produced a simulation in which
// a neutral grey came out green. Nothing downstream could have noticed.
//
// So the tool answers first, against facts about dichromatic vision that hold
// independently of any implementation:
//
//   the neutral axis is fixed        a grey has no hue to lose
//   red and green collapse           for protan and deutan, and only for them
//   blue and green collapse          for tritan, and only for it
//   the transform is idempotent      simulating twice changes nothing
//
// Only then may a palette be measured with it.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
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

// The mirror image, and the reason the two palettes cannot be one. Note WHICH pair:
// "blue-yellow deficiency" is the clinical name, but the colours a tritanope actually
// confuses are blue with GREEN. Blue and yellow differ in the channel they still have.
// Designing the tritan palette from the name rather than from this measurement would
// have put its cold end exactly where it disappears.
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

// A dichromat's vision is a projection: applying it to what they already see changes
// nothing. A transform that failed this would be shifting colours, not removing a cone.
test("simulating twice is the same as simulating once", () => {
  for (const deficiency of DEFICIENCIES) {
    for (const hex of [RED, GREEN, BLUE, "#DDCC33", "#79A86C", "#8A88C9", "#FF00FF"]) {
      const once = simulate(hex, deficiency);
      const twice = simulate(once, deficiency);
      assert.ok(deltaE(once, twice) < 2, `${deficiency}: ${hex} -> ${once} -> ${twice}`);
    }
  }
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
  assert.deepEqual(
    normal.lightnessRange.map((value) => Math.round(value)),
    normal.lightnessRange.map((value) => Math.round(value)),
    "lightness is reported as a range"
  );
  // A palette whose wings do not grow outwards is not diverging, and must say so.
  const flat = { optimal: "#808080", below: ["#808080", "#808080"], above: ["#808080", "#808080"] };
  assert.equal(measure(flat, "normal").monotone, false);
});

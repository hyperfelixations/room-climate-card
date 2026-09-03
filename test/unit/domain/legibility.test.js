"use strict";

// Moving a colour just far enough to be seen without changing what colour it is: the
// primitive under every repair the card makes. Two properties carry the design and are
// tested here — nearness (a repair that overshoots is over-steering) and hue preservation
// (a `palette: yellow` that comes back green is not a repair).

const test = require("node:test");
const assert = require("node:assert/strict");

let legibility;
let oklch;

test.before(async () => {
  legibility = await import("../../../src/domain/classification/legibility.js");
  oklch = await import("../../../src/core/oklch.js");
});

// The separation the card asks of a status pill, which is the largest bar in the system.
const REQUIRED = 0.232;
const clears = (hex, backgrounds, required = REQUIRED) =>
  backgrounds.every((background) => oklch.screenDistance(hex, background) >= required);

// Below this chroma a hue angle is quantisation noise (a hex carries a and b to ~0.004), so
// a near-neutral colour gets the assertion that means something instead: it stays
// near-neutral.
const HAS_HUE = 0.04;
const hueGap = (a, b) => {
  const difference = Math.abs(oklch.hexToOklch(a).hue - oklch.hexToOklch(b).hue) % 360;
  return Math.min(difference, 360 - difference);
};

// ================================================ the colour comes back as itself =====

test("a colour that is already clear comes back untouched, by identity", () => {
  // Proof that nothing was rebuilt: a freshly computed equal colour would drift by a bit
  // somewhere downstream.
  for (const [hex, background] of [["#000000", "#FFFFFF"], ["#FFFFFF", "#1C1C1C"], ["#17A93F", "#FFFFFF"]]) {
    assert.equal(legibility.legibleVariant(hex, [background], REQUIRED), hex, hex + " on " + background);
  }
});

test("a colour that is not clear comes back clear, and still the same colour", () => {
  const CASES = [
    ["#FFFF00", ["#FFFFFF"], "yellow on white"],
    ["#D2FBCD", ["#FFFFFF"], "the palest step of a lime ramp on white"],
    ["#000080", ["#1C1C1C"], "navy on the dark card"],
    ["#79A86C", ["#808080"], "the middle of pastel on mid grey"],
    ["#B4B2A9", ["#FFFFFF"], "the warm grey pastel uses for an invalid reading, on white"],
    ["#0000FF", ["#0A2A4F"], "blue on a dark blue card-mod sheet"],
  ];
  for (const [hex, backgrounds, why] of CASES) {
    const moved = legibility.legibleVariant(hex, backgrounds, REQUIRED);
    assert.ok(moved, why + ": no answer at all");
    assert.match(moved, /^#[0-9A-F]{6}$/, why);
    assert.ok(clears(moved, backgrounds), why + ": " + moved + " still does not clear");
    const before = oklch.hexToOklch(hex);
    const after = oklch.hexToOklch(moved);
    if (before.chroma >= HAS_HUE) {
      assert.ok(
        hueGap(hex, moved) < 1.5,
        why + ": hue moved from " + before.hue.toFixed(1) + " to " + after.hue.toFixed(1)
      );
    } else {
      assert.ok(after.chroma < HAS_HUE, why + ": a near-neutral colour must stay near-neutral, got chroma " + after.chroma.toFixed(3));
    }
  }
});

test("the answer is the nearest one, so nothing moves further than it has to", () => {
  // Minimally invasive: anything strictly between the colour and where it landed must still
  // fail, or a closer answer existed.
  const CASES = [
    ["#FFFF00", ["#FFFFFF"]],
    ["#000080", ["#1C1C1C"]],
    ["#79A86C", ["#808080"]],
    ["#B4B2A9", ["#FFFFFF"]],
  ];
  for (const [hex, backgrounds] of CASES) {
    const moved = legibility.legibleVariant(hex, backgrounds, REQUIRED);
    const from = oklch.hexToOklch(hex);
    const to = oklch.hexToOklch(moved);
    const span = to.lightness - from.lightness;
    assert.notEqual(span, 0, hex + ": it had to move");
    // Integer shares: nine tenths avoids landing on the answer itself.
    for (let tenth = 1; tenth <= 9; tenth += 1) {
      const between = oklch.oklchToHex({ lightness: from.lightness + (span * tenth) / 10, chroma: from.chroma, hue: from.hue });
      assert.equal(
        clears(between, backgrounds),
        false,
        hex + " -> " + moved + ": " + between + " already clears at " + tenth * 10 + "% of the way, so the move overshot"
      );
    }
  }
});

test("it goes the shorter way: a step near the dark end is lightened, one near white darkened", () => {
  const lightened = legibility.legibleVariant("#0C0C0C", ["#1C1C1C"], REQUIRED);
  assert.ok(
    oklch.hexToOklch(lightened).lightness > oklch.hexToOklch("#0C0C0C").lightness,
    lightened + " should have gone up"
  );
  const darkened = legibility.legibleVariant("#F6F8D0", ["#FFFFFF"], REQUIRED);
  assert.ok(
    oklch.hexToOklch(darkened).lightness < oklch.hexToOklch("#F6F8D0").lightness,
    darkened + " should have gone down"
  );
});

// ================================================ one direction at a time =============

test("a direction that runs out says so instead of returning the end of the range", () => {
  // Black cannot get darker; null is what lets a caller try the other way rather than paint
  // #000000 and call it a repair.
  assert.equal(legibility.lightnessThatClears("#000000", ["#1C1C1C"], REQUIRED, -1), null);
  assert.equal(legibility.lightnessThatClears("#FFFFFF", ["#FEFEFE"], REQUIRED, 1), null);
  assert.ok(legibility.lightnessThatClears("#000000", ["#1C1C1C"], REQUIRED, 1) > 0);
});

test("with backgrounds at both ends there may be no answer at all", () => {
  // A white-to-black gradient contains every lightness; no fixed-hue colour clears a large
  // bar against all of it.
  const everyLightness = Array.from({ length: 11 }, (_, index) => {
    const channel = Math.round((index / 10) * 255).toString(16).padStart(2, "0").toUpperCase();
    return "#" + channel + channel + channel;
  });
  assert.equal(legibility.legibleVariant("#808080", everyLightness, REQUIRED), null);
});

test("every background counts, not merely the first", () => {
  const backgrounds = ["#FFFFFF", "#808080"];
  const moved = legibility.legibleVariant("#8A88C9", backgrounds, REQUIRED);
  assert.ok(moved);
  assert.ok(clears(moved, backgrounds), moved);
});

// ================================================ the instrument it relies on =========

test("separation grows as a colour moves away from a background, which is what the search assumes", () => {
  // The search walks outwards and stops at the first lightness that clears — the nearest
  // answer only if separation does not dip back below the bar further out. At most two
  // crossings means one contiguous failing neighbourhood.
  for (const background of ["#FFFFFF", "#1C1C1C", "#808080", "#0A2A4F"]) {
    for (const hue of [0, 60, 140, 200, 264, 320]) {
      for (const chroma of [0, 0.06, 0.14]) {
        let crossings = 0;
        let previous = null;
        for (let step = 0; step <= 100; step += 1) {
          const hex = oklch.oklchToHex({ lightness: step / 100, chroma, hue });
          const above = oklch.screenDistance(hex, background) >= REQUIRED;
          if (previous !== null && above !== previous) crossings += 1;
          previous = above;
        }
        assert.ok(
          crossings <= 2,
          "hue " + hue + ", chroma " + chroma + " on " + background + ": the bar is crossed " + crossings +
            " times, so walking outwards and stopping is not enough"
        );
      }
    }
  }
});

test("the same question always gives the same answer", () => {
  const once = legibility.legibleVariant("#FFFF00", ["#FFFFFF"], REQUIRED);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(legibility.legibleVariant("#FFFF00", ["#FFFFFF"], REQUIRED), once);
  }
});

test("nothing to measure against means nothing to change", () => {
  assert.equal(legibility.legibleVariant("#FFFF00", [], REQUIRED), "#FFFF00");
});

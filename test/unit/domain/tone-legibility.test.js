"use strict";

// THE SECOND REPAIR: making a word readable on a tint of its own colour, without changing the
// colour.
//
// The card paints one colour per score. The scale marker, the accent line, the status pill,
// the header icon and a room chip's mark are all that same colour, and the palette repair next
// door decides whether it moves. What happens HERE is the other half: three of those places
// paint the colour on a tint of ITSELF, and when that tint swallows the colour the answer is a
// thinner tint rather than a different colour.

const test = require("node:test");
const assert = require("node:assert/strict");

let tone;
let color;
let oklch;
let roles;

test.before(async () => {
  tone = await import("../../../src/domain/classification/tone-legibility.js");
  color = await import("../../../src/core/color.js");
  oklch = await import("../../../src/core/oklch.js");
  roles = await import("../../../src/domain/classification/paint-roles.js");
});

// What the status pill asks of a colour: twelve-pixel text at weight 900 on a tint of itself.
const PILL_ALPHA = 0.2;
const separationAt = (hex, alpha, backdrop) =>
  oklch.screenDistance(hex, color.compositeOver(hex, alpha, backdrop));

test("a colour the recipe already suits keeps the tint it was given", () => {
  // The common case, and the one worth keeping exact: a card whose colours are comfortable
  // looks precisely as it always did, down to the alpha in its custom properties.
  const required = 0.232;
  for (const [hex, backdrop] of [["#17A93F", "#FFFFFF"], ["#3B58CF", "#1C1C1C"], ["#CC2B2B", "#FFFFFF"]]) {
    assert.equal(
      tone.legibleTintAlpha(hex, backdrop, PILL_ALPHA, required),
      PILL_ALPHA,
      hex + " on " + backdrop + " reads at the default already"
    );
  }
});

test("a colour its own tint swallows gets a thinner tint, and only as thin as it takes", () => {
  // The case the whole thing exists for. `palette: lime` on a light dashboard: the ramp reads,
  // the pill does not, and the colour is not what is wrong.
  const required = 0.232;
  const cases = [
    ["#00FF00", "#FFFFFF", "the middle of a lime ramp on a light card"],
    ["#C0A752", "#FFFFFF", "the gold step of pastel on white"],
    ["#A7A4A1", "#FFFFFF", "the near-neutral middle of color-vision on white"],
  ];
  for (const [hex, backdrop, why] of cases) {
    assert.ok(separationAt(hex, PILL_ALPHA, backdrop) < required, why + ": it really is unreadable at 0.20");
    const alpha = tone.legibleTintAlpha(hex, backdrop, PILL_ALPHA, required);
    assert.ok(alpha < PILL_ALPHA, why + ": the tint had to come down");
    assert.ok(separationAt(hex, alpha, backdrop) >= required - 1e-6, why + ": and it now reads");

    // AS THIN AS IT TAKES AND NO THINNER. Anything appreciably thicker must still fail, or the
    // repair took more of the tint than it needed to.
    const barelyThicker = Math.min(PILL_ALPHA, alpha + 0.01);
    if (barelyThicker > alpha) {
      assert.ok(
        separationAt(hex, barelyThicker, backdrop) < required,
        why + ": " + barelyThicker.toFixed(3) + " would also have worked, so " + alpha.toFixed(3) + " overshot"
      );
    }
  }
});

test("a colour that cannot be read even with no tint at all takes the thinnest tint there is", () => {
  // The honest limit. At alpha 0 the pill has no fill and the colour sits on the card itself,
  // so the most this can ever reach is the separation the colour has from the card — and the
  // pill asks for nearly half again what a scale marker does. A colour between those two bars
  // is readable as a marker and not as a word.
  //
  // What the repair does there is still the best it can: the thinnest tint, which is never
  // worse than the default and is as close as the recipe gets.
  const required = 0.232;
  const hex = "#ECED44";
  const backdrop = "#FFFFFF";
  assert.ok(separationAt(hex, 0, backdrop) < required, "even with no tint this cannot be read");
  assert.equal(tone.legibleTintAlpha(hex, backdrop, PILL_ALPHA, required), 0);
});

test("the same question always gives the same answer", () => {
  const once = tone.legibleTintAlpha("#00FF00", "#FFFFFF", PILL_ALPHA, 0.232);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(tone.legibleTintAlpha("#00FF00", "#FFFFFF", PILL_ALPHA, 0.232), once);
  }
});

test("the alpha never leaves the range between the floor and the recipe's own default", () => {
  // Two bounds and both matter. Above the default would be a card inventing a heavier tint than
  // the design asked for; below zero is not a tint.
  for (const hex of ["#FFFFFF", "#000000", "#808080", "#00FF00", "#000080", "#FFD700"]) {
    for (const backdrop of ["#FFFFFF", "#1C1C1C", "#808080"]) {
      for (const required of [0.1, 0.232, 0.9]) {
        const alpha = tone.legibleTintAlpha(hex, backdrop, PILL_ALPHA, required);
        assert.ok(alpha >= 0 && alpha <= PILL_ALPHA, hex + " on " + backdrop + " at " + required + ": " + alpha);
      }
    }
  }
});

test("the three places that need this are exactly the roles that paint on a tint of themselves", () => {
  // The map and the repair have to agree about which places are in question. A role that starts
  // painting the colour on a tint of itself and is not repaired here would be a place the card
  // knows it cannot read and does nothing about.
  const selfTinted = roles.SELF_TINTED_ROLES.map((role) => role.id).sort();
  assert.deepEqual(selfTinted, ["chipMark", "metricCard", "toneBand", "toneIcon", "toneLabel"]);

  // Of those, the optimal band tints its FOREGROUND rather than its background — a thinner band
  // is a fainter band, so lowering its alpha would make it harder to see rather than easier.
  // The extremes card is the one left over, and it is a separate question the backlog carries.
  const byId = (id) => roles.PAINT_ROLES.find((role) => role.id === id);
  assert.equal(typeof byId("toneBand").foreground, "function", "the band tints what it paints, not what it paints on");
  assert.equal(byId("toneLabel").foreground, undefined);
  assert.equal(byId("chipMark").foreground, undefined);
});

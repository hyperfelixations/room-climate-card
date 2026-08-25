// WHAT A PALETTE IS SHAPED LIKE, said once and measured once.
//
// Separate from ../palette-fit.js on purpose. "What does this palette look like" is a
// question about the palette alone; "can it be seen here" is a question about a palette AND
// a background. Answering both in one function meant the geometry could not be used without
// a background, and meant every future adaptation method would recompute the same eleven
// Oklch conversions the fit evaluation had already done.
//
// RAMP ORDER, NOT DECLARATION ORDER. The steps come back the way a reader travels them: the
// far end of `below`, inwards to `optimal`, out again along `above`. That is the order in
// which "which part of the palette is in trouble" is a meaningful question — a run of
// colliding steps in the middle is a different problem from one at an end, and only this
// order can tell them apart.
//
// EVERY SHAPE THE CONTRACT ALLOWS. A palette may have both wings, one wing, or neither; it
// may have one step or a hundred; `invalid` may be present or absent. Nothing here special-
// cases any of those — a missing wing is an empty array, and `optimalIndex` falls where it
// falls.

import { hexToOklch } from "../../../core/oklch.js";

// One colour, with the coordinates any adaptation method will want. `offset` is the distance
// from optimal in steps, which is how the card addresses a step everywhere else ("steps from
// optimal"); `index` is the position in ramp order, which is what regions are expressed in.
function describeStep({ key, color, wing, offset, index }) {
  const { lightness, chroma, hue } = hexToOklch(color);
  return { index, key, wing, offset, color, lightness, chroma, hue };
}

export function describePalette(palette) {
  const below = palette.below || [];
  const above = palette.above || [];
  const steps = [];

  // `below` is stored innermost-first (below[0] is one step from optimal), so it is walked
  // backwards to put the far end first.
  for (let offset = below.length; offset >= 1; offset -= 1) {
    steps.push(describeStep({ key: `below:${offset}`, color: below[offset - 1], wing: "below", offset, index: steps.length }));
  }
  const optimalIndex = steps.length;
  steps.push(describeStep({ key: "optimal", color: palette.optimal, wing: "optimal", offset: 0, index: optimalIndex }));
  above.forEach((color, position) => {
    steps.push(describeStep({ key: `above:${position + 1}`, color, wing: "above", offset: position + 1, index: steps.length }));
  });

  const lightnesses = steps.map((step) => step.lightness);

  return Object.freeze({
    id: palette.id,
    origin: palette.origin,
    source: palette.source,
    steps: Object.freeze(steps),
    optimalIndex,
    counts: Object.freeze({ below: below.length, above: above.length, total: steps.length }),
    // Painted, but not a point on the scale — see the note in palette-fit.js. Kept out of
    // `steps` so that nothing which walks the ramp accidentally walks over it.
    invalid: palette.invalid
      ? Object.freeze(describeStep({ key: "invalid", color: palette.invalid, wing: "invalid", offset: null, index: null }))
      : null,
    lightnessSpan: Object.freeze({ min: Math.min(...lightnesses), max: Math.max(...lightnesses) }),
  });
}

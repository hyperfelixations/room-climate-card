// The geometry of a palette: its steps in ramp order with Oklch coordinates, plus the path
// helpers the derived generators share.
//
// Ramp order is reader order — the far end of `below`, in to `optimal`, out along `above` — so
// "which part of the ramp is in trouble" is a meaningful question. Kept separate from
// ../palette-fit.js: shape is a question about the palette alone, fit about a palette and a
// background. Every shape the contract allows is handled without special-casing: both wings,
// one, or none; one step or a hundred; `invalid` present or absent.

import { hexToOklch, oklchToHex, screenDistance } from "../../../core/oklch.js";

// Steps per wing of a DERIVED ramp — always five, both sides. The card's own profiles run
// -5..+5, so a computed ramp maps onto them one to one; a different length would quietly
// re-map every tier onto a different colour. Built-in and written-out palettes are not bound
// by this (`signal` is two a wing on purpose). See interne Doku §5 „Farbpaletten".
export const WING_STEPS = 5;

// How far apart a wing AIMS to space its steps, in screenDistance(). An aim, not a filter:
// with wing length fixed, a wing aimed too close to its base is pushed outwards until its path
// is long enough to hold five steps this far apart (monochrome.js reachedOut()). 0.04 is
// bracketed against the 148-name table (median tightest pair 3.74, worst wing ratio 4.3);
// below ~0.016 two colours become one (see MIN_VISIBLE_STEP).
export const MIN_STEP = 0.04;

// The shorter way round the hue circle, in degrees.
function shorterArc(from, to) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

// One colour between two, at `t` in [0, 1]. L and chroma travel straight; hue takes the
// shorter arc, so a ramp rounds the hue circle rather than crossing the muddy RGB interior.
export function mix(from, to, t) {
  return {
    lightness: from.lightness + (to.lightness - from.lightness) * t,
    chroma: from.chroma + (to.chroma - from.chroma) * t,
    hue: from.hue + shorterArc(from.hue, to.hue) * t,
  };
}

// How finely a path is walked before its steps are placed on it. Enough for a good cumulative
// length, cheap enough to stay a once-per-configuration cost; the placement stops moving well
// before this.
const PATH_SAMPLES = 32;

// How long a path looks on screen, measured as it will be PAINTED. Two corrections: the path
// is walked, not measured end to end, because sRGB is not a box in Oklch and a path may ask
// for chroma the gamut cannot give; and screenDistance() is used, not plain Oklab distance,
// which overstates the dark end (by Oklab, a `palette: black` ramp's first pale step is 1.8
// apart in CIEDE2000 and its third 17.1).
export function pathLength(from, to) {
  let length = 0;
  let previous = null;
  for (let index = 0; index <= PATH_SAMPLES; index += 1) {
    const color = oklchToHex(mix(from, to, index / PATH_SAMPLES));
    if (previous) length += screenDistance(previous, color);
    previous = color;
  }
  return length;
}

// Where the steps sit along a path — spaced by perceived distance, not by the interpolation
// parameter. sRGB holds far more chroma at some hues/lightnesses than others, and a colour on
// a gamut corner (`blue` #0000FF) loses almost all its chroma in the first equal-`t` step, so
// even `t` gives a ramp that jumps then crawls. The path is walked densely, its painted length
// measured with screenDistance(), and steps placed at even shares of that length. The named
// endpoints do not move.
export function placeAlong(from, to, steps) {
  const path = [];
  let length = 0;
  let previous = null;
  for (let index = 0; index <= PATH_SAMPLES; index += 1) {
    const t = index / PATH_SAMPLES;
    const color = oklchToHex(mix(from, to, t));
    if (previous) length += screenDistance(previous, color);
    path.push({ t, length });
    previous = color;
  }

  // A zero-length path — two colours that render identically — has nowhere to put a step; fall
  // back to the parameter, which puts every step on that one colour.
  if (length <= 0) return Array.from({ length: steps }, (_, index) => (index + 1) / steps);

  const positions = [];
  let cursor = 1;
  for (let step = 1; step <= steps; step += 1) {
    const target = (length * step) / steps;
    while (cursor < path.length - 1 && path[cursor].length < target) cursor += 1;
    const before = path[cursor - 1];
    const after = path[cursor];
    const span = after.length - before.length;
    // Linear inside one dense sample, which is as fine as the path was measured.
    positions.push(span > 0 ? before.t + ((target - before.length) / span) * (after.t - before.t) : after.t);
  }
  return positions;
}

// The floor for "would a reader see two steps here", in screenDistance() — the instrument the
// whole visibility layer is calibrated on. Bracketed by rendered pairs; interne Doku §5
// „Die Transformation…" refers back here:
//
//   0.0027   #020202 / #000000   one colour   (CIEDE2000 0.31)
//   0.0129   #0C0C0C / #020202   one colour   (CIEDE2000 1.61)
//   0.0156   #0C0C0C / #000000   one colour, tightest pair the card ships   (1.93)
//   0.0206   #FFB147 / #F8AA3E   one colour   (1.80)
//   ----------------------------------------------------------------------------
//   0.0275   #8A88C9 / #8192C8   two, pastel's tightest pair   (5.12)
//
// 0.022 sits in the gap. NOT used to build a ramp (the generators keep MIN_STEP); used to
// refuse a repair that would leave a ramp tighter than it found it, and to keep a rebuilt
// ramp's two wings apart.
export const MIN_VISIBLE_STEP = 0.022;

// One colour with the coordinates an adaptation method needs. `offset` is steps from optimal
// (how a step is addressed elsewhere); `index` is position in ramp order (what regions use).
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
    // Painted, but not a point on the scale (see palette-fit.js). Kept out of `steps` so
    // nothing that walks the ramp walks over it.
    invalid: palette.invalid
      ? Object.freeze(describeStep({ key: "invalid", color: palette.invalid, wing: "invalid", offset: null, index: null }))
      : null,
    lightnessSpan: Object.freeze({ min: Math.min(...lightnesses), max: Math.max(...lightnesses) }),
  });
}

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

import { hexToOklch, oklchToHex, screenDistance } from "../../../core/oklch.js";

// HOW MANY STEPS A WING OF A DERIVED RAMP HAS. Always this many, on both sides.
//
// A DERIVED PALETTE IS THE CARD'S OWN WORK, and the card's own classification profiles run
// from -5 to +5. `palette: teal` and `palette: blue-red` are answers the card computes to a
// question the card also asks, so the two map one to one and the middle of one is the middle
// of the other. A generated ramp that came back three steps long would be the card disagreeing
// with itself.
//
// The generators used to SHORTEN a wing when its steps came out too close to tell apart —
// `gold` got three pale steps instead of five, `white` none at all — on the reasoning that
// three colours a reader can separate beat five they cannot. That reasoning is sound about
// colours and wrong about this contract: a wing of a different length quietly re-maps every
// tier onto a different colour, and which colours a reader can separate is a question about
// the ramp that ../legible.js answers where it can act on it. So the length is fixed here and
// the separation is judged there.
//
// Written-out palettes and the four the card ships are NOT bound by this: `signal` is two
// steps a wing on purpose, and a palette somebody typed is theirs.
export const WING_STEPS = 5;

// HOW FAR APART A WING AIMS TO PUT ITS STEPS, in the same screen distance everything else
// here is measured in.
//
// AN AIM, NOT A FILTER, and it used to be the other way round. This number decided how many
// steps a wing had — the length was the longest that cleared it — and with the length fixed it
// decides how far a wing TRAVELS instead: a wing aimed too close to its base is pushed further
// out until the path it walks is long enough to hold five steps this far apart, or until it
// reaches the edge of the space.
//
// Bracketed against the ramps the card produces, by what the aim does to the whole 148-name
// table (tightest neighbouring pair, CIEDE2000, median):
//
//   0.016   the floor where two colours become one — see MIN_VISIBLE_STEP. Aiming here gives
//           a median of 2.07 and puts near-identical pairs back into `blue` and `navy`.
//   0.04    median 3.74, worst wing ratio 4.3. What the generators aimed at before, and what
//           they aim at now.
//
// The number is the one it always was; the instrument is not. It used to be a plain Oklab
// distance, which overstates the dark end — see pathLength() below.
export const MIN_STEP = 0.04;

// The shorter way round the hue circle, in degrees.
function shorterArc(from, to) {
  return (((to - from) % 360) + 540) % 360 - 180;
}

// One colour between two, at `t` in [0, 1]. Lightness and chroma travel straight; hue takes
// the shorter arc, so a ramp goes round the circle rather than through the muddy interior a
// straight RGB blend crosses.
export function mix(from, to, t) {
  return {
    lightness: from.lightness + (to.lightness - from.lightness) * t,
    chroma: from.chroma + (to.chroma - from.chroma) * t,
    hue: from.hue + shorterArc(from.hue, to.hue) * t,
  };
}

// HOW FINELY A PATH IS WALKED before its steps are placed on it. Enough that the cumulative
// length is a good estimate, small enough that building a palette stays a once-per-
// configuration cost; measured, the placement stops moving well before this.
const PATH_SAMPLES = 32;

// HOW LONG A PATH LOOKS ON A SCREEN, measured as it will actually be PAINTED rather than as it
// was asked for.
//
// TWO CORRECTIONS, and both matter. The path is walked rather than measured end to end,
// because sRGB is not a box in Oklch: a path that asks for chroma the gamut cannot give
// somewhere along it is shorter than its endpoints suggest. And it is measured with
// screenDistance() rather than the plain Oklab distance, because Oklab takes a cube root and
// overstates differences at the dark end — measured, spacing a `palette: black` ramp by the
// plain distance put its first pale step 1.8 apart in CIEDE2000 and its third 17.1, because
// the arithmetic thought the near-blacks were further apart than a lit room shows them. The
// same instrument decides everywhere else whether a reader would notice something; it decides
// here too.
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

// WHERE THE STEPS GO ALONG A PATH, spaced by what a reader SEES rather than by the
// interpolation parameter.
//
// The two are not the same, and the difference is visible. At some hues and lightnesses sRGB
// holds far more chroma than at others, and a colour like `blue` (#0000FF) sits right on a
// corner of it. Stepping away from such a colour by equal t costs almost all of its chroma in
// the first step, because the chroma the interpolation asks for is not available at the new
// hue and gets reduced to fit (see oklchToHex). The result is a ramp that jumps and then
// crawls: measured across 1100 name pairs, the worst step of `blue-green-red` was 4.6 times
// its smallest, and every one of the outliers had a gamut corner at one end. The same defect
// sat unseen in the single-colour generator, where shortening the wing used to hide it —
// `palette: blue` came back with a first deep step three times the size of the four after it.
//
// Measured with screenDistance for the reason written above pathLength(): at the dark end the
// plain Oklab distance spaces a ramp by an arithmetic nobody sees. Over the 148 generated
// ramps that took the worst wing from a step 9.7 times its smallest down to 4.3.
//
// So the path is walked densely first, its length measured as it will be painted, and the
// steps placed at even shares of that length. Where the colour changes fast the steps bunch
// up; where it crawls they spread out. The named endpoints do not move — they are the ends.
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

  // A path with no length at all — two colours that render identically — has nowhere to put a
  // step, and even spacing of nothing is still nothing. Fall back to the parameter, which puts
  // every step on the same colour, because that is what the path is.
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

// THE SAME QUESTION ASKED OF A SCREEN, and it is not the same number.
//
// MIN_STEP is a plain Oklab distance, and Oklab takes a cube root: at the dark end it reports
// large differences between colours a lit room shows as one. `palette: black` ships a
// neighbouring pair 0.150 apart in Oklab — nearly four times what MIN_STEP asks — and that
// pair is #0C0C0C beside #000000. On a screen it is one colour.
//
// So a check that has to answer "would a reader see two steps here" uses screenDistance(), the
// instrument the whole visibility layer is calibrated on, and a floor bracketed the same way
// as everything else here: by pairs that were rendered and looked at.
//
//   0.0027   #020202 beside #000000. One colour. (CIEDE2000 0.31)
//   0.0129   #0C0C0C beside #020202. One colour. (CIEDE2000 1.61)
//   0.0156   #0C0C0C beside #000000, the tightest pair the card ships. One. (CIEDE2000 1.93)
//   0.0206   #FFB147 beside #F8AA3E. One.        (CIEDE2000 1.80)
//   ---------------------------------------------------------------
//   0.0275   #8A88C9 beside #8192C8, the tightest pair pastel ships. Two. (CIEDE2000 5.12)
//
// 0.022 sits in the gap, and it is where every repair the card can produce keeps the spacing
// it started with. None of the invisible pairs above is hypothetical: the first three are what
// an unbounded repair of `palette: black` on a dark card produced — three steps written three
// ways and painted as one — and the fourth is the deep wing `palette: orange` came back with
// on a mid grey card while the bar was lower.
//
// It is NOT used to build a ramp — the generators keep their own bar, and changing that would
// move colours the card ships today. It is used to refuse a repair that would leave a ramp
// tighter than it found it, and to keep the two wings of a rebuilt ramp apart from each other.
export const MIN_VISIBLE_STEP = 0.022;

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

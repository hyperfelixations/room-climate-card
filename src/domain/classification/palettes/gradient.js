// A palette DERIVED FROM TWO OR THREE COLOURS the user named, joined by hyphens.
//
//   palette: blue-red            the two ends; the middle is worked out
//   palette: blue-green-red      the two ends and the middle, all three named
//
// WHY THIS EXISTS ALONGSIDE ./monochrome.js. One colour is the shortest useful thing a
// person can say about a ramp, and it costs them the one quality a diverging scale most
// wants: hue is what tells a reader WHICH WAY, and a single hue has none to spare (the
// reasoning is written out in monochrome.js). Two colours give it back for the price of one
// more word, and three let somebody place the middle themselves.
//
// THE PROMISE IS THE SAME ONE: the colours you name are the colours you get. The first is
// the outermost step of `below`, the last the outermost step of `above`, exactly as written,
// and with three the middle is `optimal` exactly as written. Everything between them is
// interpolated; nothing named is moved.
//
// THE MIDDLE OF A THREE-COLOUR PALETTE IS ALWAYS `optimal`, whatever the classification
// underneath happens to look like. A palette is a set of colours and a classification is a
// set of thresholds; the two meet at the profile, not here. Somebody who writes
// `blue-green-red` for a metric with nothing below its optimum still gets green in the
// middle — and gets the blue wing the profile never asks for, which costs nothing.
//
// POLAR INTERPOLATION, ALWAYS, ALONG THE SHORTER ARC. In Oklch, so a ramp travels round the
// hue circle rather than through the muddy interior a straight RGB blend crosses. `blue-red`
// therefore goes through violet, and that is the right answer rather than a compromise: the
// short way round from blue to red IS violet, and a reader following the ramp sees one
// continuous turn. Somebody who wants white in the middle has a way to say so — they name it.
//
// MORE THAN THREE IS REFUSED, in the configuration layer where the message can name the
// part at fault. Four anchors would need a rule for where the extra ones sit relative to
// `optimal`, and there is no reading of "the middle" that survives an even number of them.

import { hexToOklch, oklabDistance, oklchToHex } from "../../../core/oklch.js";

// The reach of every built-in profile, and of a full-length monochrome ramp, so a profile
// and a full-length generated palette map one to one.
const MAX_STEPS = 5;

// Two or three, and the refusal of a fourth is a design decision rather than a limit.
// Four anchors would need a rule for where the extra ones sit relative to `optimal`, and no
// reading of "the middle" survives an even number of them.
export const MAX_GRADIENT_COLORS = 3;

// How far apart two neighbouring steps have to look before the ramp may claim them as two.
// Oklab units, where the distance is the perceived difference; several times just noticeable.
// The same number monochrome.js uses, and for the same reason.
const MIN_STEP = 0.04;

// Below this chroma a colour's hue angle is rounding noise rather than a hue.
//
// It matters here more than anywhere else, because a hue that is noise gets INTERPOLATED
// TOWARDS: without this, `black-red` would travel from whatever angle #000000 happens to
// quantise to, and the ramp would pass through a colour nobody named. The rule is to borrow
// the other end's hue, so `black-red` runs through dark reds and `black-white` — where
// neither end has a hue — stays a pure lightness ramp with no hue to borrow.
//
// monochrome.js solves the same problem without a threshold, by scaling chroma
// proportionally so an achromatic base keeps none. That works when there is one hue and
// cannot work when there are two, because the question here is not how much chroma to use
// but which of two angles to believe.
const ACHROMATIC_CHROMA = 0.01;

// The shorter way round the hue circle, in degrees.
function shorterArc(from, to) {
  const difference = ((to - from) % 360 + 540) % 360 - 180;
  return difference;
}

// One colour between two, at `t` in [0, 1]. Lightness and chroma travel straight; hue takes
// the shorter arc.
function mix(from, to, t) {
  return {
    lightness: from.lightness + (to.lightness - from.lightness) * t,
    chroma: from.chroma + (to.chroma - from.chroma) * t,
    hue: from.hue + shorterArc(from.hue, to.hue) * t,
  };
}

// The two ends with any noise-hue replaced by the hue of the end that has one.
//
// Returns the pair unchanged when both are colourful and when neither is: two grey ends have
// no hue to borrow, and the interpolation of two zero chromas stays at zero whatever the
// angles say.
function agreeOnHue(first, second) {
  const firstIsGrey = first.chroma < ACHROMATIC_CHROMA;
  const secondIsGrey = second.chroma < ACHROMATIC_CHROMA;
  if (firstIsGrey === secondIsGrey) return [first, second];
  return firstIsGrey ? [{ ...first, hue: second.hue }, second] : [first, { ...second, hue: first.hue }];
}

// HOW FINELY THE PATH IS WALKED before the steps are placed on it. Enough that the
// cumulative length is a good estimate and small enough that building a palette stays a
// once-per-configuration cost; measured, the placement stops moving well before this.
const PATH_SAMPLES = 64;

// WHERE THE STEPS GO ALONG THE PATH, spaced by what a reader SEES rather than by the
// interpolation parameter.
//
// The two are not the same, and the difference is visible. sRGB is not a box in Oklch: at
// some hues and lightnesses it holds far more chroma than at others, and a colour like
// `blue` (#0000FF) sits right on a corner of it. Stepping away from such a colour by equal
// t costs almost all of its chroma in the first step, because the chroma the interpolation
// asks for is not available at the new hue and gets reduced to fit (see oklchToHex). The
// result was a ramp that jumped from blue to teal and then crawled: measured across 1100
// name pairs, the worst step of `blue-green-red` was 4.6 times its smallest, and every one
// of the outliers had a gamut corner at one end.
//
// So the path is walked densely first, its length measured in Oklab as it will actually be
// PAINTED, and the steps placed at even shares of that length. Where the colour changes
// fast the steps bunch up; where it crawls they spread out. The named endpoints do not
// move — they are the ends of the path.
function placeAlong(from, to, steps) {
  const path = [];
  let length = 0;
  let previous = null;
  for (let index = 0; index <= PATH_SAMPLES; index += 1) {
    const t = index / PATH_SAMPLES;
    const color = oklchToHex(mix(from, to, t));
    if (previous) length += oklabDistance(previous, color);
    path.push({ t, length });
    previous = color;
  }

  // A path with no length at all — two colours that render identically — has nowhere to put
  // a step, and even spacing of nothing is still nothing. Fall back to the parameter, and
  // let the MIN_STEP filter decide the wing is empty.
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

// ONE WING: the steps from `optimal` out to `end`, innermost first, with `end` last and
// exactly as it was named.
//
// THE LENGTH IS NOT FIXED, and unlike monochrome.js shortening does not move the far end.
// Here both ends are given, so fewer steps means BIGGER gaps between the same two colours —
// which is precisely the repair when two neighbours were too close to tell apart. A wing
// therefore always ends on the colour that was named, at whatever length still clears
// MIN_STEP; the length is found by trying from the top.
//
// An empty wing is the honest answer when even one step cannot be told from the middle —
// `teal-teal`, or two colours a person cannot distinguish. Inventing a step there would put
// a colour on the card that says nothing, and `optimal` still is what they named.
function wing(middle, middleHex, end, endHex) {
  for (let steps = MAX_STEPS; steps >= 1; steps -= 1) {
    const positions = placeAlong(middle, end, steps);
    const colors = positions.map((t, index) =>
      // The last step is the named colour itself, passed through rather than round-tripped:
      // "exact enough" is not the promise, and the caller hands over a normalized hex.
      index === positions.length - 1 ? endHex : oklchToHex(mix(middle, end, t))
    );
    let previous = middleHex;
    const separated = colors.every((color) => {
      const far = oklabDistance(previous, color) >= MIN_STEP;
      previous = color;
      return far;
    });
    if (separated) return colors;
  }
  return [];
}

// The palette two or three colours imply.
//
// Total for any hexes it is given: what counts as a colour, and how many are allowed, are
// the caller's decisions rather than this file's — the configuration layer owns both,
// because it is the only layer that can say which part of what the user wrote was wrong.
export function gradientPalette(hexes, id = "gradient") {
  const [firstHex, lastHex] = [hexes[0], hexes[hexes.length - 1]];
  const [first, last] = agreeOnHue(hexToOklch(firstHex), hexToOklch(lastHex));

  // With three colours the middle is the one that was named. With two it is the halfway
  // point of the same polar interpolation every other step uses, so the middle of the ramp
  // sits on the ramp rather than beside it.
  const middleHex = hexes.length === 3 ? hexes[1] : oklchToHex(mix(first, last, 0.5));
  const middle = hexToOklch(middleHex);

  // Each wing is interpolated from the middle to its own end, so a named middle that sits
  // off the line between the ends bends the ramp through itself rather than being skipped.
  const [belowMiddle, belowEnd] = agreeOnHue(middle, first);
  const [aboveMiddle, aboveEnd] = agreeOnHue(middle, last);

  return {
    id,
    optimal: middleHex,
    below: wing(belowMiddle, middleHex, belowEnd, firstHex),
    above: wing(aboveMiddle, middleHex, aboveEnd, lastHex),
  };
}

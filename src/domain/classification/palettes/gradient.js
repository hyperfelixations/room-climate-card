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

import { hexToOklch, oklchToHex } from "../../../core/oklch.js";
import { WING_STEPS, mix, placeAlong } from "./geometry.js";

// Two or three, and the refusal of a fourth is a design decision rather than a limit.
// Four anchors would need a rule for where the extra ones sit relative to `optimal`, and no
// reading of "the middle" survives an even number of them.
export const MAX_GRADIENT_COLORS = 3;

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

// ONE WING: WING_STEPS steps from `optimal` out to `end`, innermost first, with `end` last
// and exactly as it was named.
//
// THE LENGTH IS FIXED — see WING_STEPS in geometry.js. Both ends are given here, so the length
// never decides where the wing arrives, only how finely it gets there; two colours a person
// cannot tell apart (`teal-teal`) give five steps that are all that colour, which is the same
// card the empty wing produced and an honest description of what was asked for.
function wing(middle, end, endHex) {
  const positions = placeAlong(middle, end, WING_STEPS);
  return positions.map((t, index) =>
    // The last step is the named colour itself, passed through rather than round-tripped:
    // "exact enough" is not the promise, and the caller hands over a normalized hex.
    index === positions.length - 1 ? endHex : oklchToHex(mix(middle, end, t))
  );
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
    below: wing(belowMiddle, belowEnd, firstHex),
    above: wing(aboveMiddle, aboveEnd, lastHex),
  };
}

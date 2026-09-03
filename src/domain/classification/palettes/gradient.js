// A palette DERIVED FROM TWO OR THREE colours the user named, joined by hyphens:
//   palette: blue-red         the two ends; the middle is computed
//   palette: blue-green-red   ends and middle, all named
//
// The named colours come back exact; everything between is polar-interpolated in Oklch along
// the shorter arc (so `blue-red` runs through violet). Five steps per wing, always. The middle
// of a three-colour palette is always `optimal`, whatever the classification underneath looks
// like. Rationale, and why this sits alongside monochrome.js: see internal dev doc §5
// "Mehrfarbpaletten: zwei oder drei genannte Farben".

import { hexToOklch, oklchToHex } from "../../../core/oklch.js";
import { WING_STEPS, mix, placeAlong } from "./geometry.js";

// Two or three; a fourth anchor has no unambiguous place relative to `optimal`. The refusal
// lives in the configuration layer, where the message can name the part at fault.
export const MAX_GRADIENT_COLORS = 3;

// Below this chroma a hue angle is rounding noise. It matters here because the noise hue gets
// INTERPOLATED TOWARDS — without the fix, `black-red` would pass through a colour nobody named.
// The rule: an achromatic end borrows the other end's hue; two achromatic ends (`black-white`)
// stay a pure lightness ramp. monochrome.js solves the same problem by scaling chroma instead,
// which cannot work with two hues to choose between.
const ACHROMATIC_CHROMA = 0.01;

// The two ends with any noise-hue replaced by the hue of the end that has one. Unchanged when
// both are colourful and when neither is.
function agreeOnHue(first, second) {
  const firstIsGrey = first.chroma < ACHROMATIC_CHROMA;
  const secondIsGrey = second.chroma < ACHROMATIC_CHROMA;
  if (firstIsGrey === secondIsGrey) return [first, second];
  return firstIsGrey ? [{ ...first, hue: second.hue }, second] : [first, { ...second, hue: first.hue }];
}

// One wing: WING_STEPS steps from `optimal` out to `end`, innermost first, `end` last and
// exactly as named. Length is fixed (both ends are given), so it only decides how finely the
// wing gets there — `teal-teal` gives five steps of that one colour.
function wing(middle, end, endHex) {
  const positions = placeAlong(middle, end, WING_STEPS);
  return positions.map((t, index) =>
    // Last step is the named colour, passed through — the caller hands over a normalized hex.
    index === positions.length - 1 ? endHex : oklchToHex(mix(middle, end, t))
  );
}

// The palette two or three colours imply. Total for any hexes given: what counts as a colour
// and how many are allowed are the configuration layer's decisions, not this file's.
export function gradientPalette(hexes, id = "gradient") {
  const [firstHex, lastHex] = [hexes[0], hexes[hexes.length - 1]];
  const [first, last] = agreeOnHue(hexToOklch(firstHex), hexToOklch(lastHex));

  // Three colours: the middle is the one named. Two: the halfway point of the same polar
  // interpolation, so the ramp's middle sits on the ramp.
  const middleHex = hexes.length === 3 ? hexes[1] : oklchToHex(mix(first, last, 0.5));
  const middle = hexToOklch(middleHex);

  // Each wing interpolates from the middle to its own end, so a named middle off the line
  // between the ends bends the ramp through itself.
  const [belowMiddle, belowEnd] = agreeOnHue(middle, first);
  const [aboveMiddle, aboveEnd] = agreeOnHue(middle, last);

  return {
    id,
    optimal: middleHex,
    below: wing(belowMiddle, belowEnd, firstHex),
    above: wing(aboveMiddle, aboveEnd, lastHex),
  };
}

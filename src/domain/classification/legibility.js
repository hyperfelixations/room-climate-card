// Moving a colour just far enough to be seen, without changing what colour it is. One
// primitive, two callers (palettes/legible.js, and anything else putting a stated colour where
// it must be read): the NEAREST colour that clears a given separation from given backgrounds.
//
// Lightness only, hue exact. Chroma is carried through and reduced by oklchToHex() only where
// the gamut forces it (at fixed L and hue). So a moved colour is always the SAME colour,
// deeper or paler. Lives here, not in core/, because a core module may not import another
// (see core/color.js) and "clear" is a decision — the same one paint-roles.js and
// palette-fit.js are made of.

import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";

// Far enough from ALL backgrounds — the worst pairing decides. Exported so callers that move a
// colour and callers that only ask whether it must move share one definition.
export function separationFrom(hex, backgrounds) {
  let worst = Infinity;
  for (const background of backgrounds) {
    const distance = screenDistance(hex, background);
    if (distance < worst) worst = distance;
  }
  return worst;
}

// A coarse walk, then bisection of the last interval. Separation is nearly but not exactly
// monotone in lightness (the gamut moves as the colour does), so a bare bisection could land
// on the far side of a wobble. The coarse step is fine enough that no failing neighbourhood
// the card can produce fits inside one.
const SCAN_STEPS = 64;
const BISECTION_STEPS = 12;

// The nearest lightness in one direction (+1 lighter, -1 darker) at which this colour clears
// `required` against every background, or null when that direction runs out of range — an
// answer, letting the caller try the other way rather than painting the end of the range.
export function lightnessThatClears(hex, backgrounds, required, direction) {
  if (!backgrounds.length) return null;
  const { lightness, chroma, hue } = hexToOklch(hex);
  const at = (value) => oklchToHex({ lightness: value, chroma, hue });
  const limit = direction > 0 ? 1 : 0;
  const span = limit - lightness;
  if (Math.abs(span) < 1e-6) return null;

  let inside = lightness;
  for (let step = 1; step <= SCAN_STEPS; step += 1) {
    const candidate = lightness + (span * step) / SCAN_STEPS;
    if (separationFrom(at(candidate), backgrounds) < required) {
      inside = candidate;
      continue;
    }
    // Crossing is between `inside` (too close) and `candidate` (clear).
    let outside = candidate;
    for (let half = 0; half < BISECTION_STEPS; half += 1) {
      const middle = (inside + outside) / 2;
      if (separationFrom(at(middle), backgrounds) < required) inside = middle;
      else outside = middle;
    }
    return outside;
  }
  return null;
}

// The same colour, moved as little as possible, or null when there is nowhere to move it to.
// A colour that already clears comes back BY IDENTITY ("exact enough" is not what a palette
// promises); with no background there is nothing to claim, so it comes back unchanged.
export function legibleVariant(hex, backgrounds, required) {
  if (!backgrounds.length || separationFrom(hex, backgrounds) >= required) return hex;

  const { lightness, chroma, hue } = hexToOklch(hex);
  let best = null;
  for (const direction of [1, -1]) {
    const found = lightnessThatClears(hex, backgrounds, required, direction);
    if (found === null) continue;
    const travel = Math.abs(found - lightness);
    // Ties go to the lighter answer (loop runs +1 first), not to loop order.
    if (!best || travel < best.travel) best = { travel, lightness: found };
  }
  return best ? oklchToHex({ lightness: best.lightness, chroma, hue }) : null;
}

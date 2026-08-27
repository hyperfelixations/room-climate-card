// MOVING A COLOUR JUST FAR ENOUGH TO BE SEEN, without changing what colour it is.
//
// One primitive, two callers. A palette step that collides with the card it is painted on
// needs it (palettes/legible.js), and so does anything else that has to put a stated colour
// somewhere it can be read. Both ask the same question: what is the NEAREST colour that
// clears this much separation from these backgrounds.
//
// WHY IT LIVES HERE AND NOT IN core/. It needs hexToOklch, oklchToHex and screenDistance, and
// a core module may not import another core module — the layering contract is deliberate and
// core/color.js says so in its own header. It is also not pure conversion: what counts as
// "clear" is a decision, the same decision paint-roles.js and palette-fit.js are made of, and
// this is the layer those live on.
//
// LIGHTNESS ONLY, HUE EXACTLY. Three levers exist in Oklch and only one of them is used.
//
//   hue     never touched. It is what makes yellow yellow; a repair that bends it has not
//           repaired the palette, it has replaced it.
//   chroma  carried through unchanged, and reduced by oklchToHex() only where the gamut
//           forces it — at fixed lightness and fixed hue, which is the whole reason that
//           function resolves out-of-gamut colours the way it does.
//   L       the one that moves. Measured across every case the card can produce, lightness
//           alone reaches an answer wherever an answer exists; adding a chroma search would
//           be a second degree of freedom nothing needed and a second thing to explain.
//
// The result is that a moved colour is always the SAME colour, deeper or paler. That is the
// promise the supervisor set: a colour may become a darker or more saturated version of
// itself, never a different one.

import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";

// The worst pairing decides, because the card has to hold up over all of its background: a
// gradient is several colours and a step is only readable if it is readable on each.
//
// Exported because the callers that ask this module to MOVE a colour also need to ask whether
// it has to move at all, and two spellings of "far enough from all of them" would be two
// places for the answer to drift.
export function separationFrom(hex, backgrounds) {
  let worst = Infinity;
  for (const background of backgrounds) {
    const distance = screenDistance(hex, background);
    if (distance < worst) worst = distance;
  }
  return worst;
}

// HOW THE SEARCH WALKS, and why it is a walk rather than a straight bisection.
//
// Separation is very nearly monotone in lightness on either side of the background, but not
// exactly: hue and chroma stay fixed while the GAMUT does not, so the chroma a colour can
// actually hold changes as it moves and the curve is not perfectly smooth. A bare bisection
// assumes one crossing and would be free to land on the far side of a wobble.
//
// So the range is walked coarsely first until the bar is cleared, and only the last interval
// — one that provably contains a crossing — is bisected. The coarse step is fine enough that
// no failing neighbourhood the card can produce fits inside one, and the bisection then takes
// the answer well below one step of an 8-bit channel.
const SCAN_STEPS = 64;
const BISECTION_STEPS = 12;

// The nearest lightness in one direction (+1 lighter, -1 darker) at which this colour clears
// `required` against every background — or null when that direction runs out of range.
//
// `null` is an answer and not a failure: it is what lets the caller try the other way instead
// of painting the end of the range and calling it a repair.
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
    // The crossing is between `inside` (still too close) and `candidate` (clear).
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

// THE ANSWER: the same colour, moved as little as possible, or null when there is nowhere to
// move it to.
//
// A colour that already clears comes back BY IDENTITY rather than rebuilt, which is the
// cheapest possible proof that nothing was touched — a round trip through Oklch is exact to
// well under an 8-bit step, but "exact enough" is not what a palette promises.
//
// With no background there is nothing to measure and therefore nothing to claim, so the
// colour comes back as it was. That is the same answer evaluatePaletteFit() gives to the same
// situation, and for the same reason.
export function legibleVariant(hex, backgrounds, required) {
  if (!backgrounds.length || separationFrom(hex, backgrounds) >= required) return hex;

  const { lightness, chroma, hue } = hexToOklch(hex);
  let best = null;
  for (const direction of [1, -1]) {
    const found = lightnessThatClears(hex, backgrounds, required, direction);
    if (found === null) continue;
    const travel = Math.abs(found - lightness);
    // Ties go to the lighter answer, so the choice is settled by the direction rather than by
    // the order the loop happens to run in.
    if (!best || travel < best.travel) best = { travel, lightness: found };
  }
  return best ? oklchToHex({ lightness: best.lightness, chroma, hue }) : null;
}

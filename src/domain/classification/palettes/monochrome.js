// A palette derived from ONE colour, named or hex — one generator instead of 148 files.
//
// The promise: the named colour is the middle, exact, and every step keeps its hue to the
// digit (the gamut is left by reducing chroma at fixed hue, see core/oklch.js). Direction,
// which a single hue cannot carry, is carried by the two qualities a hue still has:
//
//   below   pale   lighter, washed out    "not enough of it"
//   optimal        the colour that was named
//   above   deep   darker, saturated      "too much of it"
//
// A generated ramp does not promise the contrast a hand-designed palette does — it cannot also
// change hue. Full rationale (Oklab vs CIELAB, the anchors, why eleven steps do not fit one
// readable band, the reach calibration): interne Doku §5 „Monopaletten: ein Generator statt
// Dateien".

import { hexToOklch, oklchToHex } from "../../../core/oklch.js";
import { MIN_STEP, WING_STEPS, mix, pathLength, placeAlong } from "./geometry.js";

// Where each wing is headed, in Oklab L. The anchors are the edges of the band readable on a
// light card AND a dark one (~L 0.78 on white, ~L 0.48 on the dark card); a wing aims at its
// anchor and stops there. MIN_TRAVEL is what a base already past its anchor still gets.
const PALE_ANCHOR = 0.76;
const DEEP_ANCHOR = 0.5;
const MIN_TRAVEL = 0.08;
// Absolute stops, so an extreme base cannot send the ramp out of the space.
export const LIGHTNESS_CEILING = 0.96;
export const LIGHTNESS_FLOOR = 0.1;

// What each wing does to colourfulness, as a factor on the base's own chroma. PROPORTIONAL, so
// an achromatic base (`gray`, `white`, `black`) keeps none and yields a greyscale ramp with no
// "is this achromatic" test needed.
const PALE_CHROMA = 0.25;
const DEEP_CHROMA = 1.5;

// The most chroma this hue can hold at this lightness. Asked of oklchToHex() itself: it
// resolves an out-of-gamut request by reducing chroma at fixed L and hue, so what comes back
// from an impossible chroma IS the limit.
function chromaCeiling(lightness, hue) {
  return hexToOklch(oklchToHex({ lightness, chroma: 0.5, hue })).chroma;
}

// Where a wing is headed in colourfulness, clamped to what the gamut holds there. The clamp
// keeps the path from doubling back: unclamped, the deep wing aims at a colour that does not
// exist, the conversion pulls each step back to the gamut edge by a different amount, and the
// painted path wanders (measured on `palette: navy`: two deep steps 0.6 apart while the wing's
// ends were 3.5).
const endChromaFor = (base, side, lightness) =>
  Math.min(base.chroma * (side === "pale" ? PALE_CHROMA : DEEP_CHROMA), chromaCeiling(lightness, base.hue));
const endOf = (base, side, lightness) => ({ lightness, chroma: endChromaFor(base, side, lightness), hue: base.hue });

// One wing: WING_STEPS colours from the base out to `endLightness`, spaced by perceived
// distance (placeAlong() in geometry.js). Length is fixed; how far the wing travels is not —
// `white` has nothing paler than itself, so its pale wing is five whites, which renders like
// the empty wing it replaces. Whether the steps separate is judged in palettes/legible.js,
// against the background the card is really on.
export function monochromeWing(base, side, endLightness) {
  const end = endOf(base, side, endLightness);
  return placeAlong(base, end, WING_STEPS).map((t) => oklchToHex(mix(base, end, t)));
}

// monochromeAnchors() below is now a DEFAULT, not the only possibility: a caller that knows an
// unusual background may aim the wings elsewhere (palettes/legible.js). Kept as one function so
// an adapted ramp is visibly the same construction with different endpoints.

// How many places to try when a wing must reach past its anchor.
const REACH_CANDIDATES = 16;

// An anchor is a floor, not a target: with wing length fixed, a wing aimed too close to its
// base (`palette: blue` sits below the deep anchor) would pack five near-identical steps into a
// tiny span. So it is pushed outwards until its path can hold five steps MIN_STEP apart, or it
// hits the edge of the space — and the push stops as soon as the steps fit, because reaching
// past an anchor costs contrast on one card background. Reach value (0.20) and the
// eleven-steps-do-not-fit reasoning: interne Doku §5 „Monopaletten…".
function reachedOut(base, side, aim, limit) {
  const wanted = WING_STEPS * MIN_STEP;
  if (pathLength(base, endOf(base, side, aim)) >= wanted) return aim;
  let furthest = aim;
  for (let step = 1; step <= REACH_CANDIDATES; step += 1) {
    furthest = aim + (limit - aim) * (step / REACH_CANDIDATES);
    if (pathLength(base, endOf(base, side, furthest)) >= wanted) break;
  }
  return furthest;
}

export function monochromeAnchors(base) {
  const pale = Math.max(base.lightness, Math.min(LIGHTNESS_CEILING, Math.max(PALE_ANCHOR, base.lightness + MIN_TRAVEL)));
  const deep = Math.min(base.lightness, Math.max(LIGHTNESS_FLOOR, Math.min(DEEP_ANCHOR, base.lightness - MIN_TRAVEL)));
  return {
    pale: reachedOut(base, "pale", pale, Math.max(base.lightness, LIGHTNESS_CEILING)),
    deep: reachedOut(base, "deep", deep, Math.min(base.lightness, LIGHTNESS_FLOOR)),
  };
}

// The palette a base colour implies. Total: every hex produces a palette; what counts as a
// valid base is the caller's decision. `anchors` overrides where the wings are headed (Oklab
// L); omitted, the generator picks them itself. A caller may aim a wing at a lightness on
// EITHER side of the base — a pale wing forced downwards is still plainly the pale wing,
// because the deep wing separates by chroma too.
export function monochromePalette(baseHex, id = "monochrome", anchors = null) {
  const base = hexToOklch(baseHex);
  const { pale: paleLightness, deep: deepLightness } = anchors || monochromeAnchors(base);
  return {
    id,
    // The base hex passed through, not round-tripped through Oklab: "exact enough" is not the
    // promise. Caller hands over an already-normalized hex (parseColorToken in core/color.js).
    optimal: baseHex,
    above: monochromeWing(base, "deep", deepLightness),
    below: monochromeWing(base, "pale", paleLightness),
  };
}

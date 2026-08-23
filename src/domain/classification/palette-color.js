// From a classification to a colour, and nothing else.
//
// A pure function of two inputs: what the classification decided, and which palette the
// card was configured with. No profile, no policy, no DOM, no palette lookup — which is
// what makes the resolution ORDER below auditable, and the order is the whole point. Two
// of its four steps exist because getting them wrong is invisible until a user notices
// their dashboard lying to them:
//
//   source "entity"  the integration owns the classification. A missing value_color
//                    stays NEUTRAL — the card's own neutral grey, which belongs to no
//                    palette at all, because this value sits on no ramp. It must never be
//                    coloured from the ramp via a value_score the integration also
//                    supplied, because that score is the integration's own scale and has
//                    no relation to the card's.
//   invalid          an impossible reading is off the scale, not at one end of it.
//                    It gets the palette's invalid colour even though built-in profiles
//                    historically carry a score on it.
//   explicit colour  a profile that named a colour gets that colour. This is what keeps
//                    every custom profile written before palettes existed unchanged.
//   otherwise        the ramp, at the tier's own distance from optimal.

import { NEUTRAL_COLOR } from "./palettes/registry.js";

// Where a tier lands in a palette that need not have the same number of steps the
// profile has.
//
// Both are anchored at the SAME place — optimal — and each wing is scaled on its own.
// That anchoring is what makes this total and unambiguous, and it is why no option and
// no error case are needed:
//
//   deviation 0        the middle, always
//   deviation +-k      k of the profile's own `span` steps out, mapped onto that many
//                      of the palette's steps
//
// `ceil` rather than `round` is deliberate: the FIRST step away from optimal must
// already leave the middle colour. A reading that is no longer optimal has to look like
// it, even on a palette with a single colour per wing.
//
// The consequences fall out rather than being arranged. A profile and a palette of equal
// reach map one to one — every built-in profile on the card's own ramp keeps exactly the
// colours it always had. A three-tier profile on an eleven-colour ramp reaches that
// ramp's ends instead of picking three neighbours out of its middle. An eleven-tier
// profile on a three-colour palette collapses onto that palette's three colours instead
// of failing. None of those is a special case in the code.

export function rampColorFor(deviation, span, palette, describe = "classification") {
  if (deviation === 0) return palette.optimal;
  if (!Number.isInteger(deviation)) {
    throw new Error(
      `Invalid configuration: ${describe} needs a whole number of steps from optimal to take a color from the palette, but got ${deviation}.`
    );
  }
  const towardsTooMuch = deviation > 0;
  const wing = towardsTooMuch ? palette.above : palette.below;
  // A palette that says nothing about a direction says the middle about it. `palette:
  // {optimal: "#1DB85D"}` is a legitimate thing to write — a card in one colour — and a
  // generated ramp on `white` genuinely has nowhere paler to go. Neither is an error, and
  // neither may read past the end of an array. Checked AFTER the malformed-deviation
  // guard, so an empty wing never becomes a place where a bad number goes unnoticed.
  if (wing.length === 0) return palette.optimal;
  const reach = towardsTooMuch ? span?.above : span?.below;
  const steps = Math.abs(deviation);
  // Cannot happen from a validated profile — `span` is that profile's own extreme, so a
  // deviation can never exceed it. Stated anyway, because silently reading past the end
  // of a wing would produce `undefined` as a colour.
  if (!Number.isInteger(reach) || reach < steps) {
    throw new Error(
      `Invalid configuration: ${describe} is ${steps} step${steps === 1 ? "" : "s"} ${towardsTooMuch ? "above" : "below"} optimal, which is outside the profile's own range.`
    );
  }
  return wing[Math.ceil((steps / reach) * wing.length) - 1];
}

export function resolveClassificationColor(classification, palette, describe = "classification") {
  if (classification.source === "entity") return classification.explicitColor || NEUTRAL_COLOR;
  if (classification.invalid) return classification.explicitColor || palette.invalid;
  if (classification.explicitColor) return classification.explicitColor;
  return rampColorFor(classification.deviation, classification.deviationSpan, palette, describe);
}

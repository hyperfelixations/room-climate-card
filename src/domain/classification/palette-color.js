// From a classification to a colour, and nothing else — a pure function of the classification
// and the configured palette, no profile, policy, DOM or lookup. The resolution ORDER is the
// point and is auditable here:
//
//   source "entity"  the integration owns it: a missing value_color stays NEUTRAL, never
//                    coloured from the ramp via a value_score on the integration's own scale
//   invalid          an impossible reading is off the scale: the palette's invalid colour
//   explicit colour  a profile that named a colour gets it (keeps pre-palette custom profiles)
//   otherwise        the ramp, at the tier's distance from optimal
//
// See internal dev doc §5 "Farbpaletten".

import { NEUTRAL_COLOR } from "./palettes/registry.js";

// Where a tier lands in a palette that need not have as many steps as the profile. Both are
// anchored at optimal and each wing is scaled on its own, which makes this total with no option
// and no error case: deviation 0 is the middle; deviation ±k maps k of the profile's own `span`
// steps onto that many palette steps. `ceil` not `round` — the first step away from optimal
// must already leave the middle colour. Equal reach maps one to one; a short palette collapses;
// a short profile reaches the ramp's ends. See internal dev doc §5 "Farbpaletten".

export function rampColorFor(deviation, span, palette, describe = "classification") {
  if (deviation === 0) return palette.optimal;
  if (!Number.isInteger(deviation)) {
    throw new Error(
      `Invalid configuration: ${describe} needs a whole number of steps from optimal to take a color from the palette, but got ${deviation}.`
    );
  }
  const towardsTooMuch = deviation > 0;
  const wing = towardsTooMuch ? palette.above : palette.below;
  // A palette that says nothing about a direction says the middle about it (`palette:
  // {optimal: ...}`, or a generated ramp on `white`). Checked AFTER the integer guard, so an
  // empty wing never hides a bad number.
  if (wing.length === 0) return palette.optimal;
  const reach = towardsTooMuch ? span?.above : span?.below;
  const steps = Math.abs(deviation);
  // Cannot happen from a validated profile (`span` is the profile's own extreme). Stated
  // anyway: reading past a wing would produce `undefined` as a colour.
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

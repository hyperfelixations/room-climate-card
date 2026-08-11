// From a classification to a colour, and nothing else.
//
// A pure function of two inputs: what the classification decided, and which palette the
// card was configured with. No profile, no policy, no DOM, no registry — which is what
// makes the resolution ORDER below auditable, and the order is the whole point. Two of
// its four steps exist because getting them wrong is invisible until a user notices
// their dashboard lying to them:
//
//   source "entity"  the integration owns the classification. A missing value_color
//                    stays NEUTRAL. It must never be coloured from the ramp via a
//                    value_score the integration also supplied, because that score is
//                    the integration's own scale and has no relation to the card's.
//   invalid          an impossible reading is off the scale, not at the bottom of it.
//                    It gets the palette's invalid colour even though built-in profiles
//                    historically carry score 1 on it.
//   explicit colour  a profile that named a colour gets that colour. This is what keeps
//                    every custom profile written before palettes existed unchanged.
//   otherwise        the ramp, at the tier's own position.

const NEUTRAL_COLOR = "#B4B2A9";

// Where a tier's position lands in a palette that may have a different number of colours
// than the profile has tiers.
//
// The default is IDENTITY: position P takes ramp[P], and a position the palette does not
// have is a hard error rather than a guess. Guessing is not available here — a profile
// with positions 1..5 could mean the lowest five colours or five spread across the whole
// ramp, and nothing in the profile says which. Taking Math.max(score) as the domain
// would silently pick one of those readings and be wrong half the time.
//
// A profile that wants the other reading says so: `positions: N` declares "my positions
// run 1..N", and the ramp is then stretched across them. That is the only stretching
// that happens, and it happens because the profile asked.
export function rampIndexFor({ rampPosition, declaredPositions }, palette, describe = "classification") {
  const size = palette.ramp.length;
  if (!Number.isInteger(rampPosition) || rampPosition < 1) {
    throw new Error(
      `Invalid configuration: ${describe} needs a whole ramp position of 1 or more to take a color from the palette, but got ${rampPosition}.`
    );
  }
  if (declaredPositions === null || declaredPositions === undefined) {
    if (rampPosition > size) {
      throw new Error(
        `Invalid configuration: ${describe} sits at ramp position ${rampPosition}, but the palette has ${size} color${size === 1 ? "" : "s"} — give the profile a matching palette, or declare classification.positions so the ramp is stretched across its own scale.`
      );
    }
    return rampPosition - 1;
  }
  // One position maps to one end of the ramp and `declaredPositions` to the other, with
  // everything between spread evenly. A single-colour palette collapses to that colour.
  const stretched = size === 1 ? 1 : 1 + Math.round(((rampPosition - 1) * (size - 1)) / (declaredPositions - 1));
  return Math.min(size, Math.max(1, stretched)) - 1;
}

export function resolveClassificationColor(classification, palette, describe = "classification") {
  if (classification.source === "entity") return classification.explicitColor || NEUTRAL_COLOR;
  if (classification.invalid) return classification.explicitColor || palette.invalid;
  if (classification.explicitColor) return classification.explicitColor;
  return palette.ramp[rampIndexFor(classification, palette, describe)];
}

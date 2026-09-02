// Whether a reading is physically possible at all.
//
// Separate from classification: an impossible value must be excluded from averaging and
// metric-kind consensus BEFORE anything gives it a tier. A metric kind with no registered
// profile has no validity concept and is treated as valid ("show it", not "hide all").

import { isOutsideRange } from "../../core/numbers.js";

// A profile's physical window, written once and returned as the two fields the card
// reads: `validRange` for projectProfileToDisplayUnit() and `invalidWhen` for the
// canonical comparison. Bounds are in the canonical unit and both inclusive — the limit
// itself is a reading (0 % humidity, 0 ppm, 0 K), only what lies past it is impossible.
// An omitted bound means no limit that direction. (A user `valid_range` may pick an
// exclusive bound; that path builds its own predicate.)
export function physicalRange({ min = null, max = null }) {
  const validRange = { min, max, minInclusive: true, maxInclusive: true };
  return { validRange, invalidWhen: (value) => isOutsideRange(value, validRange) };
}

export function isPhysicallyValid(profile, value) {
  if (!profile) return true;
  return !profile.invalidWhen?.(value);
}

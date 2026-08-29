// Whether a reading is physically possible at all.
//
// Separate from classification on purpose: an impossible value must be excluded
// from averaging and metric-kind consensus BEFORE anything tries to give it a
// tier. A stuck "0 ppm" CO2 sensor or a negative particulate concentration is not
// a cold room — it is a broken reading, and treating it as data was the root cause
// of a whole class of earlier bugs.
//
// A metric kind with no registered profile has no validity concept and is treated
// as valid, so an unknown kind degrades to "show it" rather than "hide
// everything".

import { isOutsideRange } from "../../core/numbers.js";

// The physical window a built-in profile declares, written down ONCE and returned as
// the two fields the rest of the card reads: `validRange` for projectProfileToDisplayUnit()
// to re-express in the unit the card shows, and `invalidWhen` for the comparison against
// a canonical reading. A profile that spelled out both would be stating one fact twice,
// and the pair would drift the first time somebody edited one of them.
//
// BOUNDS ARE IN THE PROFILE'S CANONICAL UNIT, and both are inclusive — that is the rule,
// not a setting. The limit itself is a reading: 0 % humidity, 0 ppm of a gas and 0 K are
// all things a sensor may legitimately report, and only what lies PAST the limit is
// impossible. (A user-written `classification.valid_range` can still choose an exclusive
// bound; that path builds its own predicate over the same comparison.)
//
// An omitted bound means the measurement has no limit in that direction. Temperature has
// no upper one, and a concentration has no upper one either.
export function physicalRange({ min = null, max = null }) {
  const validRange = { min, max, minInclusive: true, maxInclusive: true };
  return { validRange, invalidWhen: (value) => isOutsideRange(value, validRange) };
}

export function isPhysicallyValid(profile, value) {
  if (!profile) return true;
  return !profile.invalidWhen?.(value);
}

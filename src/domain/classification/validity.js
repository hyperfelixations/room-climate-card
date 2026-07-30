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

export function isPhysicallyValid(profile, value) {
  if (!profile) return true;
  return !profile.invalidWhen?.(value);
}

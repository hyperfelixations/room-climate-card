// The header icon that belongs to a reading.
//
// Icons are part of the active classification profile, exactly like levels — a fridge
// at 10 °C should not get the same icon as a living room at 10 °C.
//
// ONE shape, for every measurement and for built-in and configured profiles alike: a
// descending list of {min, icon} tiers, read with the profile's own comparison operator.
// It is the same shape as the classification tiers themselves, minus the fields that
// carry meaning rather than appearance — so a profile that can express its thresholds
// can express its icons, and nothing here needs to know which measurement it is looking
// at.
//
// A profile that declares no icon tiers returns null, and the caller applies the
// metric's own stable default icon. That is the single meaning of "no icons", again for
// every measurement: no derivation, no inheritance, no per-kind special case.

import { selectTier } from "./classify.js";

// The profile must already be projected into the unit `value` is expressed in.
export function profileIconForValue(value, profile) {
  if (!profile.iconTiers) return null;
  const tier = selectTier({ tiers: profile.iconTiers, comparison: profile.comparison }, value);
  return tier?.icon ?? null;
}

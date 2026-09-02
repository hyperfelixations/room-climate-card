// The header icon that belongs to a reading.
//
// Icons are part of the active profile, like levels — a fridge at 10 °C and a living
// room at 10 °C do not share an icon. One shape for every measurement, built-in or
// custom: a descending {min, icon} list read with the profile's comparison operator.
// No icon tiers returns null, and the caller applies the metric's stable default icon.

import { selectTier } from "./classify.js";

// The profile must already be projected into the unit `value` is expressed in.
export function profileIconForValue(value, profile) {
  if (!profile.iconTiers) return null;
  const tier = selectTier({ tiers: profile.iconTiers, comparison: profile.comparison }, value);
  return tier?.icon ?? null;
}

// The header icon that belongs to a reading.
//
// Icons are part of the active classification profile, exactly like colours and
// levels — a fridge at 10 °C should not get the same icon as a living room at
// 10 °C. Two shapes exist, mirroring how the profiles themselves are authored:
//
//   temperature  a fixed fire/high/normal/low threshold contract, which is also
//                the public contract for custom temperature profiles
//   other kinds  generic descending {min, icon} tiers
//
// A metric kind with no icon tiers returns null, and the caller falls back to the
// metric's stable default icon. That way adding another kind never forces a
// semantically dubious icon family onto it.

import { selectTier } from "./classify.js";

const TEMPERATURE_ICONS = {
  fire: "mdi:fire-alert",
  high: "mdi:thermometer-high",
  normal: "mdi:thermometer",
  low: "mdi:thermometer-low",
  below: "mdi:snowflake",
};

// The profile must already be projected into the unit `temp` is expressed in.
export function temperatureIconForProfile(temp, profile) {
  const thresholds = profile.iconThresholds;
  if (temp >= thresholds.fire) return TEMPERATURE_ICONS.fire;
  if (temp >= thresholds.high) return TEMPERATURE_ICONS.high;
  if (temp >= thresholds.normal) return TEMPERATURE_ICONS.normal;
  if (temp >= thresholds.low) return TEMPERATURE_ICONS.low;
  return TEMPERATURE_ICONS.below;
}

// Returns null when the profile declares no icon tiers, so the caller can apply
// the metric's own default icon.
export function profileIconForValue(value, metricKind, profile) {
  if (metricKind === "temperature") return temperatureIconForProfile(value, profile);
  if (!profile.iconTiers) return null;
  const tier = selectTier({ tiers: profile.iconTiers, comparison: profile.comparison }, value);
  return tier?.icon ?? null;
}

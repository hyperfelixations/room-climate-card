// Unit conversion and threshold projection.
//
// Operates directly on UnitProfile/tier/band objects with no registry lookup, so it stays
// usable for a metric kind not yet in METRIC_DEFINITIONS.
//
// `quantityKind` picks the path: `absolute` via toCanonical/fromCanonical (applies the
// Fahrenheit offset), `delta` and `rate` via deltaToCanonical/deltaFromCanonical (no
// offset). An unknown kind throws rather than default to a plausible-looking wrong number.
// See the internal dev doc, §5 "Unit-, Range-, Trend- und Scale-System".

export function convertUnitValue(value, quantityKind, fromProfile, toProfile) {
  if (quantityKind === "absolute") {
    return toProfile.fromCanonical(fromProfile.toCanonical(value));
  }
  if (quantityKind === "delta" || quantityKind === "rate") {
    return toProfile.deltaFromCanonical(fromProfile.deltaToCanonical(value));
  }
  throw new Error(`convertUnitValue: unknown quantityKind "${quantityKind}"`);
}

export function deriveThresholdsForProfile(canonicalTiers, profile) {
  // Re-expresses a canonical-unit tier list (levelKey/color unchanged) in
  // profile's display unit; -Infinity/+Infinity survive unchanged (both
  // Math.round(±Infinity) and a linear fromCanonical() naturally return
  // ±Infinity, no special-casing needed).
  const round = profile.thresholdRounding || ((v) => v);
  return canonicalTiers.map((tier) => ({
    ...tier,
    min: Number.isFinite(tier.min) ? round(profile.fromCanonical(tier.min)) : tier.min,
  }));
}

export function deriveBandForProfile(band, profile) {
  const round = profile.thresholdRounding || ((v) => v);
  return { min: round(profile.fromCanonical(band.min)), max: round(profile.fromCanonical(band.max)) };
}

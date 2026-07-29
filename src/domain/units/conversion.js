// Unit conversion and threshold projection.
//
// These operate directly on UnitProfile/tier/band objects with no registry
// lookup, which is what makes them reusable for a metric kind that is not
// registered in METRIC_DEFINITIONS yet.
//
// A "quantityKind" distinguishes three fundamentally different numeric
// semantics that must never share a conversion path:
//
//   absolute — an actual reading (e.g. today's temperature): converts via
//              toCanonical()/fromCanonical(), which DOES apply the Fahrenheit
//              offset (0 °C = 32 °F).
//   delta    — a difference between two readings (e.g. daily spread,
//              room-to-room spread): converts via deltaToCanonical()/
//              deltaFromCanonical(), which must NEVER apply an offset (a 0 °C
//              difference is a 0 °F difference, not 32 °F).
//   rate     — a delta per unit time (e.g. a trend in °C/h): uses the exact
//              same value-conversion factor as delta — only the time unit
//              differs, and this module does not touch time units at all, so
//              "rate" and "delta" share one code path.
//
// An unknown quantityKind throws rather than defaulting: silently picking the
// wrong path would produce a plausible-looking number that is off by 32.

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

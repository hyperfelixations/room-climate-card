// Unit conversion.
//
// Operates directly on UnitProfile objects with no registry lookup, so it stays
// usable for a metric kind not yet in METRIC_DEFINITIONS.
//
// `quantityKind` picks the path: `absolute` via toCanonical/fromCanonical (applies the
// Fahrenheit offset), `delta` and `rate` via deltaToCanonical/deltaFromCanonical (no
// offset). An unknown kind throws rather than default to a plausible-looking wrong number.
// See internal dev doc §5 "Unit-, Range-, Trend- und Scale-System".

export function convertUnitValue(value, quantityKind, fromProfile, toProfile) {
  if (quantityKind === "absolute") {
    return toProfile.fromCanonical(fromProfile.toCanonical(value));
  }
  if (quantityKind === "delta" || quantityKind === "rate") {
    return toProfile.deltaFromCanonical(fromProfile.deltaToCanonical(value));
  }
  throw new Error(`convertUnitValue: unknown quantityKind "${quantityKind}"`);
}

// Re-expressing a canonical profile in the unit the card actually displays.
//
// Profiles are stored in each metric's canonical unit, but every comparison the card
// makes — tier selection, comfort counting, scale geometry, icon choice — runs against
// the DISPLAYED value. Projecting the profile (rather than converting each reading back)
// is what keeps the printed band equal to the applied band: it stops a displayed
// "68 °F comfort" edge from classifying as if it were 67.9 °F.
//
// Absolute boundaries go through fromCanonical() plus the profile's rounding; step and
// headroom are DELTAS via deltaFromCanonical(), which must never pick up a unit offset.

import { isOutsideRange } from "../../core/numbers.js";
import { assertProjectedGeometry } from "./geometry-guard.js";

export function projectProfileToDisplayUnit(canonical, definition, unitProfile, metricKind) {
  const displayProfile = unitProfile || definition.unitProfiles[definition.canonicalProfileKey];
  if (displayProfile.key === definition.canonicalProfileKey) return canonical;

  const projectAbsolute = (value) => {
    const converted = displayProfile.fromCanonical(value);
    return (displayProfile.thresholdRounding || ((v) => v))(converted);
  };
  const projectBand = (band) => ({ min: projectAbsolute(band.min), max: projectAbsolute(band.max) });
  const projectedValidRange = canonical.validRange && {
    min: canonical.validRange.min === null ? null : projectAbsolute(canonical.validRange.min),
    max: canonical.validRange.max === null ? null : projectAbsolute(canonical.validRange.max),
    minInclusive: canonical.validRange.minInclusive,
    maxInclusive: canonical.validRange.maxInclusive,
  };
  // The validity window is re-derived in the display unit (a canonical predicate would
  // reject -300 °F, which is -184 °C and a real reading). A custom profile without
  // `valid_range` has no window and keeps its null.
  const invalidWhen = projectedValidRange ? (reading) => isOutsideRange(reading, projectedValidRange) : canonical.invalidWhen;

  const projected = {
    ...canonical,
    tiers: canonical.tiers.map((tier) => ({
      ...tier,
      min: Number.isFinite(tier.min) ? projectAbsolute(tier.min) : tier.min,
    })),
    comfort: projectBand(canonical.comfort),
    optimal: projectBand(canonical.optimal),
    // A profile whose axis follows the data declares no reference range; there is
    // nothing to re-express in another unit, and null stays null.
    scale: canonical.scale ? projectBand(canonical.scale) : canonical.scale,
    step: displayProfile.deltaFromCanonical(canonical.step),
    headroom: canonical.headroom === undefined ? undefined : displayProfile.deltaFromCanonical(canonical.headroom),
    invalidWhen,
    validRange: projectedValidRange,
    iconTiers: canonical.iconTiers?.map((tier) => ({
      ...tier,
      min: Number.isFinite(tier.min) ? projectAbsolute(tier.min) : tier.min,
    })),
  };
  assertProjectedGeometry(canonical, projected, metricKind, displayProfile);
  return projected;
}

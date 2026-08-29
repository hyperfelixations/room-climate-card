// Re-expressing a canonical profile in the unit the card actually displays.
//
// Profiles are authored and stored in each metric's canonical unit. Every
// comparison the card makes — tier selection, comfort counting, scale geometry,
// icon choice — happens against the DISPLAYED value, so the profile has to be
// projected first. Doing it the other way round (converting the reading back to
// canonical for each comparison) would compare against unrounded boundaries and
// let a displayed "68 °F comfort" edge classify as if it were 67.9 °F.
//
// Absolute boundaries go through fromCanonical() plus the profile's own rounding;
// the step and headroom are DELTAS and go through deltaFromCanonical(), which must
// never pick up a unit offset.

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
  // A validity window has to be RE-DERIVED in the display unit, or a Fahrenheit card
  // would compare its readings against Celsius limits: -300 °F is -184 °C and a
  // perfectly possible reading, while the canonical predicate would reject it. Every
  // built-in profile declares a window; a custom profile written without `valid_range` has
  // none, and keeps the null it already carries.
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

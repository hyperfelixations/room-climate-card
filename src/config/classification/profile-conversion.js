import { isOutsideRange } from "../../core/numbers.js";
import { rejectValue } from "../errors.js";
import { LEGACY_TEMPERATURE_ICON_KEYS } from "./profile-parts.js";

export function convertCustomProfile(value, source, sourceUnitProfile, metricKind) {
  const {
    sourceComfort,
    sourceOptimal,
    sourceScale,
    sourceStep,
    sourceHeadroom,
    sourceTiers,
    sourceValidRange,
    sourceIconTiers,
    comparison,
    oneSided,
    anchorScale,
  } = source;
  const refuse = (path) => {
    const parts = path.replaceAll("[", ".").replaceAll("]", "").split(".").slice(1);
    rejectValue(path, parts.reduce((part, key) => part[key], value));
  };
  // Absolutes use offsets; steps/headroom use deltas. Only written bounds must stay finite.
  const converting = (convert) => (written, path) => {
    const converted = convert(written);
    if (!Number.isFinite(converted)) refuse(path);
    return converted;
  };
  const toCanonical = converting(sourceUnitProfile.toCanonical);
  const deltaToCanonical = converting(sourceUnitProfile.deltaToCanonical);
  const convertBand = (band, path) => {
    const converted = { min: toCanonical(band.min, `${path}.min`), max: toCanonical(band.max, `${path}.max`) };
    if (converted.min >= converted.max) refuse(`${path}.max`);
    return converted;
  };
  const convertTierMins = (tiers, pathOf) => {
    const converted = tiers.map((tier, index) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min, pathOf(index)) : tier.min }));
    converted.forEach((tier, index) => {
      if (index > 0 && tier.min >= converted[index - 1].min) refuse(pathOf(index));
    });
    return converted;
  };

  const comfort = convertBand(sourceComfort, "classification.bands.comfort");
  const optimal = convertBand(sourceOptimal, "classification.bands.optimal");
  const scale = sourceScale && convertBand(sourceScale, "classification.scale");
  const step = deltaToCanonical(sourceStep, "classification.scale.step");
  if (step <= 0) refuse("classification.scale.step");
  const headroom = sourceHeadroom === null ? undefined : deltaToCanonical(sourceHeadroom, "classification.scale.headroom");
  const tiers = convertTierMins(sourceTiers, (index) => `classification.tiers[${index}].min`);
  const canonicalValidRange = sourceValidRange && {
    min: sourceValidRange.min === null ? null : toCanonical(sourceValidRange.min, "classification.valid_range.min"),
    max: sourceValidRange.max === null ? null : toCanonical(sourceValidRange.max, "classification.valid_range.max"),
    minInclusive: sourceValidRange.minInclusive,
    maxInclusive: sourceValidRange.maxInclusive,
  };
  if (canonicalValidRange && canonicalValidRange.min !== null && canonicalValidRange.max !== null && canonicalValidRange.min >= canonicalValidRange.max) {
    refuse("classification.valid_range.max");
  }
  // The legacy temperature object names its thresholds by key, the list by index.
  const iconTiers =
    sourceIconTiers &&
    convertTierMins(sourceIconTiers, (index) =>
      Array.isArray(value.icons) ? `classification.icons[${index}].min` : `classification.icons.${LEGACY_TEMPERATURE_ICON_KEYS[index]}`
    );
  const invalidWhen = canonicalValidRange ? (reading) => isOutsideRange(reading, canonicalValidRange) : null;

  return {
    id: "custom",
    metricKind,
    // As written, for a message that has to name it.
    unit: value.unit.trim(),
    comparison,
    tiers,
    comfort,
    optimal,
    scale,
    step,
    headroom,
    oneSided,
    anchorScale,
    invalidWhen,
    validRange: canonicalValidRange,
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    iconTiers,
  };
}

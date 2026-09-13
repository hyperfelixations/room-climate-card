// The `classification:` policy, in all four of its forms.
//
//   auto     complete entity attributes when present, else the built-in profile (default)
//   entity   entity attributes only, even partial ones
//   profile  force a named built-in profile
//   custom   a fully user-defined profile from YAML
//
// A custom profile is written in the user's unit and converted to canonical here, once.
// The unit lookup is INJECTED: mapping a unit string to a metric kind is domain
// knowledge, and the config layer must not import the domain registry.
//
// A key the policy or a custom profile does not have refuses the configuration, at any depth
// and before any value is read. An invalid value makes the whole option fall back to `auto`,
// with one warning naming the first value at fault. See internal dev doc §5
// "Custom-Profile-Vertrag".

import { createDiagnostic, fallbackOption, fallbackValue, FALLBACK } from "../../core/diagnostics.js";
import { isOutsideRange } from "../../core/numbers.js";
import { ConfigValueError, rejectValue } from "../errors.js";
import { assertKnownKeys, isPlainObject, isUnwritten } from "../primitives.js";
import {
  BAND_KEYS,
  BANDS_KEYS,
  ICON_TIER_KEYS,
  LEGACY_TEMPERATURE_ICON_KEYS,
  SCALE_KEYS,
  TIER_KEYS,
  VALID_RANGE_KEYS,
  normalizeBands,
  normalizeIcons,
  normalizeScale,
  normalizeTiers,
  normalizeValidRange,
} from "./profile-parts.js";

const SOURCES = ["auto", "entity", "profile", "custom"];
const POLICY_KEYS = ["source", "profile"];
const CUSTOM_KEYS = ["source", "unit", "comparison", "bands", "scale", "tiers", "valid_range", "icons"];

const autoPolicy = () => ({ source: "auto", profile: null, custom: null });

export function normalizeClassificationConfig(value, collaborators, diagnostics) {
  const fallBack = (path, written, instead = fallbackValue("auto")) => {
    diagnostics.push(createDiagnostic("value.invalid", { path, value: written, fallback: instead }));
    return autoPolicy();
  };
  if (isUnwritten(value)) return autoPolicy();
  if (typeof value === "string") {
    const shorthand = value.trim().toLowerCase();
    if (shorthand === "auto" || shorthand === "entity") return { source: shorthand, profile: null, custom: null };
    // `profile` and `custom` name a source whose content only the object form can carry.
    if (!shorthand || shorthand === "profile" || shorthand === "custom") return fallBack("classification", value);
    return { source: "auto", profile: shorthand, custom: null };
  }
  if (!isPlainObject(value)) return fallBack("classification", value);

  // A block carrying `tiers` is a custom profile even without an explicit source — that
  // is the only form in which tiers can appear.
  const source = value.source ?? (value.tiers !== undefined ? "custom" : "auto");
  if (!SOURCES.includes(source)) {
    // Without a usable source no one key set applies, so the keys of every form are allowed.
    assertKnownKeys(value, new Set([...POLICY_KEYS, ...CUSTOM_KEYS]), "classification");
    return fallBack("classification.source", value.source);
  }
  if (source === "custom") {
    assertCustomProfileKeys(value);
    try {
      return { source: "custom", profile: null, custom: normalizeCustomClassification(value, collaborators) };
    } catch (error) {
      if (!(error instanceof ConfigValueError)) throw error;
      return fallBack(error.path, error.value, fallbackOption("classification", "auto"));
    }
  }

  assertKnownKeys(value, POLICY_KEYS, "classification");
  if (isUnwritten(value.profile)) return { source, profile: null, custom: null };
  if (source === "entity") {
    diagnostics.push(createDiagnostic("value.invalid", { path: "classification.profile", value: value.profile, fallback: FALLBACK.IGNORED }));
    return { source, profile: null, custom: null };
  }
  const profile = typeof value.profile === "string" ? value.profile.trim().toLowerCase() : "";
  if (!profile) return fallBack("classification.profile", value.profile);
  return { source, profile, custom: null };
}

// Every key of a custom profile, at every depth, before any value: an unknown key refuses the
// configuration however broken the values around it are. A part of the wrong shape has no keys
// to check; its value rule refuses it.
function assertCustomProfileKeys(value) {
  const keysOf = (part, allowed, path) => {
    if (isPlainObject(part)) assertKnownKeys(part, allowed, path);
  };
  keysOf(value, CUSTOM_KEYS, "classification");
  keysOf(value.bands, BANDS_KEYS, "classification.bands");
  if (isPlainObject(value.bands)) {
    keysOf(value.bands.comfort, BAND_KEYS, "classification.bands.comfort");
    keysOf(value.bands.optimal, BAND_KEYS, "classification.bands.optimal");
  }
  keysOf(value.scale, SCALE_KEYS, "classification.scale");
  keysOf(value.valid_range, VALID_RANGE_KEYS, "classification.valid_range");
  if (Array.isArray(value.tiers)) value.tiers.forEach((tier, index) => keysOf(tier, TIER_KEYS, `classification.tiers[${index}]`));
  if (Array.isArray(value.icons)) value.icons.forEach((item, index) => keysOf(item, ICON_TIER_KEYS, `classification.icons[${index}]`));
  else keysOf(value.icons, LEGACY_TEMPERATURE_ICON_KEYS, "classification.icons");
}

export function normalizeCustomClassification(value, { metricKindForUnit, unitProfileForUnit, classificationZones }) {
  if (typeof value.unit !== "string" || !value.unit.trim()) rejectValue("classification.unit", value.unit);
  const metricKind = metricKindForUnit(value.unit);
  const sourceUnitProfile = metricKind ? unitProfileForUnit(metricKind, value.unit) : null;
  if (!sourceUnitProfile) rejectValue("classification.unit", value.unit);

  const comparison = value.comparison ?? ">=";
  if (comparison !== ">=" && comparison !== ">") rejectValue("classification.comparison", value.comparison);

  const { comfort: sourceComfort, optimal: sourceOptimal } = normalizeBands(value.bands);
  const {
    scale: sourceScale,
    step: sourceStep,
    headroom: sourceHeadroom,
    oneSided,
    anchorScale,
  } = normalizeScale(value.scale);
  const sourceTiers = normalizeTiers(value.tiers, classificationZones);
  const sourceValidRange = normalizeValidRange(value.valid_range);
  const { iconTiers: sourceIconTiers } = normalizeIcons(value.icons, metricKind);

  // Everything above is in the user's unit; from here it is canonical. Absolute readings
  // via toCanonical(), step and headroom via deltaToCanonical() (a difference takes no offset).
  // A finite value written in a scaling unit can overflow on the way; it is refused at the
  // path it was written under. The open ends of tier and icon lists (-Infinity) are not written.
  const unit = value.unit.trim();
  const converting = (convert) => (written, path) => {
    const converted = convert(written);
    if (!Number.isFinite(converted)) rejectValue(path, written);
    return converted;
  };
  const toCanonical = converting(sourceUnitProfile.toCanonical);
  const deltaToCanonical = converting(sourceUnitProfile.deltaToCanonical);
  const convertBand = (band, path) => ({ min: toCanonical(band.min, `${path}.min`), max: toCanonical(band.max, `${path}.max`) });
  const convertTierMins = (tiers, pathOf) =>
    tiers.map((tier, index) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min, pathOf(index)) : tier.min }));

  const comfort = convertBand(sourceComfort, "classification.bands.comfort");
  const optimal = convertBand(sourceOptimal, "classification.bands.optimal");
  // null all the way through when there is no reference range: nothing to convert, and
  // an invented range would be indistinguishable from a declared one downstream.
  const scale = sourceScale && convertBand(sourceScale, "classification.scale");
  const step = deltaToCanonical(sourceStep, "classification.scale.step");
  const headroom = sourceHeadroom === null ? undefined : deltaToCanonical(sourceHeadroom, "classification.scale.headroom");
  const tiers = convertTierMins(sourceTiers, (index) => `classification.tiers[${index}].min`);
  const canonicalValidRange = sourceValidRange && {
    min: sourceValidRange.min === null ? null : toCanonical(sourceValidRange.min, "classification.valid_range.min"),
    max: sourceValidRange.max === null ? null : toCanonical(sourceValidRange.max, "classification.valid_range.max"),
    minInclusive: sourceValidRange.minInclusive,
    maxInclusive: sourceValidRange.maxInclusive,
  };
  // The legacy temperature object names its thresholds by key, the list by index.
  const iconTiers =
    sourceIconTiers &&
    convertTierMins(sourceIconTiers, (index) =>
      Array.isArray(value.icons) ? `classification.icons[${index}].min` : `classification.icons.${LEGACY_TEMPERATURE_ICON_KEYS[index]}`
    );
  // The same comparison (isOutsideRange) the built-in profiles use, so a written window
  // and a declared one cannot disagree about their edges.
  const invalidWhen = canonicalValidRange ? (reading) => isOutsideRange(reading, canonicalValidRange) : null;

  return {
    id: "custom",
    metricKind,
    // As written, for a message that has to name it.
    unit,
    comparison,
    tiers,
    comfort,
    optimal,
    scale,
    step,
    headroom,
    oneSided,
    // Needs no conversion — it says whether the axis is pinned to `scale`, not where — and
    // reaches the axis maths untouched.
    anchorScale,
    invalidWhen,
    validRange: canonicalValidRange,
    // Colourless: a custom profile takes tier colours from the palette, and an invalid
    // reading takes the palette's own invalid colour.
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    iconTiers,
  };
}

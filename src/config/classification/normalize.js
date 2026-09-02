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

import { isOutsideRange } from "../../core/numbers.js";
import { assertAllowedKeys, isPlainObject, optionalString } from "../primitives.js";
import { pathError } from "../errors.js";
import { normalizeBands, normalizeIcons, normalizeScale, normalizeTiers, normalizeValidRange } from "./profile-parts.js";

const AUTO_POLICY = { source: "auto", profile: null, custom: null };

export function normalizeClassificationConfig(value, collaborators) {
  if (value === undefined || value === null || value === "") {
    return { ...AUTO_POLICY };
  }
  if (typeof value === "string") {
    const shorthand = value.trim().toLowerCase();
    if (!shorthand) return { ...AUTO_POLICY };
    if (shorthand === "auto" || shorthand === "entity") {
      return { source: shorthand, profile: null, custom: null };
    }
    if (shorthand === "profile" || shorthand === "custom") {
      pathError("classification", `"${shorthand}" requires the object form`);
    }
    return { source: "auto", profile: shorthand, custom: null };
  }
  if (!isPlainObject(value)) pathError("classification", "must be a string or object");

  // A block carrying `tiers` is a custom profile even without an explicit source — that
  // is the only form in which tiers can appear.
  const inferredSource = value.source ?? (value.tiers !== undefined ? "custom" : "auto");
  if (!["auto", "entity", "profile", "custom"].includes(inferredSource)) {
    pathError("classification.source", 'must be "auto", "entity", "profile", or "custom"');
  }
  if (inferredSource === "custom") {
    return { source: "custom", profile: null, custom: normalizeCustomClassification(value, collaborators) };
  }

  assertAllowedKeys(value, new Set(["source", "profile"]), "classification");
  if (inferredSource === "entity" && value.profile !== undefined) {
    pathError("classification.profile", "cannot be combined with source entity");
  }
  const profile = value.profile === undefined ? null : optionalString(value.profile);
  if (value.profile !== undefined && !profile) {
    pathError("classification.profile", "must be a non-empty string");
  }
  return { source: inferredSource, profile: profile?.toLowerCase() ?? null, custom: null };
}

export function normalizeCustomClassification(value, { metricKindForUnit, unitProfileForUnit, classificationZones }) {
  const allowed = new Set(["source", "unit", "comparison", "bands", "scale", "tiers", "valid_range", "icons"]);
  assertAllowedKeys(value, allowed, "classification");

  if (typeof value.unit !== "string" || !value.unit.trim()) {
    pathError("classification.unit", "must be a recognized unit string");
  }
  const metricKind = metricKindForUnit(value.unit);
  if (!metricKind) pathError("classification.unit", `"${value.unit}" is not recognized`);
  const sourceUnitProfile = unitProfileForUnit(metricKind, value.unit);
  if (!sourceUnitProfile) pathError("classification.unit", `"${value.unit}" has no registered UnitProfile`);

  const comparison = value.comparison ?? ">=";
  if (comparison !== ">=" && comparison !== ">") {
    pathError("classification.comparison", 'must be ">=" or ">"');
  }

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
  const toCanonical = sourceUnitProfile.toCanonical;
  const deltaToCanonical = sourceUnitProfile.deltaToCanonical;
  const convertBand = (band) => ({ min: toCanonical(band.min), max: toCanonical(band.max) });
  const canonicalValidRange = sourceValidRange && {
    min: sourceValidRange.min === null ? null : toCanonical(sourceValidRange.min),
    max: sourceValidRange.max === null ? null : toCanonical(sourceValidRange.max),
    minInclusive: sourceValidRange.minInclusive,
    maxInclusive: sourceValidRange.maxInclusive,
  };
  // The same comparison (isOutsideRange) the built-in profiles use, so a written window
  // and a declared one cannot disagree about their edges.
  const invalidWhen = canonicalValidRange ? (reading) => isOutsideRange(reading, canonicalValidRange) : null;

  return {
    id: "custom",
    metricKind,
    comparison,
    tiers: sourceTiers.map((tier) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min) : tier.min })),
    comfort: convertBand(sourceComfort),
    optimal: convertBand(sourceOptimal),
    // null all the way through when there is no reference range: nothing to convert, and
    // an invented range would be indistinguishable from a declared one downstream.
    scale: sourceScale && convertBand(sourceScale),
    step: deltaToCanonical(sourceStep),
    headroom: sourceHeadroom === null ? undefined : deltaToCanonical(sourceHeadroom),
    oneSided,
    // Needs no conversion — it says whether the axis is pinned to `scale`, not where — and
    // reaches the axis maths untouched.
    anchorScale,
    invalidWhen,
    validRange: canonicalValidRange,
    // Colourless: a custom profile takes tier colours from the palette, and an invalid
    // reading takes the palette's own invalid colour.
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    iconTiers: sourceIconTiers && sourceIconTiers.map((tier) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min) : tier.min })),
  };
}

// The `classification:` policy, in all four of its forms.
//
//   auto     use complete entity attributes when present, else the built-in
//            profile (the default)
//   entity   entity attributes only, even partial ones
//   profile  force a named built-in profile
//   custom   a fully user-defined profile from YAML
//
// A custom profile is written in the user's own unit and converted to the
// metric's canonical unit here, once, so everything downstream compares against
// one unit. The unit lookup is INJECTED: resolving a unit string to a metric kind
// and unit profile is domain knowledge, and the configuration layer must not
// import the domain registry.

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

  // A block carrying `tiers` is a custom profile even without an explicit
  // source, because that is the only form in which tiers can appear.
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

  // Everything above is in the user's own unit. From here on it is canonical:
  // absolute readings via toCanonical(), the rounding step and the headroom via
  // deltaToCanonical(), because a difference must never pick up a unit offset.
  const toCanonical = sourceUnitProfile.toCanonical;
  const deltaToCanonical = sourceUnitProfile.deltaToCanonical;
  const convertBand = (band) => ({ min: toCanonical(band.min), max: toCanonical(band.max) });
  const canonicalValidRange = sourceValidRange && {
    min: sourceValidRange.min === null ? null : toCanonical(sourceValidRange.min),
    max: sourceValidRange.max === null ? null : toCanonical(sourceValidRange.max),
    minInclusive: sourceValidRange.minInclusive,
    maxInclusive: sourceValidRange.maxInclusive,
  };
  const invalidWhen = canonicalValidRange
    ? (reading) =>
        (canonicalValidRange.min !== null && (canonicalValidRange.minInclusive ? reading < canonicalValidRange.min : reading <= canonicalValidRange.min)) ||
        (canonicalValidRange.max !== null && (canonicalValidRange.maxInclusive ? reading > canonicalValidRange.max : reading >= canonicalValidRange.max))
    : null;

  return {
    id: "custom",
    metricKind,
    comparison,
    tiers: sourceTiers.map((tier) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min) : tier.min })),
    comfort: convertBand(sourceComfort),
    optimal: convertBand(sourceOptimal),
    // null all the way through when the profile declares no reference range: there is
    // nothing to convert, and an invented range would be indistinguishable from a
    // declared one everywhere downstream.
    scale: sourceScale && convertBand(sourceScale),
    step: deltaToCanonical(sourceStep),
    headroom: sourceHeadroom === null ? undefined : deltaToCanonical(sourceHeadroom),
    oneSided,
    // The one field a built-in profile had that YAML could not express. It needs no
    // conversion — it says whether the axis is pinned to `scale`, not where — and
    // reaches the axis maths untouched: projectProfileToDisplayUnit() spreads it and
    // scaleConfigFor() reads it straight off the display profile.
    anchorScale,
    invalidWhen,
    validRange: canonicalValidRange,
    // Colourless: a custom profile that named no colours takes them from the palette,
    // and an invalid reading takes the palette's own invalid colour rather than a fixed
    // one that would clash with every palette but the default.
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    iconTiers: sourceIconTiers && sourceIconTiers.map((tier) => ({ ...tier, min: Number.isFinite(tier.min) ? toCanonical(tier.min) : tier.min })),
  };
}

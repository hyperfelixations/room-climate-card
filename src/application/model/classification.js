// Application seam for profile resolution, projection and token-only classification.
// Physical validity uses canonical values; visible decisions use the display projection.

import { CLASSIFICATION_PROFILE_REGISTRY } from "../../domain/classification/registry.js";
import { classifyNumericValue } from "../../domain/classification/classify.js";
import { profileIconForValue } from "../../domain/classification/icons.js";
import { projectProfileToDisplayUnit } from "../../domain/classification/projection.js";
import { resolveClassificationProfile, resolveValueClassification } from "../../domain/classification/resolve.js";
import { resolveClassificationColor } from "../../domain/classification/palette-color.js";
import { DEFAULT_PALETTE } from "../../domain/classification/palettes/registry.js";
import { isPhysicallyValid } from "../../domain/classification/validity.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { scaleConfigFor } from "../../domain/scale/scale-config.js";

// The policy a card falls back to when no classification block is configured.
export const DEFAULT_CLASSIFICATION_POLICY = { source: "auto", profile: null, custom: null };

export function classificationPolicyOf(config) {
  return config?.classification || DEFAULT_CLASSIFICATION_POLICY;
}

// Hand-built configs fall back to the card's default ramp.
export function paletteOf(config) {
  return config?.palette || DEFAULT_PALETTE;
}

// The profile in its authored (canonical) unit.
export function resolveCanonicalProfile(policy, metricKind, { lenient = false } = {}) {
  return resolveClassificationProfile(CLASSIFICATION_PROFILE_REGISTRY[metricKind], policy, metricKind, { lenient });
}

// The profile re-expressed in the unit the card displays.
export function resolveDisplayProfile(policy, metricKind, unitProfile) {
  return projectProfileToDisplayUnit(
    resolveCanonicalProfile(policy, metricKind),
    METRIC_DEFINITIONS[metricKind],
    unitProfile,
    metricKind
  );
}

// Canonicalized readings use canonical limits to avoid projected rounding at the edges.
export function isValuePhysicallyValid(policy, metricKind, unitProfile, value, { lenient = false } = {}) {
  if (!CLASSIFICATION_PROFILE_REGISTRY[metricKind]) return true;
  const profile = unitProfile
    ? resolveDisplayProfile(policy, metricKind, unitProfile)
    : resolveCanonicalProfile(policy, metricKind, { lenient });
  return isPhysicallyValid(profile, value);
}

// The axis parameters, in the displayed unit.
export function resolveScaleConfig(policy, metricKind, unitProfile) {
  return scaleConfigFor(resolveDisplayProfile(policy, metricKind, unitProfile));
}

// Shared numeric tier selection for classification and profile icons.
export function classifyNumericTier(policy, metricKind, unitProfile, value) {
  return classifyNumericValue(resolveDisplayProfile(policy, metricKind, unitProfile), value);
}

// Honour entity/auto/profile/custom priority. Null attributes force numeric classification.
// Keep the numeric fallback lazy so forced entity mode never resolves an unused profile.
export function classifyValue(policy, metricKind, unitProfile, value, attributes, palette) {
  const classification = resolveValueClassification({
    policy,
    attributes,
    numericFallback: () => {
      const numeric = classifyNumericTier(policy, metricKind, unitProfile, value);
      const profile = resolveCanonicalProfile(policy, metricKind);
      return {
        ...numeric,
        source: profile.id === "custom" ? "custom" : "builtin",
        profileId: profile.id,
      };
    },
  });
  // Single token-to-colour boundary; downstream sees only the resolved colour.
  return {
    ...classification,
    color: resolveClassificationColor(classification, palette, `the "${metricKind}" classification`),
  };
}

// Just the colour, for the many places that only tint something.
export function classificationColorOf(policy, metricKind, unitProfile, value, attributes, palette) {
  return classifyValue(policy, metricKind, unitProfile, value, attributes, palette).color;
}

// Null lets presentation use the metric's stable default icon.
export function resolveProfileIcon(policy, metricKind, unitProfile, value) {
  return profileIconForValue(value, resolveDisplayProfile(policy, metricKind, unitProfile));
}

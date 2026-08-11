// The application layer's access to classification.
//
// Every classification decision the pipeline makes needs the same two inputs
// resolved first: which profile the card-wide policy selects, and which unit that
// profile has to be expressed in. Doing that in one place keeps the rest of the
// pipeline from re-deriving it, and keeps the ORDER right — the physical-validity
// check has to run against the canonical profile, everything the user sees against
// the projected one.
//
// Results are returned in TOKEN form (levelKey for a built-in tier, a verbatim
// level string for a custom profile). Translation happens in the presentation
// layer; a wrong split here would put German UI text into the model.

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

// The palette a card classifies with. A normalized configuration always carries one;
// the fallback is for the call sites that build a model from a hand-written config
// object, so that a missing palette is the card's own ramp rather than a crash.
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

// Physical validity. With no unit profile this deliberately uses the CANONICAL
// profile: an entity's reading is canonicalized before this runs, and comparing a
// converted value against projected-and-rounded limits would reject valid data at
// the edges.
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

// The purely numeric tier of a value, ignoring any entity-provided
// classification. The single implementation of "which tier does this value fall
// into", used by classifyValue() below and by the icon path.
export function classifyNumericTier(policy, metricKind, unitProfile, value) {
  return classifyNumericValue(resolveDisplayProfile(policy, metricKind, unitProfile), value);
}

// One value's classification, honouring the entity/auto/profile/custom priority.
// `attributes` is the entity's own attribute object, or null when there is no
// entity to read from (historical range extremes deliberately pass null so they
// classify numerically instead of inheriting the entity's current colour).
//
// The numeric branch stays lazy: projecting the profile can throw on a degenerate
// custom profile, and a card in forced `entity` mode must not start failing on a
// profile it never looks at.
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
  // The one place a classification turns into a colour. Everything downstream reads
  // `color` and needs to know nothing about palettes, ramps or provenance; everything
  // upstream produces tokens and needs to know nothing about hex values.
  return {
    ...classification,
    color: resolveClassificationColor(classification, palette, `the "${metricKind}" classification`),
  };
}

// Just the colour, for the many places that only tint something.
export function classificationColorOf(policy, metricKind, unitProfile, value, attributes, palette) {
  return classifyValue(policy, metricKind, unitProfile, value, attributes, palette).color;
}

// The profile's own icon token, or null when the profile declares none — the
// presentation layer then falls back to the metric's stable default icon.
export function resolveProfileIcon(policy, metricKind, unitProfile, value) {
  return profileIconForValue(value, resolveDisplayProfile(policy, metricKind, unitProfile));
}

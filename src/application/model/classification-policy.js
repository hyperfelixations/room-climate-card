// Which classification a render applies: the configured policy, unless the sensors show it
// cannot hold — a named profile the measurement does not have, a custom profile written in
// another measurement's unit, or one the display unit cannot represent. Then the measurement's
// default profile, with a warning. See internal dev doc §5 "Klassifikations-Rückfall".

import { createDiagnostic } from "../../core/diagnostics.js";
import { CLASSIFICATION_PROFILE_REGISTRY } from "../../domain/classification/registry.js";
import { projectProfile } from "../../domain/classification/projection.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";

const AUTO = Object.freeze({ source: "auto", profile: null, custom: null });

export function resolveEffectivePolicy({ policy, metricKind, displayUnitProfile }) {
  const registry = CLASSIFICATION_PROFILE_REGISTRY[metricKind];
  const fallback = registry.defaultProfile;
  const fellBack = (effective, code, details) => ({ policy: effective, diagnostics: [createDiagnostic(code, details)] });

  if (policy.source === "custom") {
    const { custom } = policy;
    if (custom.metricKind !== metricKind) {
      return fellBack({ ...AUTO }, "classification.unit_mismatch", {
        path: "classification.unit",
        value: custom.unit,
        params: { measurement: metricKind, fallback },
      });
    }
    if (projectProfile(custom, METRIC_DEFINITIONS[metricKind], displayUnitProfile).fault) {
      return fellBack({ ...AUTO }, "classification.not_representable", {
        params: { unit: displayUnitProfile.displayUnit || displayUnitProfile.key, fallback },
      });
    }
    return { policy, diagnostics: [] };
  }
  if (policy.profile && !registry.profiles[policy.profile]) {
    return fellBack({ ...policy, profile: null }, "classification.profile_unavailable", {
      path: "classification.profile",
      value: policy.profile,
      params: { measurement: metricKind, fallback },
    });
  }
  return { policy, diagnostics: [] };
}

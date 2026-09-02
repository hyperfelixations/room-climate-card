// Which classification profile applies, and how a value is classified against it.
//
//   resolveClassificationProfile()  card-wide policy: a custom YAML profile, a named
//                                   built-in, or the metric kind's default.
//   resolveValueClassification()    per-value priority: forced entity attributes, then
//                                   complete entity attributes in `auto`, then numeric.
//
// The numeric path is passed as a THUNK: it projects the profile and can throw on a
// degenerate custom profile, so an `entity`-mode card must not evaluate it eagerly.

import { readEntityClassification } from "./entity-attributes.js";

const NO_LEVEL = "—";

// An entity-provided classification in the shape the colour resolver reads. Its colour is
// EXPLICIT (whatever the integration supplied, or nothing) and it carries no deviation:
// `value_score` is on the integration's own scale, not the card's palette.
function fromEntityAttributes(entity, level) {
  return {
    level,
    levelKey: null,
    score: entity?.score ?? null,
    zone: entity?.zone ?? null,
    explicitColor: entity?.color || null,
    deviation: null,
    deviationSpan: null,
    invalid: false,
    source: "entity",
    profileId: null,
  };
}

// lenient: while probing a room's OWN metric kind (before kind filtering has run), a
// card-wide profile scoped to a different kind is not yet known to be irrelevant, so fall
// back to that kind's default instead of throwing. Every other caller passes the resolved
// kind, so a genuine primary/profile mismatch still surfaces as the documented config error.
export function resolveClassificationProfile(registryForKind, policy, metricKind, { lenient = false } = {}) {
  if (!registryForKind) throw new Error(`No classification profiles registered for metric kind "${metricKind}"`);
  if (policy.source === "custom") {
    if (policy.custom.metricKind !== metricKind) {
      if (lenient) return registryForKind.profiles[registryForKind.defaultProfile];
      throw new Error(
        `Invalid configuration: custom classification unit belongs to "${policy.custom.metricKind}", not detected metric kind "${metricKind}".`
      );
    }
    return policy.custom;
  }
  const profileId = policy.profile || registryForKind.defaultProfile;
  const profile = registryForKind.profiles[profileId];
  if (!profile) {
    if (lenient) return registryForKind.profiles[registryForKind.defaultProfile];
    throw new Error(`Invalid configuration: classification profile "${profileId}" is not available for metric kind "${metricKind}".`);
  }
  return profile;
}

// `attributes` is the entity's raw attribute object (null when it does not exist);
// `numericFallback` is the thunk. `entity` mode never falls back to a numeric tier —
// a neutral colour and an em dash stand in for missing metadata.
export function resolveValueClassification({ policy, attributes, numericFallback }) {
  if (policy.source === "entity") {
    const entity = readEntityClassification(attributes, { allowPartial: true });
    return fromEntityAttributes(entity, entity?.level || NO_LEVEL);
  }
  if (policy.source === "auto") {
    const entity = readEntityClassification(attributes);
    if (entity) return fromEntityAttributes(entity, entity.level);
  }
  return numericFallback();
}

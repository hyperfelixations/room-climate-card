// Which classification profile applies, and how a value is classified against
// it once it has been chosen.
//
// Two separate decisions live here:
//
//   resolveClassificationProfile()  the card-wide policy: a custom profile from
//                                  YAML, a named built-in, or the metric kind's
//                                  default.
//   resolveValueClassification()    the per-value priority: forced entity
//                                  attributes, then complete entity attributes
//                                  in automatic mode, then the numeric profile.
//
// The second one takes the numeric path as a THUNK rather than a value. That is
// not a style choice: the numeric path projects the profile into the display unit
// and can legitimately throw on a degenerate custom profile. Computing it eagerly
// would make a card in `entity` mode start failing on a profile it never looks
// at.

import { readEntityClassification } from "./entity-attributes.js";

const NEUTRAL_COLOR = "#B4B2A9";
const NO_LEVEL = "—";

// lenient: an entity's OWN metric kind has to be probed before kind-based
// filtering has run, so at that point a card-wide profile scoped to a DIFFERENT
// kind (e.g. an outdoor temperature profile, probed for an incidental humidity
// room) is not yet known to be irrelevant. Falling back to that kind's own
// default instead of throwing lets the later kind filter do its job. Every other
// caller passes the card's actually-resolved kind, so a genuine mismatch between
// the primary entity's kind and the configured profile still surfaces as the
// documented config error.
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

// The per-value priority. `attributes` is the entity's raw attribute object (or
// null when the entity does not exist); `numericFallback` is the thunk described
// above.
//
// In forced `entity` mode the card shows whatever the integration provides and
// never falls back to a numeric tier — a neutral colour and an em dash stand in
// for missing metadata, so it stays visible that the entity, not the card, owns
// the classification.
export function resolveValueClassification({ policy, attributes, numericFallback }) {
  if (policy.source === "entity") {
    const entity = readEntityClassification(attributes, { allowPartial: true });
    return {
      color: entity?.color || NEUTRAL_COLOR,
      level: entity?.level || NO_LEVEL,
      score: entity?.score ?? null,
      zone: entity?.zone ?? null,
      source: "entity",
      profileId: null,
    };
  }
  if (policy.source === "auto") {
    const entity = readEntityClassification(attributes);
    if (entity) return entity;
  }
  return numericFallback();
}

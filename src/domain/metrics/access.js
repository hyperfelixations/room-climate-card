// Registry-aware convenience over METRIC_DEFINITIONS.
//
// The primitives in domain/units/ take profile/tier OBJECTS with no registry lookup, so
// they stay usable for an unregistered metric kind. These wrappers add the lookup and
// THROW rather than return undefined: an unknown kind here is a caller error, and a
// silent undefined would surface much later as a NaN in a rendered value.

import { convertUnitValue } from "../units/conversion.js";
import { METRIC_DEFINITIONS } from "./definitions.js";

export function getMetricDefinition(metricKind) {
  const definition = METRIC_DEFINITIONS[metricKind];
  if (!definition) throw new Error(`No MetricDefinition registered for metricKind "${metricKind}"`);
  return definition;
}

export function getUnitProfile(metricKind, profileKey) {
  const profile = getMetricDefinition(metricKind).unitProfiles[profileKey];
  if (!profile) throw new Error(`Unknown unitProfile "${profileKey}" for metricKind "${metricKind}"`);
  return profile;
}

export function convertMetricValue(value, { metricKind, quantityKind, fromProfileKey, toProfileKey }) {
  return convertUnitValue(
    value,
    quantityKind,
    getUnitProfile(metricKind, fromProfileKey),
    getUnitProfile(metricKind, toProfileKey)
  );
}

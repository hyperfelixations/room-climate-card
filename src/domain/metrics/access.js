// Registry-aware convenience over METRIC_DEFINITIONS.
//
// The primitives in domain/units/ deliberately take profile and tier OBJECTS, with
// no registry lookup, so they stay usable for a metric kind that is not registered
// yet. These wrappers add the lookup for the common case, and they THROW rather
// than returning undefined: an unknown metric kind or unit profile at this point
// means a caller resolved something wrong, and a silent undefined would surface
// much later as a NaN in a rendered value.

import {
  convertUnitValue,
  deriveBandForProfile as deriveBandForProfileFromBand,
  deriveThresholdsForProfile as deriveThresholdsForProfileFromTiers,
} from "../units/conversion.js";
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

// The kind's canonical classification tiers, re-expressed in one of its display
// units.
export function deriveThresholdsForProfile(metricKind, profileKey) {
  return deriveThresholdsForProfileFromTiers(
    getMetricDefinition(metricKind).canonicalClassificationTiers,
    getUnitProfile(metricKind, profileKey)
  );
}

// One of the kind's canonical bands ("comfort", "optimal", "baseScale"),
// re-expressed in one of its display units.
export function deriveBandForProfile(metricKind, profileKey, bandName) {
  const definition = getMetricDefinition(metricKind);
  const bandKey = `canonical${bandName[0].toUpperCase()}${bandName.slice(1)}Band`;
  const band = definition[bandKey];
  if (!band) throw new Error(`Unknown band "${bandName}" for metricKind "${metricKind}"`);
  return deriveBandForProfileFromBand(band, getUnitProfile(metricKind, profileKey));
}

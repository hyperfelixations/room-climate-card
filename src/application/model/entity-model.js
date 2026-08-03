// One EntityModel per participating entity.
//
// Everything needed to decide whether an entity may determine the card's metric
// kind or contribute to the average is resolved ONCE, here, from the same state
// object. Atomicity prevents a humidity room from joining a temperature average,
// a "1013 hPa" primary from displaying as °C, or an unavailable room from
// participating in consensus.
//
// The unit rule is deliberately strict and symmetric: a unit is trusted only when
// it is BOTH present AND resolves to a registered profile. A missing
// unit_of_measurement is NOT assumed to be the canonical unit — missing and
// unknown both yield unitProfile:null, exclude the measurement, and get
// diagnosed. metricKind itself is still resolved in that case, so the no-data state
// can show the right title and icon.
//
// `states` is Home Assistant's own states object, read but never written.

import { isUnavailableState, parseNumericState } from "../../core/numbers.js";
import { normalizeUnitToken } from "../../domain/units/unit-token.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { convertMetricValue } from "../../domain/metrics/access.js";
import { METRIC_TYPE_BY_DEVICE_CLASS, METRIC_TYPE_BY_UNIT, resolveUnitProfileKey } from "../../domain/metrics/resolution.js";
import { classificationPolicyOf, isValuePhysicallyValid } from "./classification.js";

// One exhaustive vocabulary for a configured entity's current availability.
// Consumers compare these values; they never repeat the raw-state/unit/kind
// checks that decide them.
export const AVAILABILITY = Object.freeze({
  USABLE: "usable",
  MISSING: "missing",
  UNAVAILABLE: "unavailable",
  INVALID_VALUE: "invalid_value",
  INCOMPATIBLE_UNIT: "incompatible_unit",
  INCOMPATIBLE_KIND: "incompatible_kind",
});

export function hasEntity(states, entityId) {
  return Boolean(entityId && states?.[entityId]);
}

export function readNumericState(states, entityId) {
  if (!entityId) return null;
  return parseNumericState(states?.[entityId]?.state);
}

export function readNumericAttribute(states, entityId, attributeName) {
  if (!entityId || !attributeName) return null;
  return parseNumericState(states?.[entityId]?.attributes?.[attributeName]);
}

export function readAttributes(states, entityId) {
  if (!entityId) return null;
  return states?.[entityId]?.attributes ?? null;
}

// One entity's own unit_of_measurement, with no metric-kind fallback — the
// counterpart to metricKindForEntity(), so kind and unit always come from the
// SAME entity.
export function rawUnitForEntity(states, entityId) {
  const entityUnit = states?.[entityId]?.attributes?.unit_of_measurement;
  return typeof entityUnit === "string" && entityUnit.trim() ? entityUnit.trim() : null;
}

// device_class first (Home Assistant's own declaration), unit_of_measurement as
// the fallback; null when neither is present or recognized.
export function metricKindForEntity(states, entityId) {
  const state = states?.[entityId];
  if (!state) return null;
  const deviceClass = state.attributes?.device_class;
  if (typeof deviceClass === "string" && deviceClass.trim()) {
    const metric = METRIC_TYPE_BY_DEVICE_CLASS[deviceClass.trim().toLowerCase()];
    if (metric) return metric;
  }
  const unit = normalizeUnitToken(state.attributes?.unit_of_measurement);
  return METRIC_TYPE_BY_UNIT[unit] || null;
}

// range_entity and trend_entity are auxiliary sensors, not participants in metric
// kind resolution, but their readings still need a unit profile before they can be
// converted. The same strict rule applies: a missing unit is as unusable as an
// unknown one, never a silent canonical assumption.
//
// rateSuffix: a rate is conventionally reported with "/h" appended to the
// absolute unit ("°C/h", "ppm/h" — Home Assistant's own derivative helpers use
// exactly that). The suffix is stripped before matching; a trend entity using the
// bare absolute unit still resolves, since stripping a non-matching suffix is a
// no-op.
export function resolveAuxiliaryUnitProfileKey(states, entityId, metricKind, { rateSuffix = false } = {}) {
  if (!entityId) return null;
  if (!METRIC_DEFINITIONS[metricKind]) return null;
  let rawUnit = rawUnitForEntity(states, entityId);
  if (!rawUnit) return null;
  if (rateSuffix) rawUnit = rawUnit.replace(/\s*\/\s*h$/i, "");
  return resolveUnitProfileKey(metricKind, rawUnit);
}

// Re-exported so the whole pipeline converts through one implementation (see
// domain/metrics/access.js).
export { convertMetricValue };

export function buildEntityModel(states, config, entityId, sourceRole) {
  const policy = classificationPolicyOf(config);
  const stateObject = entityId ? states?.[entityId] || null : null;
  const rawValue = readNumericState(states, entityId);
  const rawUnit = rawUnitForEntity(states, entityId);
  const rawDeviceClass = stateObject?.attributes?.device_class;
  const deviceClass = typeof rawDeviceClass === "string" && rawDeviceClass.trim() ? rawDeviceClass.trim() : null;
  const metricKind = metricKindForEntity(states, entityId);
  const validNumeric = rawValue !== null;

  let unitProfile = null;
  let canonicalValue = rawValue;
  let validUnit = true;
  if (validNumeric && metricKind) {
    const definition = METRIC_DEFINITIONS[metricKind]; // every registered kind has one
    if (rawUnit) {
      unitProfile = resolveUnitProfileKey(metricKind, rawUnit);
      if (!unitProfile) validUnit = false;
    } else {
      validUnit = false;
    }
    if (unitProfile) {
      canonicalValue = convertMetricValue(rawValue, {
        metricKind,
        quantityKind: "absolute",
        fromProfileKey: unitProfile,
        toProfileKey: definition.canonicalProfileKey,
      });
    }
  }

  // Validity limits are defined in the profile's canonical unit, so this runs
  // only AFTER unit resolution and conversion — comparing a raw Fahrenheit value
  // against canonical Celsius limits would reject perfectly good data.
  //
  // lenient: this entity's own kind may not be the kind the card-wide policy is
  // scoped to (a humidity room on a temperature card configured with the outdoor
  // profile). Falling back to that kind's default profile here lets the later
  // kind filter do its job instead of throwing during a probe.
  const validPhysical = validNumeric && (!validUnit || isValuePhysicallyValid(policy, metricKind, null, canonicalValue, { lenient: true }));

  let availability;
  if (!stateObject) availability = AVAILABILITY.MISSING;
  else if (isUnavailableState(stateObject.state)) availability = AVAILABILITY.UNAVAILABLE;
  else if (!validNumeric) availability = AVAILABILITY.INVALID_VALUE;
  else if (metricKind === null) availability = AVAILABILITY.INCOMPATIBLE_KIND;
  else if (!validUnit) availability = AVAILABILITY.INCOMPATIBLE_UNIT;
  else if (!validPhysical) availability = AVAILABILITY.INVALID_VALUE;
  else availability = AVAILABILITY.USABLE;

  return {
    entityId,
    sourceRole,
    stateObject,
    rawValue,
    rawUnit,
    deviceClass,
    metricKind,
    unitProfile,
    quantityKind: "absolute",
    canonicalValue,
    validNumeric,
    validPhysical,
    validUnit,
    availability,
    errors: [],
  };
}

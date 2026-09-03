// Resolve each configured entity atomically from one read-only Home Assistant state object.
// Units must be present and registered; metric kind may still identify unusable readings for
// no-data title and icon selection.

import { isUnavailableState, parseNumericState } from "../../core/numbers.js";
import { normalizeUnitToken } from "../../domain/units/unit-token.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { convertMetricValue } from "../../domain/metrics/access.js";
import {
  METRIC_TYPE_BY_DEVICE_CLASS,
  metricKindFromUnitAlone,
  resolveUnitProfileKey,
  unitPredictsMetricKind,
} from "../../domain/metrics/resolution.js";
import { classificationPolicyOf, isValuePhysicallyValid } from "./classification.js";

// Closed decision vocabulary; consumers never repeat raw state/unit/kind checks.
export const AVAILABILITY = Object.freeze({
  USABLE: "usable",
  MISSING: "missing",
  UNAVAILABLE: "unavailable",
  INVALID_VALUE: "invalid_value",
  INCOMPATIBLE_UNIT: "incompatible_unit",
  INCOMPATIBLE_KIND: "incompatible_kind",
});

// Explanation vocabulary kept separate from AVAILABILITY policy decisions.
// Details: see internal dev doc §3 "EntityModel und MeasurementContext".
export const UNUSABLE_REASON = Object.freeze({
  NONE: "none",
  // The configured id is not in hass.states at all.
  MISSING: "missing",
  // Home Assistant's own "unavailable"/"unknown" sentinels.
  UNAVAILABLE: "unavailable",
  // A state that is present and is not a number.
  NOT_NUMERIC: "not_numeric",
  // A number outside what the measurement can physically be — 800 % humidity.
  OUT_OF_RANGE: "out_of_range",
  // Shared unit without device_class; adding one resolves the ambiguity.
  UNIT_AMBIGUOUS: "unit_ambiguous",
  // No device_class and no unit the card recognizes: nothing says what this measures.
  UNIDENTIFIED: "unidentified",
  // The measurement is known, its unit is not one the card can read for it.
  UNIT_UNREADABLE: "unit_unreadable",
  // A recognized measurement, but not the one this card is showing.
  KIND_MISMATCH: "kind_mismatch",
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

// `names` is a closed precedence list; never guess similarly named integration attributes.
export function readFirstAttribute(attributes, names) {
  if (!attributes) return null;
  for (const name of names) {
    const value = attributes[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function readAttributes(states, entityId) {
  if (!entityId) return null;
  return states?.[entityId]?.attributes ?? null;
}

// Read only this entity's unit; metric kind and unit must share an owner.
export function rawUnitForEntity(states, entityId) {
  const entityUnit = states?.[entityId]?.attributes?.unit_of_measurement;
  return typeof entityUnit === "string" && entityUnit.trim() ? entityUnit.trim() : null;
}

// Prefer device_class; use only an unambiguous unit fallback.
export function metricKindForEntity(states, entityId) {
  const state = states?.[entityId];
  if (!state) return null;
  const deviceClass = state.attributes?.device_class;
  if (typeof deviceClass === "string" && deviceClass.trim()) {
    const metric = METRIC_TYPE_BY_DEVICE_CLASS[deviceClass.trim().toLowerCase()];
    if (metric) return metric;
  }
  // Shared units require device_class instead of a guess.
  return metricKindFromUnitAlone(state.attributes?.unit_of_measurement);
}

// Auxiliary sensors also require registered units but do not arbitrate metric kind.
// `rateSuffix` strips an optional conventional `/h` before profile matching.
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

// Derive policy status and explanatory reason together from the same ordered facts.
function resolveAvailability({ stateObject, validNumeric, metricKind, rawUnit, validUnit, validPhysical }) {
  const pair = (availability, unusableReason) => ({ availability, unusableReason });
  if (!stateObject) return pair(AVAILABILITY.MISSING, UNUSABLE_REASON.MISSING);
  if (isUnavailableState(stateObject.state)) return pair(AVAILABILITY.UNAVAILABLE, UNUSABLE_REASON.UNAVAILABLE);
  if (!validNumeric) return pair(AVAILABILITY.INVALID_VALUE, UNUSABLE_REASON.NOT_NUMERIC);
  if (metricKind === null) {
    // Shared and unknown units have one policy result but different remedies.
    const shared = Boolean(rawUnit) && !unitPredictsMetricKind(rawUnit);
    return pair(AVAILABILITY.INCOMPATIBLE_KIND, shared ? UNUSABLE_REASON.UNIT_AMBIGUOUS : UNUSABLE_REASON.UNIDENTIFIED);
  }
  if (!validUnit) return pair(AVAILABILITY.INCOMPATIBLE_UNIT, UNUSABLE_REASON.UNIT_UNREADABLE);
  if (!validPhysical) return pair(AVAILABILITY.INVALID_VALUE, UNUSABLE_REASON.OUT_OF_RANGE);
  return pair(AVAILABILITY.USABLE, UNUSABLE_REASON.NONE);
}

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

  // Validate only after canonical conversion, including finiteness of the converted result.
  // Lenient profile lookup lets later metric-kind arbitration reject foreign rooms cleanly.
  const validPhysical =
    validNumeric &&
    Number.isFinite(canonicalValue) &&
    (!validUnit || isValuePhysicallyValid(policy, metricKind, null, canonicalValue, { lenient: true }));

  const { availability, unusableReason } = resolveAvailability({
    stateObject,
    validNumeric,
    metricKind,
    rawUnit,
    validUnit,
    validPhysical,
  });

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
    unusableReason,
    errors: [],
  };
}

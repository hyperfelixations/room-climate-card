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
import {
  METRIC_TYPE_BY_DEVICE_CLASS,
  metricKindFromUnitAlone,
  resolveUnitProfileKey,
  unitPredictsMetricKind,
} from "../../domain/metrics/resolution.js";
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

// WHY a source cannot be used — which is a different question from whether it may
// participate, and has to be answered separately or one of the two answers gets bent.
//
// AVAILABILITY is a POLICY vocabulary: everything downstream compares against it to
// decide who joins the average, who becomes a placeholder chip, who is filtered out. Its
// categories are therefore as coarse as those decisions need, and INVALID_VALUE covers
// both "the sensor says heating" and "the sensor says 800 %" because both mean the same
// thing to every one of those decisions.
//
// They do NOT mean the same thing to a reader, and that is what this vocabulary is for.
// It changes no decision anywhere; it exists so the card can say what actually happened
// instead of picking the nearest of three sentences. The two live side by side rather
// than one being derived from the other, because every attempt to serve both purposes
// with one value ends with a policy category invented for a message, or a message that is
// vague because its category had to stay coarse.
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
  // No device_class, and a unit several measurements share. The card refuses to guess;
  // adding a device_class fixes it, and the message says so.
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

// The first of several accepted spellings of one attribute, for the places where an
// attribute has more than one name in the wild.
//
// The order of `names` IS the precedence, and it is a closed list on purpose: searching
// for "any attribute that looks like a timestamp" would sooner or later hit an unrelated
// one from some other integration and read it as ours.
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
  // Only where the unit belongs to a single measurement — see metricKindFromUnitAlone().
  // Where several share it, the card asks for a device_class rather than guessing.
  return metricKindFromUnitAlone(state.attributes?.unit_of_measurement);
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

// One cascade, two answers. Decided together because they are decided by the same facts
// in the same order, and keeping them in step is not something a second pass over the
// finished model could guarantee.
function resolveAvailability({ stateObject, validNumeric, metricKind, rawUnit, validUnit, validPhysical }) {
  const pair = (availability, unusableReason) => ({ availability, unusableReason });
  if (!stateObject) return pair(AVAILABILITY.MISSING, UNUSABLE_REASON.MISSING);
  if (isUnavailableState(stateObject.state)) return pair(AVAILABILITY.UNAVAILABLE, UNUSABLE_REASON.UNAVAILABLE);
  if (!validNumeric) return pair(AVAILABILITY.INVALID_VALUE, UNUSABLE_REASON.NOT_NUMERIC);
  if (metricKind === null) {
    // Two different things a reader can do about it, and one policy answer for both: a
    // unit several measurements share needs a device_class added, a unit nothing
    // recognizes needs the card pointed somewhere else.
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

  // Validity limits are defined in the profile's canonical unit, so this runs
  // only AFTER unit resolution and conversion — comparing a raw Fahrenheit value
  // against canonical Celsius limits would reject perfectly good data.
  //
  // AND THE CONVERSION ITSELF HAS TO HAVE PRODUCED A NUMBER. A finite state can leave it
  // non-finite: 1e308 °F is (v − 32) × 5/9, and the multiplication by five overflows to
  // Infinity. That is not a reading of anything, so it is refused here rather than averaged,
  // classified and drawn — the same answer 800 % humidity gets, for the same reason. Only
  // the scaling paths can do it; °C and K at the same magnitude never multiply.
  //
  // lenient: this entity's own kind may not be the kind the card-wide policy is
  // scoped to (a humidity room on a temperature card configured with the outdoor
  // profile). Falling back to that kind's default profile here lets the later
  // kind filter do its job instead of throwing during a probe.
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

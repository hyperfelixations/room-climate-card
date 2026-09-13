// Optional range and trend sensors require numeric values and registered units.
// Range state is a delta, range min/max are absolute, and trend is a rate.
// Timestamps stay raw for presentation-layer formatting.

import { finiteOrNull } from "../../core/numbers.js";
import { classifyTrendRate, TREND_DIRECTION_META, TREND_POLICY_REGISTRY } from "../../domain/trend.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { classificationColorOf, isValuePhysicallyValid } from "./classification.js";
import {
  convertMetricValue,
  readFirstAttribute,
  readNumericAttribute,
  readNumericState,
  resolveAuxiliaryUnitProfileKey,
} from "./entity-model.js";

// What an auxiliary sensor gave, for the diagnostics that name it: nothing configured, no such
// entity, a momentary gap (no number, or none that can be shown), a unit the card cannot read
// for this measurement, or a value. The unit is judged only for a number, in the order
// resolveAvailability() uses, so an `unavailable` state without attributes is a gap.
export const AUXILIARY_STATUS = Object.freeze({
  NONE: "none",
  MISSING: "missing",
  TRANSIENT: "transient",
  UNREADABLE: "unreadable",
  USABLE: "usable",
});

function auxiliarySource(states, entity, reading, profileKey, value) {
  let status = AUXILIARY_STATUS.USABLE;
  if (!entity) status = AUXILIARY_STATUS.NONE;
  else if (!states?.[entity]) status = AUXILIARY_STATUS.MISSING;
  else if (reading === null) status = AUXILIARY_STATUS.TRANSIENT;
  else if (!profileKey) status = AUXILIARY_STATUS.UNREADABLE;
  else if (value === null) status = AUXILIARY_STATUS.TRANSIENT;
  return { entity: entity || null, status };
}

// Keep trend-policy lookup behind one seam.
export function resolveTrendPolicy(metricKind) {
  return TREND_POLICY_REGISTRY[metricKind] || null;
}

export function buildTrendModel(metricKind, canonicalValue, displayValue, displayUnit) {
  const policy = resolveTrendPolicy(metricKind);
  const direction = classifyTrendRate(canonicalValue, policy);
  const directionMeta = direction ? TREND_DIRECTION_META[direction] : null;
  if (!directionMeta || !Number.isFinite(displayValue) || !displayUnit) return null;
  return {
    canonicalValue,
    value: displayValue,
    unit: displayUnit,
    direction,
    directionTranslationKey: directionMeta.translationKey,
    policy,
  };
}

export function buildRangeModel({ states, config, policy, palette, metricKind, displayUnitProfile, toDisplay, toDisplayDelta }) {
  const definition = METRIC_DEFINITIONS[metricKind];
  const profileKey = resolveAuxiliaryUnitProfileKey(states, config.range_entity, metricKind);

  // Each conversion below can overflow a finite reading, into the canonical or into the display
  // unit; a non-finite result is no value.
  const reading = readNumericState(states, config.range_entity);
  let state = profileKey ? reading : null;
  if (state !== null) {
    state = finiteOrNull(
      toDisplayDelta(
        convertMetricValue(state, {
          metricKind,
          quantityKind: "delta",
          fromProfileKey: profileKey,
          toProfileKey: definition.canonicalProfileKey,
        })
      )
    );
  }
  // Validate the projected display value; a negative width is impossible.
  const hasRange = state !== null && state >= 0;

  let min = hasRange ? readNumericAttribute(states, config.range_entity, "minimum") : null;
  let max = hasRange ? readNumericAttribute(states, config.range_entity, "maximum") : null;
  if (min !== null) {
    min = finiteOrNull(
      toDisplay(
        convertMetricValue(min, { metricKind, quantityKind: "absolute", fromProfileKey: profileKey, toProfileKey: definition.canonicalProfileKey })
      )
    );
  }
  if (max !== null) {
    max = finiteOrNull(
      toDisplay(
        convertMetricValue(max, { metricKind, quantityKind: "absolute", fromProfileKey: profileKey, toProfileKey: definition.canonicalProfileKey })
      )
    );
  }
  if (min !== null && !isValuePhysicallyValid(policy, metricKind, displayUnitProfile, min)) min = null;
  if (max !== null && !isValuePhysicallyValid(policy, metricKind, displayUnitProfile, max)) max = null;

  const attributes = hasRange ? states?.[config.range_entity]?.attributes : undefined;
  // English names win; legacy German names remain optional fallbacks.
  const minTimestamp = hasRange ? readFirstAttribute(attributes, ["minimum_timestamp", "minimum_zeitpunkt"]) : null;
  const maxTimestamp = hasRange ? readFirstAttribute(attributes, ["maximum_timestamp", "maximum_zeitpunkt"]) : null;

  // Historical min/max classify numerically, never from the entity's current attributes.
  const minColor = min !== null ? classificationColorOf(policy, metricKind, displayUnitProfile, min, null, palette) : null;
  const maxColor = max !== null ? classificationColorOf(policy, metricKind, displayUnitProfile, max, null, palette) : null;

  return {
    hasRange,
    state,
    min,
    max,
    minTimestamp,
    maxTimestamp,
    minColor,
    maxColor,
    // Availability requires valid ordered extrema; view composition decides activation.
    rangeScaleAvailable: hasRange && min !== null && max !== null && min <= max,
    source: auxiliarySource(states, config.range_entity, reading, profileKey, hasRange ? state : null),
  };
}

export function buildTrendContext({ states, config, metricKind, unit, toDisplayDelta }) {
  const definition = METRIC_DEFINITIONS[metricKind];
  const profileKey = resolveAuxiliaryUnitProfileKey(states, config.trend_entity, metricKind, { rateSuffix: true });
  const reading = readNumericState(states, config.trend_entity);
  const rawValue = profileKey ? reading : null;

  let canonicalValue = null;
  let value = null;
  if (rawValue !== null) {
    // Both conversions can overflow a finite rate; a non-finite result is no trend.
    canonicalValue = finiteOrNull(
      convertMetricValue(rawValue, {
        metricKind,
        quantityKind: "rate",
        fromProfileKey: profileKey,
        toProfileKey: definition.canonicalProfileKey,
      })
    );
    value = canonicalValue === null ? null : finiteOrNull(toDisplayDelta(canonicalValue));
  }
  // Label the converted number with the display unit, never the raw entity unit.
  const displayUnit = config.trend_entity ? `${unit}/h` : null;

  return {
    value,
    unit: displayUnit,
    model: buildTrendModel(metricKind, canonicalValue, value, displayUnit),
    source: auxiliarySource(states, config.trend_entity, reading, profileKey, value),
  };
}

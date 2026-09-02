// Optional range and trend sensors require numeric values and registered units.
// Range state is a delta, range min/max are absolute, and trend is a rate.
// Timestamps stay raw for presentation-layer formatting.

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

  let state = profileKey ? readNumericState(states, config.range_entity) : null;
  if (state !== null) {
    state = toDisplayDelta(
      convertMetricValue(state, {
        metricKind,
        quantityKind: "delta",
        fromProfileKey: profileKey,
        toProfileKey: definition.canonicalProfileKey,
      })
    );
  }
  // Validate the projected display value; a negative width is impossible.
  const hasRange = state !== null && state >= 0;

  let min = hasRange ? readNumericAttribute(states, config.range_entity, "minimum") : null;
  let max = hasRange ? readNumericAttribute(states, config.range_entity, "maximum") : null;
  if (min !== null) {
    min = toDisplay(
      convertMetricValue(min, { metricKind, quantityKind: "absolute", fromProfileKey: profileKey, toProfileKey: definition.canonicalProfileKey })
    );
  }
  if (max !== null) {
    max = toDisplay(
      convertMetricValue(max, { metricKind, quantityKind: "absolute", fromProfileKey: profileKey, toProfileKey: definition.canonicalProfileKey })
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
  };
}

export function buildTrendContext({ states, config, metricKind, unit, toDisplayDelta }) {
  const definition = METRIC_DEFINITIONS[metricKind];
  const profileKey = resolveAuxiliaryUnitProfileKey(states, config.trend_entity, metricKind, { rateSuffix: true });
  const rawValue = profileKey ? readNumericState(states, config.trend_entity) : null;

  let canonicalValue = null;
  let value = null;
  if (rawValue !== null) {
    canonicalValue = convertMetricValue(rawValue, {
      metricKind,
      quantityKind: "rate",
      fromProfileKey: profileKey,
      toProfileKey: definition.canonicalProfileKey,
    });
    value = toDisplayDelta(canonicalValue);
  }
  // Label the converted number with the display unit, never the raw entity unit.
  const displayUnit = config.trend_entity ? `${unit}/h` : null;

  return {
    value,
    unit: displayUnit,
    model: buildTrendModel(metricKind, canonicalValue, value, displayUnit),
  };
}

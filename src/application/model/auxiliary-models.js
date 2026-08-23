// The two optional auxiliary sensors: today's range and the hourly trend.
//
// Both exist only if configured, currently numeric, AND reporting a unit that
// resolves to a registered profile. That last condition is not pedantry: without
// it, a Celsius-configured card would happily display a Fahrenheit "18" as 18 °C.
//
// The quantity kinds matter and are deliberately different:
//
//   range state      a DELTA (today's width) — must never pick up a unit offset
//   range min/max    ABSOLUTE readings
//   trend            a RATE — same conversion factor as a delta
//
// Timestamps are returned raw. Formatting them is a presentation decision.

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

// Single policy-resolution seam: today it returns registry defaults, and a later
// release can layer validated YAML or entity attributes here without touching the
// classifier or any renderer.
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
  // A negative width is physically impossible. Checked on the DISPLAY value, like
  // every other validity check once the projection has happened.
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
  // Two spellings, English first. The German one is what the card was originally built
  // against and stays supported; nothing that already works may stop working. Both are
  // OPTIONAL — a range entity that reports only its minimum and maximum is complete.
  const minTimestamp = hasRange ? readFirstAttribute(attributes, ["minimum_timestamp", "minimum_zeitpunkt"]) : null;
  const maxTimestamp = hasRange ? readFirstAttribute(attributes, ["maximum_timestamp", "maximum_zeitpunkt"]) : null;

  // No attributes are passed to the classifier on purpose. min/max are HISTORICAL
  // readings taken from attributes, not the entity's current state — letting them
  // see range_entity's own live value_color/value_level would make both inherit
  // one current classification instead of their own numeric tier.
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
    // Pure availability, with no config gate baked in: whether an available
    // range_scale view is actually requested is a view-composition decision.
    // hasRange alone is not enough — that only says the entity's own state is
    // valid, not that both attributes are present and the pair is not inverted.
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
  // Always "<display unit>/h" rather than the entity's own raw unit: once the
  // NUMBER has been converted, labelling it with the pre-conversion unit would be
  // a label/number mismatch.
  const displayUnit = config.trend_entity ? `${unit}/h` : null;

  return {
    value,
    unit: displayUnit,
    model: buildTrendModel(metricKind, canonicalValue, value, displayUnit),
  };
}

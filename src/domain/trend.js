// Trend direction: the semantic classification of a RATE of change.
//
// A direction is independent of the display unit, so the deadband policies are
// expressed in each metric's canonical unit (°C/h, percentage points/h, ppm/h,
// µg/m³/h) and a converted value is compared against them. Lower and upper
// limits are kept as separate fields on purpose: that permits a future
// asymmetric YAML or entity-attribute override without changing the classifier
// or any renderer.
//
// This module returns semantic tokens only ("rising"/"stable"/"falling") plus
// the translation key for each. Formatting and translation belong to the
// presentation side.

export const TREND_POLICY_REGISTRY = Object.freeze({
  temperature: Object.freeze({ fallingBelow: -0.1, risingAbove: 0.1 }),
  humidity: Object.freeze({ fallingBelow: -0.5, risingAbove: 0.5 }),
  co2: Object.freeze({ fallingBelow: -25, risingAbove: 25 }),
  pm25: Object.freeze({ fallingBelow: -0.5, risingAbove: 0.5 }),
});

export const TREND_DIRECTION_META = Object.freeze({
  rising: Object.freeze({ translationKey: "trend.direction.rising" }),
  stable: Object.freeze({ translationKey: "trend.direction.stable" }),
  falling: Object.freeze({ translationKey: "trend.direction.falling" }),
});

// Values exactly on either boundary stay "stable" — the deadband is closed.
export function classifyTrendRate(canonicalValue, policy) {
  if (!Number.isFinite(canonicalValue) || !policy) return null;
  // Unit conversion can turn an exact boundary into an adjacent floating-
  // point representation (0.18°F/h -> 0.1°C/h). Absorb only machine-scale
  // noise; a materially outside value must still change direction.
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(canonicalValue), Math.abs(policy.fallingBelow), Math.abs(policy.risingAbove)) * 8;
  if (canonicalValue < policy.fallingBelow - epsilon) return "falling";
  if (canonicalValue > policy.risingAbove + epsilon) return "rising";
  return "stable";
}

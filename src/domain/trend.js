// Trend direction: the semantic classification of a RATE of change.
//
// Direction is independent of the display unit, so the deadband policies are in each
// metric's canonical unit and a converted value is compared against them. Lower and upper
// limits are separate fields on purpose, to allow a future asymmetric override without
// touching the classifier. Returns semantic tokens ("rising"/"stable"/"falling") plus a
// translation key; formatting and translation belong to the presentation side.

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
  // Unit conversion can land an exact boundary one float ULP off (0.18°F/h -> 0.1°C/h).
  // Absorb only machine-scale noise; a materially outside value still changes direction.
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(canonicalValue), Math.abs(policy.fallingBelow), Math.abs(policy.risingAbove)) * 8;
  if (canonicalValue < policy.fallingBelow - epsilon) return "falling";
  if (canonicalValue > policy.risingAbove + epsilon) return "rising";
  return "stable";
}

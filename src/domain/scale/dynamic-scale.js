// Where the rendered axis actually starts and ends.
//
// The axis is never just "the data range": markers sitting exactly on an edge are
// unreadable, and an axis that jumps on every sensor update is worse than one that
// is slightly too wide. So the range is expanded by a buffer and then rounded
// outwards to a step, and — unless the profile opts out — it never shrinks below
// the profile's own reference scale.
//
// Pure numbers only. No units, no formatting, no translated text.

import { ceilToStep, floorToStep } from "../../core/numbers.js";

// How coarsely to round the axis. A fixed step suits Celsius, Kelvin, humidity,
// CO2 and PM2.5, but Fahrenheit spans roughly 1.8x as many units for the same
// physical range: a fixed fine step would produce an absurd number of gridlines
// on a wide range, a fixed coarse one would flatten a narrow range. Profiles that
// need it therefore declare span-dependent steps, and only those.
export function resolveDynamicStep(staticStep, dynamicDisplaySteps, low, high, baseMin, baseMax, anchorScale = true) {
  if (!dynamicDisplaySteps) return staticStep;
  const dataMin = Number.isFinite(low) ? low : baseMin;
  const dataMax = Number.isFinite(high) ? high : baseMax;
  const spanMin = anchorScale ? Math.min(dataMin, baseMin) : dataMin;
  const spanMax = anchorScale ? Math.max(dataMax, baseMax) : dataMax;
  const span = spanMax - spanMin;
  const tier = dynamicDisplaySteps.find((candidate) => span <= candidate.maxSpan);
  return (tier || dynamicDisplaySteps[dynamicDisplaySteps.length - 1]).step;
}

// Expands the anchored reference scale — or, for an unanchored profile, only the
// live data range — to leave headroom around real values. The buffer defaults to
// one full step when the profile does not specify its own headroom.
//
// A one-sided metric never expands its lower bound: there is no "too little CO2"
// in a room, so the axis stays rooted at the reference minimum.
export function dynamicScale(coolestValue, warmestValue, scaleConfig, dynamicDisplaySteps) {
  const { scale, step: staticStep, oneSided, headroom, anchorScale } = scaleConfig;
  const baseMin = scale.min;
  const baseMax = scale.max;
  const numericLow = Number(coolestValue);
  const numericHigh = Number(warmestValue);
  const low = Number.isFinite(numericLow) ? numericLow : baseMin;
  const high = Number.isFinite(numericHigh) ? numericHigh : baseMax;
  const step = resolveDynamicStep(
    staticStep,
    dynamicDisplaySteps,
    oneSided ? baseMin : low,
    high,
    baseMin,
    baseMax,
    anchorScale
  );
  const buffer = headroom ?? step;

  const warmLimit = ceilToStep(high + buffer, step);
  let max = anchorScale ? Math.max(baseMax, warmLimit) : warmLimit;
  max = ceilToStep(max, step);
  if (!Number.isFinite(max)) max = baseMax;

  let min = baseMin;
  if (!oneSided) {
    const coldLimit = floorToStep(low - buffer, step);
    min = anchorScale ? Math.min(baseMin, coldLimit) : coldLimit;
    min = floorToStep(min, step);
    if (!Number.isFinite(min)) min = baseMin;
  }

  // A degenerate axis would divide by zero in every position calculation.
  if (min >= max) max = min + step;
  return { min, max, step };
}

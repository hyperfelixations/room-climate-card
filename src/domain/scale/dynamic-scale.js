// Where the rendered axis starts and ends.
//
// Not just "the data range": markers on an edge are unreadable, and an axis that jumps on
// every update is worse than one slightly too wide. So the range is expanded by a buffer,
// rounded outwards to a step, and — unless the profile opts out — never shrinks below the
// profile's reference scale. Pure numbers only.

import { ceilToStep, floorToStep } from "../../core/numbers.js";

// How coarsely to round the axis. A fixed step suits every metric except Fahrenheit,
// which spans ~1.8x as many units for the same physical range; profiles that need it
// declare span-dependent steps so a wide range does not get an absurd grid.
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

// Expands the anchored reference scale — or, for an unanchored profile, the live data
// range — to leave headroom around real values. The buffer defaults to one step. A
// one-sided metric never expands its lower bound (no "too little CO2"), so the axis
// stays rooted at the reference minimum.
export function dynamicScale(coolestValue, warmestValue, scaleConfig, dynamicDisplaySteps) {
  const { scale, step: staticStep, oneSided, headroom, anchorScale } = scaleConfig;
  // An unanchored profile declares no reference range; then every bound comes from the
  // data. baseMin/baseMax stay null and every reader below is guarded.
  const baseMin = scale ? scale.min : null;
  const baseMax = scale ? scale.max : null;
  // Anchoring and one-sidedness both READ the reference range, so a profile with none can
  // be neither. normalizeScale() refuses both combinations; naming the two conditions
  // keeps the arithmetic below free of null.
  const anchored = anchorScale && scale !== null;
  const rootedAtBase = oneSided && scale !== null;

  const numericLow = Number(coolestValue);
  const numericHigh = Number(warmestValue);
  // Defensive: every call site feeds finite values (see buildScaleAxis()). With no
  // reference range there is nothing to fall back to, so an unusable reading lands on
  // zero and the degenerate-axis guard at the end makes that a one-step axis.
  const low = Number.isFinite(numericLow) ? numericLow : baseMin ?? 0;
  const high = Number.isFinite(numericHigh) ? numericHigh : baseMax ?? 0;
  const step = resolveDynamicStep(
    staticStep,
    dynamicDisplaySteps,
    rootedAtBase ? baseMin : low,
    high,
    baseMin,
    baseMax,
    anchored
  );
  const buffer = headroom ?? step;

  const warmLimit = ceilToStep(high + buffer, step);
  let max = anchored ? Math.max(baseMax, warmLimit) : warmLimit;
  max = ceilToStep(max, step);
  if (!Number.isFinite(max)) max = baseMax ?? high;

  let min = rootedAtBase ? baseMin : low;
  if (!oneSided) {
    const coldLimit = floorToStep(low - buffer, step);
    min = anchored ? Math.min(baseMin, coldLimit) : coldLimit;
    min = floorToStep(min, step);
    if (!Number.isFinite(min)) min = baseMin ?? low;
  }

  // A degenerate axis would divide by zero in every position calculation.
  if (min >= max) max = min + step;
  return { min, max, step };
}

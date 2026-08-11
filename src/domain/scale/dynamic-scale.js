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
  // No reference range at all is what an unanchored profile declares (see
  // scale-config.js), and then every bound below comes from the data. Both remaining
  // readers of these two — the anchoring clamps and the non-finite fallbacks — are
  // guarded, so null never reaches the arithmetic.
  const baseMin = scale ? scale.min : null;
  const baseMax = scale ? scale.max : null;
  // Anchoring and one-sidedness both READ the reference range, so a profile that
  // declares none can be neither. normalizeScale() refuses both combinations and no
  // built-in profile creates them; naming the two conditions here is what keeps the
  // arithmetic below free of null without pretending to repair a profile that should
  // never have loaded in the first place.
  const anchored = anchorScale && scale !== null;
  const rootedAtBase = oneSided && scale !== null;

  const numericLow = Number(coolestValue);
  const numericHigh = Number(warmestValue);
  // Both fallbacks are defensive: every call site feeds finite values (see
  // buildScaleAxis()). Without a reference range there is nothing to fall back TO, so an
  // unusable reading on an unanchored profile lands on zero and the degenerate-axis
  // guard at the end turns that into a one-step axis rather than a division by zero.
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

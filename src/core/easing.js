// Auto-slide easing is shared by CSS motion and JavaScript accessibility timing.
//
// A cubic-bezier
// easing's TIME axis and its EASED/spatial-progress axis are different curves,
// so "50% of the time" and "50% of the visual motion" land at different
// moments. The accessible view must follow whichever view is spatially
// dominant, not raw time, so the flip has to happen where the EASED progress
// crosses 50% — which requires inverting the same curve CSS renders with.
//
// Keeping the curve, its CSS spelling and its inversion in one module is what
// makes drifting apart impossible.

export const SLIDE_EASING = Object.freeze({ x1: 0.45, y1: 0, x2: 0.16, y2: 1 });

export function cubicBezierPoint(easing, u) {
  // Standard cubic-bezier evaluation with implicit P0=(0,0)/P3=(1,1) (the
  // two endpoints every CSS cubic-bezier() curve is anchored to).
  const mu = 1 - u;
  return {
    x: 3 * mu * mu * u * easing.x1 + 3 * mu * u * u * easing.x2 + u * u * u,
    y: 3 * mu * mu * u * easing.y1 + 3 * mu * u * u * easing.y2 + u * u * u,
  };
}

export function timeFractionForEasedProgress(easing, targetY) {
  // Inverts a cubic-bezier curve: given the desired EASED/spatial progress
  // (targetY), finds the TIME fraction at which the curve produces it.
  // Bisection on the curve parameter u (Y(u) is monotonic for any valid CSS
  // easing curve) rather than a closed-form cubic solve — general-purpose,
  // numerically robust, and precise enough after 50 iterations that the
  // result is exact to well beyond double precision's useful range.
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (cubicBezierPoint(easing, mid).y < targetY) lo = mid; else hi = mid;
  }
  return cubicBezierPoint(easing, (lo + hi) / 2).x;
}

// The single, shared CSS string — every place that renders the slide easing
// (keyframe animation, manual settle transitions) uses this exact string, so
// they can never drift out of sync with each other or with the flip fraction
// below.
export const SLIDE_EASING_CSS = `cubic-bezier(${SLIDE_EASING.x1},${SLIDE_EASING.y1},${SLIDE_EASING.x2},${SLIDE_EASING.y2})`;

// Where the slide's SPATIAL midpoint (eased progress = 0.5) falls on the TIME
// axis — ~0.35375 for cubic-bezier(.45,0,.16,1). Computed once at module load.
export const A11Y_FLIP_TIME_FRACTION = timeFractionForEasedProgress(SLIDE_EASING, 0.5);

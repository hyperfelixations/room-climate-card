// Auto-slide easing, shared by CSS motion and JS accessibility timing.
//
// A cubic-bezier's TIME axis and its EASED/spatial axis are different curves, so "50% of
// the time" and "50% of the visual motion" are different moments. The accessible view
// must follow the spatially dominant view, so the flip happens where EASED progress
// crosses 50% — which means inverting the same curve CSS renders with. Curve, CSS
// spelling and inversion stay in one module so they cannot drift apart.

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
  // Inverts the curve: given eased/spatial progress (targetY), find the TIME fraction that
  // produces it. Bisection on the parameter u (Y(u) is monotonic for any valid CSS
  // easing) — 50 iterations is exact past double precision.
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (cubicBezierPoint(easing, mid).y < targetY) lo = mid; else hi = mid;
  }
  return cubicBezierPoint(easing, (lo + hi) / 2).x;
}

// The one shared CSS string: keyframe animation and manual settle transitions both use it,
// so they cannot drift from each other or from the flip fraction below.
export const SLIDE_EASING_CSS = `cubic-bezier(${SLIDE_EASING.x1},${SLIDE_EASING.y1},${SLIDE_EASING.x2},${SLIDE_EASING.y2})`;

// Where the slide's SPATIAL midpoint (eased progress = 0.5) falls on the TIME axis —
// ~0.35375 for cubic-bezier(.45,0,.16,1). Computed once at module load.
export const A11Y_FLIP_TIME_FRACTION = timeFractionForEasedProgress(SLIDE_EASING, 0.5);

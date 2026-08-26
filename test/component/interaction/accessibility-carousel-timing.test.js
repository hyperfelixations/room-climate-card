"use strict";

// The visual transition uses cubic-bezier(.45,0,.16,1), under which the
// SPATIAL/eased progress reaches
// 50% at only ~35.375% of the slide's time (at 50% time, spatial progress
// is already ~78.6%). The accessible view must follow whichever view is
// spatially/visually dominant, not the raw clock -- so this file (and the
// production flip calculation it tests) therefore uses the EASED
// midpoint, computed by numerically inverting the same easing curve CSS
// uses (_timeFractionForEasedProgress()/SLIDE_EASING, see room-climate-card.js).
//
// Fixture numbers: holdMs=1000, slideMs=800 -> slideMs * 0.35375 = 283
// exactly (no floating-point rounding in the assertions below), so
// flipOffset = holdMs + 283 = 1283.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Import the owning modules directly so each test names its actual subject.
let carouselTiming, easingMath;

let env;
let el;

test.before(async () => {
  carouselTiming = await import("../../../src/controllers/runtime/carousel-timing.js");
  easingMath = await import("../../../src/core/easing.js");
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card"); // bare element, no setConfig needed for pure-function calls
});
test.after(() => {
  env.cleanupAll();
});

// ---- Bezier inversion ----

test("_timeFractionForEasedProgress: SLIDE_EASING (cubic-bezier(.45,0,.16,1)) inverts to ~0.35375 at Y=0.5", () => {
  const easing = { x1: 0.45, y1: 0, x2: 0.16, y2: 1 };
  const fraction = easingMath.timeFractionForEasedProgress(easing, 0.5);
  assert.ok(Math.abs(fraction - 0.35375) < 1e-9, `expected ~0.35375, got ${fraction}`);
});

test("_timeFractionForEasedProgress: a point-symmetric easing curve inverts to exactly 0.5 at Y=0.5 (proves the inversion is general, not hardcoded to one known number)", () => {
  const symmetricEasing = { x1: 0.5, y1: 0, x2: 0.5, y2: 1 };
  const fraction = easingMath.timeFractionForEasedProgress(symmetricEasing, 0.5);
  assert.ok(Math.abs(fraction - 0.5) < 1e-9, `expected exactly 0.5 for a symmetric curve, got ${fraction}`);
});

// Independent, test-local cross-check of the SAME cubic bezier curve,
// inverted in the OTHER direction (given a TIME fraction t within a slide
// transition, what EASED/spatial progress does the curve produce?) -- this
// is what a browser's own cubic-bezier() timing-function evaluation does.
// Deliberately not calling into the card's Y->X inversion helper, so the
// "samples" test below doesn't just confirm the card agrees with itself.
function easedProgressForTimeFraction(easing, t) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const x = 3 * (1 - mid) * (1 - mid) * mid * easing.x1 + 3 * (1 - mid) * mid * mid * easing.x2 + mid * mid * mid;
    if (x < t) lo = mid; else hi = mid;
  }
  const u = (lo + hi) / 2;
  return 3 * (1 - u) * (1 - u) * u * easing.y1 + 3 * (1 - u) * u * u * easing.y2 + u * u * u;
}

// n=2: positions=[0,1], holdMs=1000, slideMs=800 -> segMs=1800, cycleMs=3600.
// flipOffset = holdMs + slideMs*0.35375 = 1283.
const SLIDE_EASING = { x1: 0.45, y1: 0, x2: 0.16, y2: 1 };
const timing2 = { positions: [0, 1], holdMs: 1000, slideMs: 800, segMs: 1800, cycleMs: 3600 };

// Samples across a slide transition enforce the spatial rule: the outgoing view
// remains accessible before the eased midpoint, then the incoming view takes over.

test("_accessibleViewIndexAt: samples across a full slide transition match the independently-computed spatial/eased progress at every 5% step", () => {
  for (let pct = 0; pct <= 100; pct += 5) {
    const t = pct / 100;
    const phaseMs = timing2.holdMs + t * timing2.slideMs;
    const easedY = easedProgressForTimeFraction(SLIDE_EASING, t);
    const expectedIndex = easedY < 0.5 ? timing2.positions[0] : timing2.positions[1];
    const actualIndex = carouselTiming.accessibleViewIndexAt(phaseMs, timing2);
    assert.equal(actualIndex, expectedIndex, `at ${pct}% (phaseMs=${phaseMs}, eased progress=${easedY.toFixed(4)}): expected position ${expectedIndex}`);
  }
});

test("_accessibleViewIndexAt: stays at positions[0] throughout its hold and the spatially-outgoing part of its transition", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(0, timing2), 0);
  assert.equal(carouselTiming.accessibleViewIndexAt(999, timing2), 0);
  assert.equal(carouselTiming.accessibleViewIndexAt(1000, timing2), 0, "hold just ended, transition just started");
  assert.equal(carouselTiming.accessibleViewIndexAt(1282, timing2), 0, "one ms before the spatial-midpoint flip point");
});

test("_accessibleViewIndexAt: flips to positions[1] exactly at the spatial-midpoint flip point (flipOffset)", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(1283, timing2), 1);
  assert.equal(carouselTiming.accessibleViewIndexAt(1799, timing2), 1, "just before the next hold segment starts");
  assert.equal(carouselTiming.accessibleViewIndexAt(1800, timing2), 1, "positions[1]'s own hold segment start");
  assert.equal(carouselTiming.accessibleViewIndexAt(3082, timing2), 1, "just before positions[1]'s own flip point");
});

test("_accessibleViewIndexAt: wraps back to positions[0] at the cycle's closing flip point", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(3083, timing2), 0, "positions[1]'s flip point (segIndex*segMs + flipOffset)");
  assert.equal(carouselTiming.accessibleViewIndexAt(3599, timing2), 0, "one ms before the cycle wraps to 0");
});

test("_msUntilNextAccessibilityFlip: complements _accessibleViewIndexAt() -- waiting exactly that long always lands on the next flip", () => {
  for (const phaseMs of [0, 500, 999, 1000, 1283, 1500, 1800, 3599]) {
    const currentIndex = carouselTiming.accessibleViewIndexAt(phaseMs, timing2);
    const waitMs = carouselTiming.msUntilNextAccessibilityFlip(phaseMs, timing2);
    assert.ok(waitMs > 0, `waitMs must be positive at phaseMs=${phaseMs}`);
    const nextPhase = (phaseMs + waitMs) % timing2.cycleMs;
    const nextIndex = carouselTiming.accessibleViewIndexAt(nextPhase, timing2);
    assert.notEqual(nextIndex, currentIndex, `phaseMs=${phaseMs} + waitMs=${waitMs} must land on a different view`);
  }
});

// ---- Forward, backward, and wrap segments: a 3-view ping-pong cycle
// (positions=[0,1,2,1]) exercises all
// three segment kinds -- 0->1 and 1->2 are forward, 2->1 is the backward/
// interior segment, 1->0 (closing the cycle) is the wrap segment. ----

const timing3 = { positions: [0, 1, 2, 1], holdMs: 1000, slideMs: 800, segMs: 1800, cycleMs: 7200 };

test("_accessibleViewIndexAt: 3-view ping-pong -- forward segment 0->1", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(0, timing3), 0);
  assert.equal(carouselTiming.accessibleViewIndexAt(1282, timing3), 0, "one ms before the flip");
  assert.equal(carouselTiming.accessibleViewIndexAt(1283, timing3), 1, "flip point");
  assert.equal(carouselTiming.accessibleViewIndexAt(1800, timing3), 1);
});

test("_accessibleViewIndexAt: 3-view ping-pong -- forward segment 1->2", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(3082, timing3), 1, "one ms before the flip (segIndex 1: 1800+1282)");
  assert.equal(carouselTiming.accessibleViewIndexAt(3083, timing3), 2, "flip point (1800+1283)");
  assert.equal(carouselTiming.accessibleViewIndexAt(3600, timing3), 2);
});

test("_accessibleViewIndexAt: 3-view ping-pong -- backward/interior segment 2->1", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(4882, timing3), 2, "one ms before the flip (segIndex 2: 3600+1282)");
  assert.equal(carouselTiming.accessibleViewIndexAt(4883, timing3), 1, "flip point (3600+1283) -- backward, position value decreases");
  assert.equal(carouselTiming.accessibleViewIndexAt(5400, timing3), 1);
});

test("_accessibleViewIndexAt: 3-view ping-pong -- wrap segment back to positions[0]", () => {
  assert.equal(carouselTiming.accessibleViewIndexAt(6682, timing3), 1, "one ms before the flip (segIndex 3: 5400+1282)");
  assert.equal(carouselTiming.accessibleViewIndexAt(6683, timing3), 0, "flip point (5400+1283) -- wraps to the cycle's first position");
  assert.equal(carouselTiming.accessibleViewIndexAt(7199, timing3), 0, "one ms before the cycle itself wraps");
});

// ---- N = 2 to 10 ----

function pingPongPositions(n) {
  // Mirrors _holdSequence()'s formula (room-climate-card.js) independently,
  // matching the existing hand-written timing2/timing3 fixtures above --
  // this test's concern is the FLIP-TIMING logic for varying N, not the
  // position-sequence generation itself (see hold-sequence.test.js for
  // that, tested independently).
  if (n < 2) return [];
  const forward = Array.from({ length: n }, (_, i) => i);
  const backwardInterior = Array.from({ length: Math.max(0, n - 2) }, (_, i) => n - 2 - i);
  return [...forward, ...backwardInterior];
}

test("_msUntilNextAccessibilityFlip/_accessibleViewIndexAt: complements hold for every N from 2 to 10", () => {
  for (let n = 2; n <= 10; n++) {
    const positions = pingPongPositions(n);
    const holdMs = 1000;
    const slideMs = 800;
    const segMs = holdMs + slideMs;
    const cycleMs = positions.length * segMs;
    const timing = { positions, holdMs, slideMs, segMs, cycleMs };
    for (const phaseMs of [0, holdMs - 1, holdMs, holdMs + 283, segMs, cycleMs - 1]) {
      const currentIndex = carouselTiming.accessibleViewIndexAt(phaseMs, timing);
      const waitMs = carouselTiming.msUntilNextAccessibilityFlip(phaseMs, timing);
      assert.ok(waitMs > 0, `N=${n}, phaseMs=${phaseMs}: waitMs must be positive`);
      const nextIndex = carouselTiming.accessibleViewIndexAt((phaseMs + waitMs) % cycleMs, timing);
      assert.notEqual(nextIndex, currentIndex, `N=${n}, phaseMs=${phaseMs}: waiting waitMs must land on a different view`);
    }
  }
});

test("_accessibleViewIndexAt: n=0 (no positions, defensive edge case) always returns 0", () => {
  const emptyTiming = { positions: [], holdMs: 0, slideMs: 0, segMs: 1, cycleMs: 1 };
  assert.equal(carouselTiming.accessibleViewIndexAt(0, emptyTiming), 0);
  assert.equal(carouselTiming.accessibleViewIndexAt(500, emptyTiming), 0);
});

test("_currentVisualViewIndex(): a bare element with no track falls back to this._activeView (no throw)", () => {
  const bare = env.document.createElement("room-climate-card");
  bare._activeView = 0;
  assert.doesNotThrow(() => bare._currentVisualViewIndex());
  assert.equal(bare._currentVisualViewIndex(), 0);
});

// ---- prefers-reduced-motion produces no timer; this
// suite (only covered, more loosely, by a browser test). ----

test("prefers-reduced-motion: a freshly rendered >=2-view card arms no _a11ySyncTimer", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  env.setReducedMotion(true);
  let reduced;
  try {
    reduced = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  } finally {
    env.setReducedMotion(false);
  }
  assert.equal(reduced._carousel.accessibilityTimerHandle, null, "reduced motion must arm no accessibility-sync timer");

  // Control: the identical config WITHOUT reduced motion does arm one --
  // proves the assertion above is actually meaningful, not just vacuously true.
  const normal = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  assert.notEqual(normal._carousel.accessibilityTimerHandle, null, "control: without reduced motion, the same config must arm the timer");

  env.cleanup(reduced);
  env.cleanup(normal);
});

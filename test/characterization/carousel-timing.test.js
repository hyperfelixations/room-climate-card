"use strict";

// Characterization of wall-clock carousel timing, verbatim.
//
// The auto-slide is driven by a CSS keyframe animation whose phase is derived
// from Date.now(), so that several card instances on one dashboard stay in
// lockstep. Everything downstream of that — which view counts as visible for
// aria-hidden/inert, when the accessibility state flips, when a manually
// swiped card may rejoin the shared phase — is pure arithmetic over the same
// timing object.
//
// Off-by-one segments, a lost modulo, or confusion between eased spatial and
// temporal midpoints can silently desynchronize these consumers. The focused
// accessibility tests assert the intended rules; these baselines additionally
// pin the actual numbers, and
// the invariant tests below cross-check the two independent implementations
// of "when does the accessible view change" against each other.
//
// All captures run against the frozen clock from characterization.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { st } = require("../helpers/characterization-scenarios.js");
const { TEMPERATURE_C } = require("../fixtures/attributes.js");

// Direct imports make the owning module of each timing contract explicit.
let carouselTiming, easingMath;

const C = TEMPERATURE_C;

const HASS = {
  language: "en",
  locale: { language: "en" },
  states: {
    "sensor.avg": st("sensor.avg", 22.4, C),
    "sensor.r1": st("sensor.r1", 21.1, C),
    "sensor.r2": st("sensor.r2", 23.6, C),
  },
  callService: () => {},
};

const TIMING_MATRIX = [
  { rotationSeconds: 14, slideSeconds: 1 },
  { rotationSeconds: 7, slideSeconds: 2.5 },
  { rotationSeconds: 1, slideSeconds: 0.1 },
];
const VIEW_COUNTS = [0, 1, 2, 3, 4];

let env;
let console_;
let el;

test.before(async () => {
  carouselTiming = await import("../../src/controllers/runtime/carousel-timing.js");
  easingMath = await import("../../src/core/easing.js");
  env = createFrozenEnvironment();
  console_ = recordConsole(env);
  el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, HASS);
});

test.after(() => {
  console_.restore();
  env.cleanupAll();
});

function configure(viewCount, rotationSeconds, slideSeconds) {
  el._config.rotation_seconds = rotationSeconds;
  el._config.slide_seconds = slideSeconds;
  el._views = Array.from({ length: viewCount }, (_, i) => `view${i}`);
  el._activeView = 0;
}

// Every phase at which _accessibleViewIndexAt() changes its answer, scanned at
// 1 ms resolution over exactly one cycle. Compact and exact: this is the full
// behaviour of the function, not a sample of it.
function flipPoints(timing) {
  const points = [];
  let previous = carouselTiming.accessibleViewIndexAt(0, timing);
  for (let phase = 1; phase < timing.cycleMs; phase++) {
    const current = carouselTiming.accessibleViewIndexAt(phase, timing);
    if (current !== previous) {
      points.push({ phaseMs: phase, from: previous, to: current });
      previous = current;
    }
  }
  return { startsAt: carouselTiming.accessibleViewIndexAt(0, timing), flips: points };
}

test("slide timing, hold sequence, hold windows and track geometry are unchanged", () => {
  const capture = {};
  for (const { rotationSeconds, slideSeconds } of TIMING_MATRIX) {
    for (const viewCount of VIEW_COUNTS) {
      configure(viewCount, rotationSeconds, slideSeconds);
      const timing = el._carousel.timing();
      const key = `views=${viewCount} rotation=${rotationSeconds} slide=${slideSeconds}`;
      capture[key] = {
        timing,
        holdSequence: el._carousel.holdSequence(),
        viewWidthPct: el._viewWidthPct(),
        maxTrackOffsetPct: el._carousel.maxTrackOffsetPct(),
        hasAutoSlide: el._carousel.hasAutoSlide(),
        trackAnimationCss: el._trackAnimationCss(),
        holdWindows: Array.from({ length: viewCount }, (_, view) => carouselTiming.holdWindowsForView(view, timing)),
      };
    }
  }
  expectBaseline("carousel/slide-timing.json", stableStringify(capture));
});

test("the accessibility flip points across a full cycle are unchanged", () => {
  const capture = {};
  for (const { rotationSeconds, slideSeconds } of TIMING_MATRIX) {
    for (const viewCount of [2, 3, 4]) {
      configure(viewCount, rotationSeconds, slideSeconds);
      const timing = el._carousel.timing();
      capture[`views=${viewCount} rotation=${rotationSeconds} slide=${slideSeconds}`] = flipPoints(timing);
    }
  }
  expectBaseline("carousel/accessibility-flips.json", stableStringify(capture));
});

test("_msUntilNextAccessibilityFlip() agrees with _accessibleViewIndexAt() at every sampled phase", () => {
  for (const { rotationSeconds, slideSeconds } of TIMING_MATRIX) {
    for (const viewCount of [2, 3, 4]) {
      configure(viewCount, rotationSeconds, slideSeconds);
      const timing = el._carousel.timing();
      const step = Math.max(1, Math.floor(timing.cycleMs / 400));
      for (let phase = 0; phase < timing.cycleMs; phase += step) {
        const until = carouselTiming.msUntilNextAccessibilityFlip(phase, timing);
        const label = `views=${viewCount} rotation=${rotationSeconds} slide=${slideSeconds} phase=${phase}`;
        assert.ok(until > 0, `${label}: the next flip must always lie strictly in the future`);
        const now = carouselTiming.accessibleViewIndexAt(phase, timing);
        const justBefore = carouselTiming.accessibleViewIndexAt((phase + until - 1) % timing.cycleMs, timing);
        const atFlip = carouselTiming.accessibleViewIndexAt((phase + until) % timing.cycleMs, timing);
        assert.equal(justBefore, now, `${label}: nothing may change before the announced flip`);
        assert.notEqual(atFlip, now, `${label}: the announced flip must actually change the view`);
      }
    }
  }
});

test("the resume window logic is self-consistent: the computed wait always lands inside a stable hold", () => {
  for (const { rotationSeconds, slideSeconds } of TIMING_MATRIX) {
    for (const viewCount of [2, 3, 4]) {
      configure(viewCount, rotationSeconds, slideSeconds);
      const timing = el._carousel.timing();
      const step = Math.max(1, Math.floor(timing.cycleMs / 200));
      for (let view = 0; view < viewCount; view++) {
        for (let offset = 0; offset < timing.cycleMs; offset += step) {
          const timestamp = 1750000000000 + offset;
          const wait = carouselTiming.waitFromTimestampUntilViewHold(view, timestamp, timing);
          const landingPhase = carouselTiming.phaseForTimestamp(timestamp + wait, timing.cycleMs);
          assert.ok(
            carouselTiming.isPhaseInStableViewHold(view, landingPhase, timing),
            `views=${viewCount} view=${view} offset=${offset}: resuming after ${wait}ms must land in a stable hold`
          );
        }
      }
    }
  }
});

test("reduced motion disables auto-slide regardless of view count and timing", () => {
  env.setReducedMotion(true);
  try {
    for (const viewCount of [2, 3, 4]) {
      configure(viewCount, 14, 1);
      assert.equal(el._carousel.hasAutoSlide(), false, `views=${viewCount}`);
    }
  } finally {
    env.setReducedMotion(false);
  }
  configure(3, 14, 1);
  assert.equal(el._carousel.hasAutoSlide(), true, "auto-slide returns once reduced motion is off again");
});

test("the shared easing inversion constant is unchanged", () => {
  const easing = { x1: 0.45, y1: 0, x2: 0.16, y2: 1 };
  expectBaseline(
    "carousel/easing.json",
    stableStringify({
      easing,
      spatialMidpointTimeFraction: easingMath.timeFractionForEasedProgress(easing, 0.5),
      samples: [0.1, 0.25, 0.5, 0.75, 0.9].map((y) => ({ easedProgress: y, timeFraction: easingMath.timeFractionForEasedProgress(easing, y) })),
    })
  );
});

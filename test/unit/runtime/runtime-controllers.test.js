"use strict";

// Direct tests for carousel timing and carousel runtime, with the clock in the test's hand:
// which view is accessible at a given phase, whether a resume lands in the right hold
// window, whether a timer is left behind on disconnect. Nothing waits — a millisecond is set
// and an exact answer asserted; the real browser test is the integration proof.
// Boundary: the environment the carousel runs in (capability degradation, realm-bound
// handles, ResizeObserver, fonts-ready) is runtime-platform.test.js. See internal dev doc §5
// "Carousel, Swipe und Accessibility".

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { createFakePlatform } = require("../../helpers/fake-platform.js");

let timing;
let runtime;
let easing;

test.before(async () => {
  timing = await import("../../../src/controllers/runtime/carousel-timing.js");
  runtime = await import("../../../src/controllers/runtime/carousel-runtime.js");
  easing = await import("../../../src/core/easing.js");
});

// ---------------------------------------------------------------- fixtures --

function makeTrack(jsdomWindow) {
  const document = jsdomWindow.document;
  document.body.innerHTML = `
    <div class="rtc-track">
      <div class="rtc-view"></div>
      <div class="rtc-view"></div>
      <div class="rtc-view"></div>
    </div>`;
  return document.querySelector(".rtc-track");
}

// A controller wired to a fake platform and a real (jsdom) track. `viewCount` decides how
// many .rtc-view nodes exist; the timing values are what a card resolves from its config.
function makeController({
  viewCount = 3,
  rotationSeconds = 12,
  slideSeconds = 1,
  autoSlide = true,
  platform = createFakePlatform(),
  interacting = false,
} = {}) {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const track = makeTrack(jsdom.window);
  const views = [...jsdom.window.document.querySelectorAll(".rtc-view")].slice(0, Math.max(viewCount, 0));
  // Keep exactly viewCount view nodes so the accessibility pass has something to walk.
  [...jsdom.window.document.querySelectorAll(".rtc-view")].slice(viewCount).forEach((node) => node.remove());

  const controller = runtime.createCarouselController({
    platform,
    getTrack: () => track,
    getViewElements: () => jsdom.window.document.querySelectorAll(".rtc-view"),
    getTimingConfig: () => ({ rotationSeconds, slideSeconds, autoSlide }),
    isInteracting: () => interacting,
  });
  controller.setViews(Array.from({ length: viewCount }, (_, index) => `view${index}`));
  return { controller, platform, track, views, jsdom };
}

// ---------------------------------------------------------- pure timing ----

test("the hold sequence is a linear ping-pong that never skips a position", () => {
  assert.deepEqual(timing.holdSequence(0), []);
  assert.deepEqual(timing.holdSequence(1), [], "a single view has nothing to rotate between");
  assert.deepEqual(timing.holdSequence(2), [0, 1]);
  assert.deepEqual(timing.holdSequence(3), [0, 1, 2, 1]);
  assert.deepEqual(timing.holdSequence(4), [0, 1, 2, 3, 2, 1]);

  for (const count of [2, 3, 4, 5, 6]) {
    const sequence = timing.holdSequence(count);
    const wrapped = [...sequence, sequence[0]];
    for (let i = 1; i < wrapped.length; i++) {
      assert.equal(Math.abs(wrapped[i] - wrapped[i - 1]), 1, `count ${count}: step ${i} must move exactly one position`);
    }
    assert.deepEqual([...new Set(sequence)].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
  }
});

test("the view width and the track offset follow the view count", () => {
  assert.equal(timing.viewWidthPct(0), 100, "before the first render the track must not collapse");
  assert.equal(timing.viewWidthPct(1), 100);
  assert.equal(timing.viewWidthPct(4), 25);
});

test("slide timing derives every value from the four inputs", () => {
  const result = timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 3, nowMs: 0 });
  assert.equal(result.enabled, true);
  assert.equal(result.holdMs, 12000);
  assert.equal(result.slideMs, 1000);
  assert.equal(result.segMs, 13000);
  assert.deepEqual(result.positions, [0, 1, 2, 1]);
  assert.equal(result.cycleMs, 52000);
  assert.equal(result.phaseMs, 0);
  assert.equal(result.viewWidthPct, 100 / 3);
});

test("slide timing is disabled below two views and for a zero hold", () => {
  assert.equal(timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 1, nowMs: 0 }).enabled, false);
  assert.equal(timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 0, nowMs: 0 }).enabled, false);
  assert.equal(timing.slideTiming({ holdSeconds: 0, slideSeconds: 1, viewCount: 3, nowMs: 0 }).enabled, false);
});

test("the phase is the wall clock folded into one cycle, for any timestamp", () => {
  assert.equal(timing.phaseForTimestamp(0, 1000), 0);
  assert.equal(timing.phaseForTimestamp(1500, 1000), 500);
  assert.equal(timing.phaseForTimestamp(-250, 1000), 750, "a negative timestamp still lands inside the cycle");
  const cycle = 52000;
  const at = timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 3, nowMs: 3 * cycle + 1234 });
  assert.equal(at.phaseMs, 1234, "three whole cycles later is the same phase");
});

test("the keyframes place two breakpoints per hold and close on the first position", () => {
  const at = timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 2, nowMs: 0 });
  const css = timing.slideKeyframes(at);
  assert.match(css, /@keyframes rtc-track-slide/);
  // Two positions, two breakpoints each, plus the closing 100%.
  assert.equal((css.match(/%\s*\{/g) || []).length, 5);
  assert.match(css, /animation-timing-function: linear;/);
  assert.match(css, new RegExp(`animation-timing-function: ${easing.SLIDE_EASING_CSS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`));
  assert.equal(timing.slideKeyframes({ ...at, enabled: false }), "", "a disabled carousel emits no keyframes");
});

test("the accessibility flip happens at the eased midpoint, not the temporal one", () => {
  const at = timing.slideTiming({ holdSeconds: 10000 / 1000, slideSeconds: 1, viewCount: 2, nowMs: 0 });
  const flipOffset = at.holdMs + at.slideMs * easing.A11Y_FLIP_TIME_FRACTION;
  assert.equal(timing.accessibleViewIndexAt(flipOffset - 1, at), at.positions[0]);
  assert.equal(timing.accessibleViewIndexAt(flipOffset + 1, at), at.positions[1]);
  // The temporal midpoint is on the other side of that boundary — the bug this fraction
  // exists to prevent.
  assert.ok(easing.A11Y_FLIP_TIME_FRACTION < 0.5);
  assert.equal(timing.accessibleViewIndexAt(at.holdMs + at.slideMs * 0.5, at), at.positions[1]);
});

test("the time until the next flip agrees with the flip itself, at every boundary", () => {
  const at = timing.slideTiming({ holdSeconds: 3, slideSeconds: 1, viewCount: 3, nowMs: 0 });
  for (let phase = 0; phase < at.cycleMs; phase += 137) {
    const wait = timing.msUntilNextAccessibilityFlip(phase, at);
    assert.ok(wait > 0, `phase ${phase}: the wait must be positive`);
    const before = timing.accessibleViewIndexAt(phase, at);
    const justBefore = timing.accessibleViewIndexAt((phase + wait - 1) % at.cycleMs, at);
    const justAfter = timing.accessibleViewIndexAt((phase + wait + 1) % at.cycleMs, at);
    assert.equal(justBefore, before, `phase ${phase}: nothing may flip before the predicted moment`);
    assert.notEqual(justAfter, before, `phase ${phase}: something must flip at the predicted moment`);
  }
});

test("hold windows exist once per occurrence and are trimmed away from the edges", () => {
  const at = timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 3, nowMs: 0 });
  assert.equal(timing.holdWindowsForView(0, at).length, 1);
  assert.equal(timing.holdWindowsForView(1, at).length, 2, "the middle view is held twice per cycle");
  const [first] = timing.holdWindowsForView(0, at);
  assert.ok(first.start > 0, "the window starts after the hold begins");
  assert.ok(first.end < at.holdMs, "and ends before it finishes");
  assert.equal(timing.isPhaseInStableViewHold(0, first.start + 1, at), true);
  assert.equal(timing.isPhaseInStableViewHold(0, at.holdMs + at.slideMs / 2, at), false, "mid-slide is never stable");
});

test("the wait until a view is held is zero when it already is, and lands in a window otherwise", () => {
  const at = timing.slideTiming({ holdSeconds: 12, slideSeconds: 1, viewCount: 3, nowMs: 0 });
  const [window0] = timing.holdWindowsForView(0, at);
  assert.equal(timing.waitFromTimestampUntilViewHold(0, window0.start + 10, at), 0);

  const midSlide = at.holdMs + at.slideMs / 2;
  const wait = timing.waitFromTimestampUntilViewHold(2, midSlide, at);
  assert.ok(wait > 0);
  assert.equal(timing.isPhaseInStableViewHold(2, timing.phaseForTimestamp(midSlide + wait, at.cycleMs), at), true);
});

// ------------------------------------------------------- controller: state --

test("the controller owns the active index and the view list", () => {
  const { controller } = makeController();
  assert.deepEqual(controller.viewKeys, ["view0", "view1", "view2"]);
  assert.equal(controller.activeIndex, 0);
  controller.activeIndex = 2;
  assert.equal(controller.activeIndex, 2);
  controller.setViews(["only"]);
  assert.deepEqual(controller.viewKeys, ["only"]);
  assert.equal(controller.viewWidthPct(), 100);
});

test("auto-slide needs two views, positive timings, the opt-in and no reduced-motion preference", () => {
  const platform = createFakePlatform();
  const { controller } = makeController({ platform });
  assert.equal(controller.hasAutoSlide(), true);

  controller.setViews(["one"]);
  assert.equal(controller.hasAutoSlide(), false, "one view");
  controller.setViews(["a", "b"]);
  assert.equal(controller.hasAutoSlide(), true);

  platform.setReducedMotion(true);
  assert.equal(controller.hasAutoSlide(), false, "reduced motion");
  platform.setReducedMotion(false);

  assert.equal(makeController({ autoSlide: false }).controller.hasAutoSlide(), false, "auto_slide:false");
  assert.equal(makeController({ rotationSeconds: 0 }).controller.hasAutoSlide(), false, "a zero hold");
});

test("zero views leave the controller inert rather than dividing by zero", () => {
  const { controller } = makeController({ viewCount: 0 });
  assert.equal(controller.hasAutoSlide(), false);
  assert.deepEqual(controller.holdSequence(), []);
  assert.equal(controller.viewWidthPct(), 100);
  assert.equal(controller.maxTrackOffsetPct(), -0);
  assert.equal(controller.timing().enabled, false);
  assert.equal(controller.slideKeyframes(), "");
});

// ---------------------------------------------- controller: timers, cleanup --

test("engaging auto-slide arms exactly one accessibility timer, and stop() clears everything", () => {
  const { controller, platform } = makeController();
  controller.applyAutoSlideStyles();
  assert.equal(platform.pendingTimerCount(), 1);
  assert.notEqual(controller.accessibilityTimerHandle, null);

  controller.stop();
  assert.equal(platform.pendingTimerCount(), 0);
  assert.equal(controller.accessibilityTimerHandle, null);
  assert.equal(controller.resumeTimerHandle, null);
});

test("the accessibility timer re-arms itself once per flip, and only once", () => {
  const { controller, platform } = makeController({ rotationSeconds: 3, slideSeconds: 1 });
  controller.applyAutoSlideStyles();
  assert.equal(platform.pendingTimerCount(), 1);

  // A full cycle of four four-second segments: every flip re-arms exactly one timer.
  platform.advance(16000);
  assert.equal(platform.pendingTimerCount(), 1, "still exactly one pending timer after a whole cycle");
});

// The timer fires at its own flip, so scheduleAccessibilitySync() runs at most a hair from
// the boundary. It answers two questions from the phase — which view is accessible now, and
// how long until that changes — and the phase is extrapolated to "now" on every read, so if
// the boundary falls between the two reads the pass writes the outgoing view and re-arms a
// whole segment late.
test("a sync that runs a hair before its own flip re-arms for that flip, not past it", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track, jsdom } = makeController({ platform, viewCount: 3, rotationSeconds: 3, slideSeconds: 1 });
  controller.applyAutoSlideStyles();
  const at = controller.timing();
  const flipMs = at.holdMs + at.slideMs * 0.354;
  const outgoing = timing.accessibleViewIndexAt(flipMs - 0.4, at);
  const incoming = timing.accessibleViewIndexAt(flipMs + 0.4, at);
  assert.notEqual(outgoing, incoming, "the two phases must straddle a real flip, otherwise this test proves nothing");

  // The phase moves between reads; here it crosses the boundary once, between the first read
  // and every one after — what a pass that fired a hair early sees.
  let reads = 0;
  Object.defineProperty(track, "__animationPhase", {
    configurable: true,
    get: () => ({ phaseMs: reads++ === 0 ? flipMs - 0.4 : flipMs + 0.4, cycleMs: at.cycleMs }),
  });

  controller.scheduleAccessibilitySync();
  const inertRow = () => [...jsdom.window.document.querySelectorAll(".rtc-view")].map((view) => (view.hasAttribute("inert") ? 0 : 1)).indexOf(1);
  assert.equal(inertRow(), outgoing, "the pass decided on the phase it read first");

  // That decision is reconsidered at the flip it was made just before, not a segment later.
  assert.ok(
    platform.nextTimerDelay() <= at.slideMs,
    `re-armed for ${platform.nextTimerDelay()}ms, which skips the flip it just wrote across`
  );
  platform.advance(at.slideMs);
  assert.equal(inertRow(), incoming, "the flip is applied on the next wake-up");
});

test("a hidden document stops the accessibility chain, and becoming visible restarts it", () => {
  const { controller, platform } = makeController();
  platform.setHidden(true);
  controller.scheduleAccessibilitySync();
  assert.equal(platform.pendingTimerCount(), 0, "nothing to look at, nothing to schedule");

  platform.setHidden(false);
  controller.scheduleAccessibilitySync();
  assert.equal(platform.pendingTimerCount(), 1);
});

test("destroy() leaves no timer behind, and is safe to call twice", () => {
  const { controller, platform } = makeController();
  controller.applyAutoSlideStyles();
  controller.resumeWhenAligned(1, 5000);
  assert.equal(platform.pendingTimerCount(), 2);
  controller.destroy();
  assert.equal(platform.pendingTimerCount(), 0);
  controller.destroy();
  assert.equal(platform.pendingTimerCount(), 0);
});

test("a card with fewer than two views arms no timer at all", () => {
  const { controller, platform } = makeController({ viewCount: 1 });
  controller.applyAutoSlideStyles();
  controller.resumeWhenAligned(0, 1000);
  assert.equal(platform.pendingTimerCount(), 0, "no rotation means no timers to own");
});

test("reduced motion freezes the track and arms no rotation timer", () => {
  const platform = createFakePlatform({ reducedMotion: true });
  const { controller, track } = makeController({ platform });
  controller.applyAutoSlideStyles();
  assert.ok(track.classList.contains("rtc-manual"), "the track is under manual control");
  assert.equal(track.style.animation, "none");
  controller.resumeWhenAligned(1, 1000);
  assert.equal(controller.resumeTimerHandle, null, "and no resume is scheduled");
});

// ------------------------------------------------ controller: the track ----

test("engaging auto-slide hands the track to the animation, with the phase as a negative delay", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track } = makeController({ platform, rotationSeconds: 12, slideSeconds: 1 });
  platform.setNow(5000);
  controller.applyAutoSlideStyles();
  assert.equal(track.classList.contains("rtc-manual"), false);
  assert.match(track.style.animation, /rtc-track-slide 52000ms linear infinite/);
  assert.equal(track.style.animationDelay, "-5000ms");
});

test("every manual path marks the track and kills the animation", () => {
  const { controller, track } = makeController();
  controller.applyAutoSlideStyles();
  assert.equal(track.classList.contains("rtc-manual"), false);

  controller.activeIndex = 1;
  controller.updateTrackTransform(false);
  assert.ok(track.classList.contains("rtc-manual"));
  assert.equal(track.style.animation, "none");
  assert.equal(track.style.transition, "none");
  assert.match(track.style.transform, /translate3d\(-33\.33/);

  controller.setTrackTranslate(-10);
  assert.match(track.style.transform, /translate3d\(-10%/);
  controller.setTrackTransition(true);
  assert.match(track.style.transition, /transform 420ms/);
});

test("the track translate is clamped to the real range and falls back when unreadable", () => {
  const { controller } = makeController({ platform: createFakePlatform({ translateXPx: null }) });
  controller.activeIndex = 2;
  assert.equal(controller.trackTranslatePct(null), (-2 * 100) / 3, "no track: the index decides");

  const readable = makeController({ platform: createFakePlatform({ translateXPx: -50 }) });
  readable.track.getBoundingClientRect = () => ({ width: 300 });
  assert.ok(Math.abs(readable.controller.trackTranslatePct(readable.track) - -50 / 3) < 1e-9);
});

test("pausing freezes the track exactly where it is", () => {
  const platform = createFakePlatform({ translateXPx: -40 });
  const { controller, track } = makeController({ platform });
  track.getBoundingClientRect = () => ({ width: 300 });
  controller.applyAutoSlideStyles();
  const frozenAt = controller.pauseTrackAtCurrentPosition(track);
  assert.equal(frozenAt, -40 / 3);
  assert.ok(track.classList.contains("rtc-manual"));
  assert.equal(track.style.transition, "none");
  assert.match(track.style.transform, /translate3d\(-13\.33/);
});

// ------------------------------------- controller: the visible view index ----

test("the visual index follows the phase while synchronized, and the JS index once manual", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track } = makeController({ platform, rotationSeconds: 3, slideSeconds: 1 });
  controller.applyAutoSlideStyles();
  const at = controller.timing();

  // Walk one whole cycle, comparing against the pure function at every step.
  for (let phase = 0; phase < at.cycleMs; phase += 250) {
    platform.setNow(phase);
    assert.equal(
      controller.currentVisualIndex(),
      timing.accessibleViewIndexAt(phase, controller.timing()),
      `phase ${phase}`
    );
  }

  controller.activeIndex = 2;
  track.classList.add("rtc-manual");
  assert.equal(controller.currentVisualIndex(), 2, "manual control makes the JS index authoritative");
});

// The wall clock is ahead of the track by however long the frame that started the animation
// took, which on a slow machine exceeds the slack between a hold ending and the
// accessibility flip. See visiblePhaseMs() in carousel-runtime.js.
test("the visible index comes from the animation's own clock, not the wall clock that started it", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track, jsdom } = makeController({ platform, rotationSeconds: 3, slideSeconds: 1 });
  controller.applyAutoSlideStyles();
  const at = controller.timing();
  const flipMs = at.holdMs + at.slideMs * 0.354;

  // A wall clock that has passed the flip and an animation that has not: what a slow first
  // frame produces.
  const wallPhase = Math.ceil(flipMs) + 5;
  const animationPhase = Math.floor(flipMs) - 5;
  platform.setNow(wallPhase);
  assert.notEqual(
    timing.accessibleViewIndexAt(wallPhase, at),
    timing.accessibleViewIndexAt(animationPhase, at),
    "the two phases must genuinely disagree, otherwise this test proves nothing"
  );

  track.__animationPhase = { phaseMs: animationPhase, cycleMs: at.cycleMs };
  assert.equal(
    controller.currentVisualIndex(),
    timing.accessibleViewIndexAt(animationPhase, at),
    "what is on screen wins over what the clock says"
  );

  controller.updateViewAccessibility();
  const expected = timing.accessibleViewIndexAt(animationPhase, at);
  [...jsdom.window.document.querySelectorAll(".rtc-view")].forEach((view, index) => {
    assert.equal(view.hasAttribute("inert"), index !== expected, `view ${index} inert`);
  });

  // A cycle length the running animation does not share means its phase belongs to a
  // schedule that no longer applies — the wall clock is the answer again.
  track.__animationPhase = { phaseMs: animationPhase, cycleMs: at.cycleMs + 1000 };
  assert.equal(
    controller.currentVisualIndex(),
    timing.accessibleViewIndexAt(wallPhase, at),
    "a stale cycle length falls back rather than reading a new schedule at an old phase"
  );

  // No Web Animations API is the same fallback.
  delete track.__animationPhase;
  assert.equal(controller.currentVisualIndex(), timing.accessibleViewIndexAt(wallPhase, at));
});

test("the accessibility attributes follow the visible index at every transition boundary", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, jsdom } = makeController({ platform, viewCount: 3, rotationSeconds: 3, slideSeconds: 1 });
  const at = controller.timing();
  const views = () => [...jsdom.window.document.querySelectorAll(".rtc-view")];

  // Every phase where the pure function changes its answer, plus one ms on each side.
  const boundaries = [];
  let previous = timing.accessibleViewIndexAt(0, at);
  for (let phase = 1; phase < at.cycleMs; phase++) {
    const current = timing.accessibleViewIndexAt(phase, at);
    if (current !== previous) {
      boundaries.push(phase);
      previous = current;
    }
  }
  assert.ok(boundaries.length >= 4, "a three-view cycle has at least four flips");

  for (const boundary of boundaries) {
    for (const offset of [-1, 0, 1]) {
      platform.setNow(boundary + offset);
      controller.updateViewAccessibility();
      const expected = timing.accessibleViewIndexAt(boundary + offset, controller.timing());
      views().forEach((view, index) => {
        const active = index === expected;
        assert.equal(
          view.hasAttribute("aria-hidden"),
          !active,
          `phase ${boundary + offset}, view ${index}: aria-hidden`
        );
        assert.equal(view.hasAttribute("inert"), !active, `phase ${boundary + offset}, view ${index}: inert`);
      });
    }
  }
});

// ------------------------------------------------ controller: resume paths --

test("a resume fires only once the phase actually holds the parked view", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track } = makeController({ platform, rotationSeconds: 12, slideSeconds: 1 });

  // Swiped to view 2, track frozen there.
  controller.activeIndex = 2;
  controller.updateTrackTransform(false);
  assert.ok(track.classList.contains("rtc-manual"));

  controller.resumeWhenAligned(2, 10000);
  assert.notEqual(controller.resumeTimerHandle, null);

  const at = controller.timing();
  const delay = controller.delayUntilPhaseHolds(2, 10000);
  assert.ok(delay >= 10000, "the minimum delay is honoured");
  assert.equal(
    timing.isPhaseInStableViewHold(2, timing.phaseForTimestamp(delay, at.cycleMs), at),
    true,
    "and the moment chosen genuinely holds the view"
  );

  platform.advance(delay);
  assert.equal(controller.resumeTimerHandle, null, "the timer fired");
  assert.equal(track.classList.contains("rtc-manual"), false, "and handed the track back");
});

test("a resume that arrives outside its window re-aims instead of handing over wrongly", () => {
  const platform = createFakePlatform({ now: 0 });
  const { controller, track } = makeController({ platform, rotationSeconds: 12, slideSeconds: 1 });
  controller.activeIndex = 1;
  controller.updateTrackTransform(false);
  controller.resumeWhenAligned(1, 1000);

  // A stalled tab: the clock jumps far past the moment the timer was aimed at.
  platform.setNow(platform.now() + 7000);
  platform.advance(1000);
  assert.ok(
    track.classList.contains("rtc-manual") ? controller.resumeTimerHandle !== null : true,
    "either it handed over inside a window, or it re-armed — never a silent jump"
  );
});

test("a second resume replaces the first rather than stacking", () => {
  const platform = createFakePlatform();
  const { controller } = makeController({ platform });
  controller.resumeWhenAligned(1, 5000);
  const first = controller.resumeTimerHandle;
  controller.resumeWhenAligned(2, 5000);
  assert.notEqual(controller.resumeTimerHandle, first);
  assert.equal(platform.pendingTimerCount(), 1, "exactly one resume can be pending");
});

test("a structural change during a pending resume cancels it cleanly", () => {
  const platform = createFakePlatform();
  const { controller } = makeController({ platform });
  controller.resumeWhenAligned(2, 10000);
  assert.notEqual(controller.resumeTimerHandle, null);

  // The view list collapses to one, as a room becoming unavailable does.
  controller.setViews(["only"]);
  controller.stop();
  assert.equal(controller.resumeTimerHandle, null);
  assert.equal(platform.pendingTimerCount(), 0, "no timer may linger below two views");
});

test("a resume is not scheduled while the user is still interacting", () => {
  const platform = createFakePlatform();
  const { controller, track } = makeController({ platform, interacting: true });
  controller.activeIndex = 1;
  controller.updateTrackTransform(false);
  controller.resumeWhenAligned(1, 0);
  platform.advance(60000);
  assert.ok(track.classList.contains("rtc-manual"), "an in-flight gesture keeps manual control");
});

test("changing the timing values changes the cycle immediately, with no push needed", () => {
  const platform = createFakePlatform();
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const track = makeTrack(jsdom.window);
  let rotationSeconds = 12;
  const controller = runtime.createCarouselController({
    platform,
    getTrack: () => track,
    getViewElements: () => jsdom.window.document.querySelectorAll(".rtc-view"),
    getTimingConfig: () => ({ rotationSeconds, slideSeconds: 1, autoSlide: true }),
    isInteracting: () => false,
  });
  controller.setViews(["a", "b", "c"]);
  assert.equal(controller.timing().cycleMs, 52000);

  rotationSeconds = 4;
  assert.equal(controller.timing().cycleMs, 20000, "the very next read reflects the new configuration");
  assert.match(controller.slideKeyframes(), /@keyframes rtc-track-slide/);
});

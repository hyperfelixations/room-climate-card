"use strict";

// A real CSS animation clock complements the jsdom
// unit layer (accessibility-carousel-timing.test.js) verifies
// accessibleViewIndexAt()'s math against hand-built timing objects, but
// only Chromium can confirm the fix against an ACTUAL running
// @keyframes rtc-track-slide animation to reproduce the browser timing
// reported 2->3->1 scenario (visible index cycling via the CSS animation
// while aria-hidden/inert stayed frozen on whichever view was active at
// the last discrete JS transition) and asserts the two now agree
// throughout a live auto-slide cycle, not just at the render moment.
//
// ── THREE CLOCKS ────────────────────────────────────────────────────────
// This file compares quantities that do not share a clock, and sampling
// comparing them naively is flaky. Measured, not
// assumed (full parallel suite, ~270 samples per run):
//
//   the model     reads the running animation's OWN phase, and falls back to
//                 Date.now() only where there is no animation to ask. Until
//                 2.38.1 it read the wall clock unconditionally, which put it
//                 permanently AHEAD of the track by however long the frame that
//                 started the animation took: a constant -23 ms here, and >=97 ms
//                 on the CI runner, where it exceeded the 53 ms of slack between
//                 the end of a hold and the accessibility flip and failed this
//                 file's second claim reproducibly. Measured after the fix, over
//                 60 samples: the model agrees with the animation 60/60 and with
//                 the wall clock 58/60 -- it differs exactly where the two clocks
//                 imply different views. See visiblePhaseMs() in
//                 carousel-runtime.js.
//   the transform getComputedStyle() reports the LAST PRODUCED FRAME.
//                 Read at an arbitrary moment it trails the wall clock by
//                 p50 8 ms / max 17 ms, and much further across a dropped
//                 frame. Read inside requestAnimationFrame it trails by
//                 p50 1 ms / max 2 ms.
//   the attributes aria-hidden/inert can only be written by a MAIN-THREAD
//                 task. While the main thread is blocked no implementation
//                 can update them, whatever the compositor is doing.
//
// So each claim below is sampled where its clock is defined. With a 200 ms
// synthetic main-thread block, comparing attributes with no barrier gave 4
// mismatches per ~60 hold samples, one macrotask turn 7, and three turns,
// rAF+turn and rAF+rAF gave 0 — and in every mismatch the DOM held exactly
// what the card had last written one full segment earlier while
// currentVisualIndex() was correct. The card was never wrong; it had not
// been given a turn.
//
// None of this can hide a real defect: the model claim is checked against
// the compositor's own frame, and a card that froze the state on its
// discrete active-view index (the original A11Y-01 bug) stays wrong for
// whole rotations. Reinstating that bug fails the model claim immediately.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

// One rendered frame at 60 Hz. A sample whose transform is older than that
// is not a coherent reading and is not compared; the sample floors at the
// end of the test are what stop that from quietly emptying the run.
const ONE_FRAME_MS = 17;

// The card under test, in milliseconds. Declared once because the two claims
// below need them for different reasons: the configuration is built from them,
// and Claim 2's sampling window is defined in terms of them.
const HOLD_MS = 1000;
const SLIDE_MS = 150;
const SEG_MS = HOLD_MS + SLIDE_MS;
const TRACK_ANIMATION_NAME = "rtc-track-slide";

// How far inside a hold a sample has to sit before Claim 2 will look at it.
//
// A hold is a span of TIME — [0, HOLD_MS) of each segment — and the accessible
// view for all of it was decided at the previous segment's flip, 96.9ms before
// this hold even began. Sampling 60ms in therefore leaves ~157ms of settling,
// and stopping 60ms early keeps the window clear of the moment the track starts
// moving again. Both ends also absorb the frame-scale skew between the phase and
// the transform, which are read in the same task but produced by different
// clocks.
const HOLD_MARGIN_MS = 60;

function threeViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
}

// One round-trip, two readings of the same card.
//
// `framed` is taken inside a requestAnimationFrame callback, where the
// computed transform and Date.now() refer to the same instant, and carries
// the measured staleness so the caller can reject an incoherent sample.
// `settled` is taken after two further macrotask turns, by which point any
// accessibility task due at or before that frame has been dispatched.
//
// Both readings express positionIndex as the track's translateX in units of
// one view's width (0, 1, 2, ... at a hold; fractional mid-transition).
async function sample(page, cardId) {
  return page.evaluate(async (cardId) => {
    const el = document.getElementById(cardId);
    const track = el.shadowRoot.querySelector(".rtc-track");
    const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));

    const read = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const viewWidthPx = track.getBoundingClientRect().width / views.length;
      // The track's own animation clock. Used ONLY to decide whether a sample
      // falls in a hold; what is true at that moment still comes from the
      // rendered transform below, so the card is never its own witness.
      const animation = track.getAnimations?.().find((candidate) => candidate.animationName === "rtc-track-slide");
      const animationTiming = animation?.effect?.getComputedTiming?.();
      const animationCycleMs = Number(animationTiming?.duration);
      const animationProgress = animationTiming?.progress;
      const readable = typeof animationProgress === "number" && Number.isFinite(animationCycleMs) && animationCycleMs > 0;
      return {
        positionIndex: -matrix.m41 / viewWidthPx,
        modelIndex: el._carousel.currentVisualIndex(),
        animationPhaseMs: readable ? animationProgress * animationCycleMs : null,
        animationCycleMs: readable ? animationCycleMs : null,
        frameStalenessMs: performance.now() - Number(document.timeline.currentTime),
        states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
        // Diagnostics. A mismatch below is only actionable if it also says WHY the
        // card was in the state it was in: whether the track had been handed back to
        // manual control, whether the accessibility timer chain was still armed, and
        // which discrete index the controller was holding.
        manual: el._carousel.isTrackManual(),
        timerArmed: el._carousel.accessibilityTimerHandle !== null,
        activeIndex: el._carousel.activeIndex,
        visibility: document.visibilityState,
      };
    };

    const framed = await new Promise((resolve) => requestAnimationFrame(() => resolve(read())));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { framed, settled: read() };
  }, cardId);
}

// A sample only says something where the track is genuinely PARKED at a view —
// mid-transition the translateX is a continuously interpolated value between two
// integer positions and there is no single correct active index to check against.
//
// The tolerance is essentially zero, and that is the point. During a hold the
// generated keyframes pin the transform to exactly the integer position (the hold's
// start and end frames carry the identical transform, interpolated linearly), so a
// parked track reads as an exact integer up to float noise. Any visible deviation
// means a slide has already begun.
//
// An earlier version allowed 0.05 of a view width, meaning to say "at a hold". It
// does not: the slide easing is very slow at its start, so 5 % of a view width is
// still only ~20 ms into a 150 ms transition. Samples taken there sit a few tens of
// milliseconds from the accessibility flip, and were decided by the offset between the
// card's phase and its CSS animation's own phase. That made the assertion a coin-flip
// in roughly one full suite run in four, on 2.36.2 as released.
//
// 2.36.3 tightened this epsilon, which removed the mid-slide samples but left the
// offset itself in place — so the failure simply moved to the END of a hold, where a
// large enough offset flips the accessible view while the track is still parked. That
// is what CI caught. 2.38.1 removed the offset at its source; this epsilon stays tight
// because the reason for it never depended on the offset.
//
// Tightening rather than loosening is what makes this correct: the model claim is now
// checked only where there IS an unambiguous answer, and it is checked exactly. Holds
// occupy 1000 ms of every 1150 ms segment, so this costs almost no samples.
//
// What the reasoning above still got wrong, and what 2.38.2 was caught by: this is a
// measure of SPACE, and the easing is flat at BOTH ends of a slide, not just the start.
// 0.1 % of a view width from the finish is 97 % of the way through the slide in TIME —
// so this epsilon quietly accepts the last 6.8 ms of every slide as "a hold", a point
// at which the accessibility flip is already 90 ms past due. No epsilon in space can
// express "parked", because the two axes are different curves.
//
// It therefore keeps exactly the job it can do — deciding WHICH integer position a
// parked transform is at, which is what Claim 1 needs — and Claim 2, whose subject is a
// hold, gates on the phase instead. See inSteadyHold().
const HOLD_EPSILON = 1e-3; // 0.1 % of a view width — well under one rendered pixel

function heldIndex({ positionIndex, states }) {
  // `+ 0` normalizes the negative zero that `-matrix.m41` yields at position 0:
  // Math.round(-0) is -0, and Object.is-based matchers do not treat that as 0.
  const nearest = Math.round(positionIndex) + 0;
  if (Math.abs(positionIndex - nearest) >= HOLD_EPSILON) return null;
  if (nearest < 0 || nearest >= states.length) return null;
  return nearest;
}

// Whether a sample was taken well inside a hold — measured on the clock a hold is
// actually defined on.
//
// A segment is HOLD_MS parked followed by SLIDE_MS moving, and the cycle is a whole
// number of segments, so the phase modulo one segment IS the position within a segment.
// An unreadable animation (no Web Animations API, or a track handed back to manual
// control) means there is no synchronized hold to speak of, and the sample is not used.
function inSteadyHold({ animationPhaseMs }) {
  if (typeof animationPhaseMs !== "number") return false;
  const subPhaseMs = animationPhaseMs % SEG_MS;
  return subPhaseMs >= HOLD_MARGIN_MS && subPhaseMs <= HOLD_MS - HOLD_MARGIN_MS;
}

test("aria-hidden/inert follow the live CSS auto-slide position throughout a cycle, not just the active view index", async ({ page }) => {
  await gotoHarness(page);
  // Fast-ish cycle (holdMs=1000, slideMs=150 for 3 views -> 4 hold-sequence
  // positions [0,1,2,1] -> ~4.6s full cycle; rotation_seconds has a 1s
  // floor) so the test observes multiple full transitions in a short
  // wall-clock window.
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      rotation_seconds: HOLD_MS / 1000,
      slide_seconds: SLIDE_MS / 1000,
    },
    threeViewStates()
  );
  await page.evaluate((id) => {
    document.getElementById(id).style.width = "400px";
  }, cardId);

  // inSteadyHold() reduces the phase modulo one segment, which is only the position
  // within a segment while the cycle is a whole number of them. Stated here so a
  // changed view count or hold sequence fails loudly instead of silently sampling the
  // wrong part of the cycle.
  const cycleMs = (await sample(page, cardId)).framed.animationCycleMs;
  expect(cycleMs, "the track animation must be readable").not.toBeNull();
  expect(cycleMs % SEG_MS, `cycle ${cycleMs}ms must be a whole number of ${SEG_MS}ms segments`).toBeCloseTo(0, 6);

  let modelSamples = 0;
  let domSamples = 0;
  const deadline = Date.now() + 9000; // ~2 full cycles at ~4.6s each
  while (Date.now() < deadline) {
    const { framed, settled } = await sample(page, cardId);

    // Claim 1 — the card's phase-derived index IS the visually held one.
    // Checked against the compositor's own frame, with no allowance for the
    // card being slow: this is arithmetic, and it is the assertion that
    // breaks if the flip offset, the easing or the hold sequence is wrong.
    const framedIndex = heldIndex(framed);
    if (framedIndex !== null && framed.frameStalenessMs <= ONE_FRAME_MS) {
      modelSamples++;
      expect(framed.modelIndex, `phase-derived index at positionIndex=${framed.positionIndex}`).toBe(framedIndex);
    }

    // Claim 2 — the attributes the card actually wrote agree with it.
    //
    // Two gates, and they answer different questions. inSteadyHold() asks WHEN, on the
    // animation's clock: is this a moment at which a hold is being held, far enough from
    // both flips that a main-thread write has plainly had its turn. heldIndex() then
    // asks WHAT, from the compositor's own transform: which view is parked in front.
    // Only the second decides what is correct — the phase never gets a vote on that.
    const settledIndex = heldIndex(settled);
    if (settledIndex !== null && inSteadyHold(settled)) {
      domSamples++;
      const where =
        `positionIndex=${settled.positionIndex} model=${settled.modelIndex} activeIndex=${settled.activeIndex} ` +
        `subPhase=${(settled.animationPhaseMs % SEG_MS).toFixed(1)}ms ` +
        `manual=${settled.manual} timerArmed=${settled.timerArmed} visibility=${settled.visibility} ` +
        // The whole row, not just the view whose assertion trips first: "all three
        // inert" and "the wrong one active" are different defects with different causes.
        `inert=[${settled.states.map((s) => (s.inert ? 1 : 0)).join(",")}] ` +
        `framedPos=${framed.positionIndex} framedSub=${(framed.animationPhaseMs % SEG_MS).toFixed(1)}ms`;
      settled.states.forEach((s, i) => {
        const shouldBeActive = i === settledIndex;
        expect(s.inert, `view ${i} inert at ${where}`).toBe(!shouldBeActive);
        expect(s.ariaHidden, `view ${i} aria-hidden at ${where}`).toBe(shouldBeActive ? null : "true");
      });
    }

    await page.waitForTimeout(60);
  }
  expect(modelSamples, "must have captured at least a few coherent hold-position model samples").toBeGreaterThan(3);
  expect(domSamples, "must have captured at least a few clean hold-position DOM samples").toBeGreaterThan(3);
});

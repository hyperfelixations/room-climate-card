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
// ── WHY CLAIM 2 NEEDS A PROOF, NOT A MARGIN ─────────────────────────────
// Waiting a fixed number of turns is still an ASSUMPTION that the main thread
// was free during them. Measured on this machine, over six 12-second runs at
// six different cycle start phases, with every aria-hidden/inert write recorded
// by a MutationObserver and compared against the moment its flip fell due:
//
//   one Chromium, free main thread   0–13 ms late, 65 of 65 writes
//   two competing Chromium workers   individual writes past 198 ms
//
// Two genuine failures were caught that way in 96 runs; in both the model was
// CORRECT and the attributes were one segment stale. The card cannot write an
// attribute without a main-thread task, so under starvation the assertion was
// testing the machine. Note what this also disproves: the accuracy did not
// vary with the cycle's start phase, so the wall clock is not involved.
//
// Claim 2 therefore no longer assumes the precondition, it MEASURES it. A
// chained setTimeout(0) heartbeat records, for its most recently completed
// tick, when that tick was armed and when it ran. A sample is compared only if
// a tick was armed AFTER the flip governing this hold fell due and finished
// BEFORE the sample was read. Timers are delivered in due order, so such a tick
// cannot have overtaken an accessibility timer that was already overdue: the
// card demonstrably had its turn, and a mismatch is then a real defect.
//
// The naive version of this — "some heartbeat ran after the flip" — proves
// nothing: a tick armed BEFORE the flip and delayed along with it would be
// delivered FIRST, precisely because its due time is earlier. Only the arming
// time can order the two.
//
// ── AND THE OPPOSITE FAILURE, WHICH THE HEARTBEAT DOES NOT COVER ────────
// A heartbeat proof caught the remaining failure red-handed rather than
// explaining it: the proof was present (a tick armed 72 ms into the hold had
// completed), the model was correct, and the attributes named the PREVIOUS
// hold's view. They were not stale — the TRANSFORM was. `settled` reads the
// attributes as of now but the transform as of the last produced frame, and
// when the renderer produces no frame for a segment or more, "which view is
// parked in front" is answered about the past while the DOM answers about the
// present. Comparing them then fails on a card that is doing everything right.
//
// Measured on an unloaded machine over ~650 samples, the settled reading's
// frame age is p50 1.0 ms, p90 1.7 ms, max 2.6 ms, and not once above one
// frame — so requiring it to be under ONE_FRAME_MS, exactly as Claim 1 already
// does for its own reading, costs nothing and removes the whole failure mode.
//
// None of this can hide a real defect: the model claim is checked against
// the compositor's own frame, and a card that froze the state on its
// discrete active-view index (the original A11Y-01 bug) stays wrong for
// whole rotations. Reinstating that bug fails the model claim immediately,
// and the skipped-sample count plus the sample floors keep the heartbeat gate
// from quietly emptying the run.

const { TEMPERATURE_C } = require("../../fixtures/attributes.js");
const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers");

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
// The track animation's name is spelled inline in the two page functions below rather
// than shared from here: an evaluate() body runs in the page and cannot close over
// anything in this file.

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
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
}

// The main-thread heartbeat behind Claim 2's gate.
//
// A chained setTimeout(0) that keeps only its LAST completed tick, which is all the gate
// can use: ticks are armed in order, so if the most recent one was armed too early, no
// other one qualifies either. O(1) state, and no growing array to perturb what it
// measures.
//
// `generation` ties the proof to the situation it was taken in. It counts changes to a
// signature covering everything that would make an older tick meaningless — the document
// becoming hidden, the track being handed back to manual control, the animation being
// restarted or re-timed, and the accessibility timer chain stopping. A sample whose
// generation differs from its proof's is not compared.
async function startMainThreadHeartbeat(page, cardId) {
  await page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    const track = el.shadowRoot.querySelector(".rtc-track");
    const signature = () => {
      const animation = track.getAnimations?.().find((candidate) => candidate.animationName === "rtc-track-slide");
      const timing = animation?.effect?.getComputedTiming?.();
      return [
        document.visibilityState,
        track.classList.contains("rtc-manual"),
        animation ? String(animation.startTime) : "none",
        timing ? Math.round(Number(timing.duration)) : "none",
        el._carousel.accessibilityTimerHandle !== null,
      ].join("|");
    };

    const state = {
      generation: 0,
      signature: signature(),
      signatureNow: signature,
      armedAt: null,
      ranAt: null,
      pendingArmedAt: performance.now(),
      ticks: 0,
      stopped: false,
    };
    window.__rccHeartbeat = state;

    const tick = () => {
      if (state.stopped) return;
      const ranAt = performance.now();
      const current = signature();
      if (current !== state.signature) {
        state.signature = current;
        state.generation++;
      }
      state.armedAt = state.pendingArmedAt;
      state.ranAt = ranAt;
      state.ticks++;
      state.pendingArmedAt = performance.now();
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);

    // Every aria-hidden/inert write, with the moment it landed. A mismatch is only
    // diagnosable if it can say whether the card wrote the wrong thing or did not write
    // at all — and the difference between those two is what turned the last remaining
    // failure of this file from "flaky" into a located defect. Capped, because the run
    // produces thousands and only the last handful before a mismatch mean anything.
    state.writes = [];
    const root = el.shadowRoot;
    new MutationObserver((records) => {
      const views = Array.from(root.querySelectorAll(".rtc-view"));
      for (const record of records) {
        state.writes.push({
          at: performance.now(),
          attr: record.attributeName,
          index: views.indexOf(record.target),
          row: views.map((view) => (view.hasAttribute("inert") ? 1 : 0)).join(""),
        });
      }
      if (state.writes.length > 40) state.writes.splice(0, state.writes.length - 40);
    }).observe(root, { subtree: true, attributes: true, attributeFilter: ["inert", "aria-hidden"] });
  }, cardId);
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
      // The heartbeat's last completed tick, and the generation this reading itself
      // belongs to. Recomputing the signature here rather than trusting the tick's
      // closes the up-to-one-tick window in which the situation could have changed
      // since the heartbeat last looked.
      const heartbeat = window.__rccHeartbeat;
      const generationNow = heartbeat.signatureNow() === heartbeat.signature ? heartbeat.generation : heartbeat.generation + 1;
      return {
        positionIndex: -matrix.m41 / viewWidthPx,
        modelIndex: el._carousel.currentVisualIndex(),
        animationPhaseMs: readable ? animationProgress * animationCycleMs : null,
        animationCycleMs: readable ? animationCycleMs : null,
        frameStalenessMs: performance.now() - Number(document.timeline.currentTime),
        // Claim 2's precondition, on ONE monotonic clock: readAt, proofArmedAt and
        // proofRanAt are all performance.now() in this window, and the phase they are
        // compared against is read in this same synchronous block.
        readAt: performance.now(),
        proofArmedAt: heartbeat.armedAt,
        proofRanAt: heartbeat.ranAt,
        proofGeneration: heartbeat.generation,
        generationNow,
        states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
        // Diagnostics. A mismatch below is only actionable if it also says WHY the
        // card was in the state it was in: whether the track had been handed back to
        // manual control, whether the accessibility timer chain was still armed, and
        // which discrete index the controller was holding.
        manual: el._carousel.isTrackManual(),
        timerArmed: el._carousel.accessibilityTimerHandle !== null,
        activeIndex: el._carousel.activeIndex,
        visibility: document.visibilityState,
        writes: heartbeat.writes
          .slice(-8)
          .map((write) => `${(performance.now() - write.at).toFixed(0)}ms:${write.attr}@${write.index}=${write.row}`),
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

// Whether the card demonstrably got a main-thread task after the flip that decided this
// hold fell due — the precondition Claim 2 used to assume.
//
// The flip actually falls due ~97 ms BEFORE the hold starts (at
// holdMs + slideMs * A11Y_FLIP_TIME_FRACTION into the previous segment). This uses the
// start of the hold instead, which is the LATEST the flip could possibly have been due,
// so the requirement it places on the heartbeat is strictly the stronger one and needs
// no second copy of the card's easing constants to state.
//
// The phase is read from the last produced frame and is therefore slightly stale, which
// puts the computed hold start slightly late — again in the strict direction. Under real
// starvation that staleness grows, the window shrinks, and the sample is skipped rather
// than compared against a machine that was busy elsewhere.
function hadMainThreadTurnSinceFlip(sample) {
  if (typeof sample.animationPhaseMs !== "number") return false;
  if (sample.proofArmedAt === null) return false;
  if (sample.proofGeneration !== sample.generationNow) return false;
  const holdStartedAt = sample.readAt - (sample.animationPhaseMs % SEG_MS);
  return sample.proofArmedAt > holdStartedAt && sample.proofRanAt <= sample.readAt;
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
  await startMainThreadHeartbeat(page, cardId);

  // inSteadyHold() reduces the phase modulo one segment, which is only the position
  // within a segment while the cycle is a whole number of them. Stated here so a
  // changed view count or hold sequence fails loudly instead of silently sampling the
  // wrong part of the cycle.
  const cycleMs = (await sample(page, cardId)).framed.animationCycleMs;
  expect(cycleMs, "the track animation must be readable").not.toBeNull();
  expect(cycleMs % SEG_MS, `cycle ${cycleMs}ms must be a whole number of ${SEG_MS}ms segments`).toBeCloseTo(0, 6);

  let modelSamples = 0;
  let domSamples = 0;
  let starvedSamples = 0;
  let staleFrameSamples = 0;
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
    // Four gates, and they answer different questions. inSteadyHold() asks WHEN, on the
    // animation's clock: is this a moment at which a hold is being held, clear of both
    // flips. The staleness check asks whether the transform is still a statement about
    // NOW, since the attributes certainly are. hadMainThreadTurnSinceFlip() asks WHETHER
    // the card could have acted on the flip — measured, not assumed. heldIndex() then
    // asks WHAT, from the compositor's own transform: which view is parked in front.
    // Only the last decides what is correct — neither the phase nor the heartbeat gets
    // a vote on that.
    //
    // The two middle gates guard opposite failures, which is why neither replaces the
    // other: an old frame lets the DOM be AHEAD of the transform it is compared with, a
    // starved thread leaves it BEHIND.
    const settledIndex = heldIndex(settled);
    if (settledIndex !== null && inSteadyHold(settled)) {
      if (settled.frameStalenessMs > ONE_FRAME_MS) staleFrameSamples++;
      else if (!hadMainThreadTurnSinceFlip(settled)) starvedSamples++;
      else {
        domSamples++;
        const where =
          `positionIndex=${settled.positionIndex} model=${settled.modelIndex} activeIndex=${settled.activeIndex} ` +
          `subPhase=${(settled.animationPhaseMs % SEG_MS).toFixed(1)}ms ` +
          `manual=${settled.manual} timerArmed=${settled.timerArmed} visibility=${settled.visibility} ` +
          `frameAge=${settled.frameStalenessMs.toFixed(1)}ms ` +
          `turnAfterFlip=${(settled.proofArmedAt - (settled.readAt - (settled.animationPhaseMs % SEG_MS))).toFixed(1)}ms ` +
          // The whole row, not just the view whose assertion trips first: "all three
          // inert" and "the wrong one active" are different defects with different causes.
          `inert=[${settled.states.map((s) => (s.inert ? 1 : 0)).join(",")}] ` +
          `framedPos=${framed.positionIndex} framedSub=${(framed.animationPhaseMs % SEG_MS).toFixed(1)}ms ` +
          `writes=[${settled.writes.join(" | ")}]`;
        settled.states.forEach((s, i) => {
          const shouldBeActive = i === settledIndex;
          expect(s.inert, `view ${i} inert at ${where}`).toBe(!shouldBeActive);
          expect(s.ariaHidden, `view ${i} aria-hidden at ${where}`).toBe(shouldBeActive ? null : "true");
        });
      }
    }

    await page.waitForTimeout(60);
  }
  await page.evaluate(() => {
    window.__rccHeartbeat.stopped = true;
  });

  // The floors are what keep the gates honest: a gate that stopped admitting anything
  // would empty the run instead of failing it. The two skip counts are reported rather
  // than bounded — they are properties of the machine, not of the card — but a run in
  // which they swallowed everything cannot reach the DOM floor. On an unloaded machine
  // both are typically 0 out of ~110 samples.
  expect(modelSamples, "must have captured at least a few coherent hold-position model samples").toBeGreaterThan(3);
  expect(
    domSamples,
    `must have captured at least a few clean hold-position DOM samples ` +
      `(${staleFrameSamples} skipped for a stale frame, ${starvedSamples} for a starved main thread)`
  ).toBeGreaterThan(3);
});

"use strict";

// Confirms, against a real running @keyframes rtc-track-slide animation, that aria-hidden/
// inert follow the live auto-slide position throughout a cycle, not just at the discrete
// JS transition — the A11Y-01 defect. The jsdom unit layer
// (accessibility-carousel-timing.test.js) checks the timing arithmetic; only Chromium has
// the real animation clock. Mechanism and the two-clocks rationale: interne Doku §5
// "Carousel, Swipe und Accessibility"; the flake-was-a-real-defect history is in the RCC
// Changelog.
//
// Three quantities that do not share a clock, so each claim is sampled where its clock is
// defined:
//   - the model     reads the running animation's own phase (visiblePhaseMs())
//   - the transform getComputedStyle() reports the last produced frame
//   - the attributes aria-hidden/inert are only written by a main-thread task
//
// Claim 1 (phase-derived index == visually held index) is checked against the compositor's
// own frame, exactly. Claim 2 (the attributes the card wrote agree with it) gates on four
// preconditions so it never blames the card for a busy machine: a steady-hold window, a
// fresh transform, a proven main-thread turn since the governing flip, and an unambiguous
// parked position. Skipped-sample counts and sample floors keep those gates from quietly
// emptying the run.

const { TEMPERATURE_C } = require("../../fixtures/attributes.js");
const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers");

// One rendered frame at 60 Hz. A sample whose transform is older than this is not compared.
const ONE_FRAME_MS = 17;

// The card under test, in ms. The config is built from these and Claim 2's window is
// defined in terms of them. (The animation name is spelled inline in the page functions
// below — an evaluate() body cannot close over this file.)
const HOLD_MS = 1000;
const SLIDE_MS = 150;
const SEG_MS = HOLD_MS + SLIDE_MS;

// How far inside a hold a Claim 2 sample must sit: 60 ms in leaves settling time, 60 ms
// early keeps clear of the next slide, and both ends absorb the frame-scale phase/transform
// skew.
const HOLD_MARGIN_MS = 60;

function threeViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
}

// The main-thread heartbeat behind Claim 2's gate: a chained setTimeout(0) keeping only its
// last completed tick (ticks arm in order, so an older one cannot qualify if the newest
// does not). `generation` counts changes to a signature covering anything that would make
// an older tick meaningless (document hidden, track handed to manual, animation restarted
// or re-timed, accessibility timer chain stopped); a sample whose generation differs from
// its proof's is not compared.
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

    // Every aria-hidden/inert write with the moment it landed, so a mismatch can say
    // whether the card wrote the wrong thing or did not write at all. Capped to the last 40.
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

// One round-trip, two readings: `framed` inside a requestAnimationFrame callback (transform
// and clock refer to the same instant, and it carries the measured staleness); `settled`
// after two further macrotask turns, by when any due accessibility task has run. Both
// express positionIndex as translateX in units of one view's width.
async function sample(page, cardId) {
  return page.evaluate(async (cardId) => {
    const el = document.getElementById(cardId);
    const track = el.shadowRoot.querySelector(".rtc-track");
    const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));

    const read = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const viewWidthPx = track.getBoundingClientRect().width / views.length;
      // The track's animation clock, used only to decide whether a sample falls in a hold;
      // what is true then still comes from the rendered transform, so the card is never its
      // own witness.
      const animation = track.getAnimations?.().find((candidate) => candidate.animationName === "rtc-track-slide");
      const animationTiming = animation?.effect?.getComputedTiming?.();
      const animationCycleMs = Number(animationTiming?.duration);
      const animationProgress = animationTiming?.progress;
      const readable = typeof animationProgress === "number" && Number.isFinite(animationCycleMs) && animationCycleMs > 0;
      // The heartbeat's last completed tick and this reading's own generation. The
      // signature is recomputed here to close the up-to-one-tick window since the heartbeat
      // last looked.
      const heartbeat = window.__rccHeartbeat;
      const generationNow = heartbeat.signatureNow() === heartbeat.signature ? heartbeat.generation : heartbeat.generation + 1;
      return {
        positionIndex: -matrix.m41 / viewWidthPx,
        modelIndex: el._carousel.currentVisualIndex(),
        animationPhaseMs: readable ? animationProgress * animationCycleMs : null,
        animationCycleMs: readable ? animationCycleMs : null,
        frameStalenessMs: performance.now() - Number(document.timeline.currentTime),
        // Claim 2's precondition, all on one monotonic clock (performance.now() in this
        // synchronous block, alongside the phase it is compared against).
        readAt: performance.now(),
        proofArmedAt: heartbeat.armedAt,
        proofRanAt: heartbeat.ranAt,
        proofGeneration: heartbeat.generation,
        generationNow,
        states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
        // Diagnostics so a mismatch can say why the card was in the state it was in.
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

// heldIndex() only answers where the track is genuinely parked: during a hold the keyframes
// pin the transform to an exact integer position, so anything past float noise means a
// slide has begun. This epsilon is a measure of SPACE and cannot express "parked" in TIME
// (the easing is flat at both ends of a slide), so it does only the job it can — deciding
// which integer a parked transform is at, for Claim 1 — while Claim 2 gates on the phase
// instead (inSteadyHold()).
const HOLD_EPSILON = 1e-3; // 0.1 % of a view width — well under one rendered pixel

function heldIndex({ positionIndex, states }) {
  // `+ 0` normalizes the negative zero that `-matrix.m41` yields at position 0:
  // Math.round(-0) is -0, and Object.is-based matchers do not treat that as 0.
  const nearest = Math.round(positionIndex) + 0;
  if (Math.abs(positionIndex - nearest) >= HOLD_EPSILON) return null;
  if (nearest < 0 || nearest >= states.length) return null;
  return nearest;
}

// Whether a sample sits well inside a hold, on the animation clock. A segment is HOLD_MS
// parked then SLIDE_MS moving and the cycle is a whole number of segments, so phase modulo
// one segment is the position within a segment. An unreadable animation has no synchronized
// hold and the sample is not used.
function inSteadyHold({ animationPhaseMs }) {
  if (typeof animationPhaseMs !== "number") return false;
  const subPhaseMs = animationPhaseMs % SEG_MS;
  return subPhaseMs >= HOLD_MARGIN_MS && subPhaseMs <= HOLD_MS - HOLD_MARGIN_MS;
}

// Whether the card demonstrably got a main-thread task after the governing flip fell due.
// It uses the hold start (the latest the flip could have been due) rather than the real
// ~97 ms-earlier due time, so it needs no copy of the card's easing constants and errs
// strict. A slightly stale phase pushes the computed hold start later — strict again — and
// under real starvation the window shrinks and the sample is skipped.
function hadMainThreadTurnSinceFlip(sample) {
  if (typeof sample.animationPhaseMs !== "number") return false;
  if (sample.proofArmedAt === null) return false;
  if (sample.proofGeneration !== sample.generationNow) return false;
  const holdStartedAt = sample.readAt - (sample.animationPhaseMs % SEG_MS);
  return sample.proofArmedAt > holdStartedAt && sample.proofRanAt <= sample.readAt;
}

test("aria-hidden/inert follow the live CSS auto-slide position throughout a cycle, not just the active view index", async ({ page }) => {
  await gotoHarness(page);
  // Fast-ish cycle (3 views -> hold sequence [0,1,2,1] -> ~4.6s) so the test sees several
  // full transitions in a short window.
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

  // inSteadyHold()'s phase-modulo-segment only works while the cycle is a whole number of
  // segments; asserted here so a changed view count or hold sequence fails loudly.
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

    // Claim 1 — the phase-derived index is the visually held one, checked against the
    // compositor's own frame with no allowance for slowness. Breaks if the flip offset,
    // easing or hold sequence is wrong.
    const framedIndex = heldIndex(framed);
    if (framedIndex !== null && framed.frameStalenessMs <= ONE_FRAME_MS) {
      modelSamples++;
      expect(framed.modelIndex, `phase-derived index at positionIndex=${framed.positionIndex}`).toBe(framedIndex);
    }

    // Claim 2 — the attributes the card wrote agree with it. Four gates: inSteadyHold()
    // (when, on the animation clock), the staleness check (transform still about now),
    // hadMainThreadTurnSinceFlip() (the card could have acted — measured), heldIndex()
    // (which view is parked, from the transform — the only one that decides correctness).
    // The two middle gates guard opposite failures: an old frame puts the DOM ahead, a
    // starved thread leaves it behind.
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
          // The whole row: "all three inert" and "the wrong one active" are different defects.
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

  // Floors keep the gates honest: a gate that admitted nothing would empty the run instead
  // of failing it. The two skip counts are machine properties, reported not bounded, but a
  // run where they swallowed everything cannot reach the DOM floor.
  expect(modelSamples, "must have captured at least a few coherent hold-position model samples").toBeGreaterThan(3);
  expect(
    domSamples,
    `must have captured at least a few clean hold-position DOM samples ` +
      `(${staleFrameSamples} skipped for a stale frame, ${starvedSamples} for a starved main thread)`
  ).toBeGreaterThan(3);
});

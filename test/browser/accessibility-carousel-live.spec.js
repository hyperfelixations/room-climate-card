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
//   the model     reads Date.now(). Its phase tracks the running CSS
//                 animation's own phase (currentTime - delay) to within
//                 -7..+9 ms, p50 -1 ms. There is no drift: the negative
//                 animation-delay synchronization holds.
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
      return {
        positionIndex: -matrix.m41 / viewWidthPx,
        modelIndex: el._carousel.currentVisualIndex(),
        frameStalenessMs: performance.now() - Number(document.timeline.currentTime),
        states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
      };
    };

    const framed = await new Promise((resolve) => requestAnimationFrame(() => resolve(read())));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { framed, settled: read() };
  }, cardId);
}

// A sample only says something where the track is at a clear hold — mid-
// transition the translateX is a continuously interpolated value between
// two integer positions and there is no single correct active index to
// check against.
function heldIndex({ positionIndex, states }) {
  // `+ 0` normalizes the negative zero that `-matrix.m41` yields at position 0:
  // Math.round(-0) is -0, and Object.is-based matchers do not treat that as 0.
  const nearest = Math.round(positionIndex) + 0;
  if (Math.abs(positionIndex - nearest) >= 0.05) return null;
  if (nearest < 0 || nearest >= states.length) return null;
  return nearest;
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
      rotation_seconds: 1,
      slide_seconds: 0.15,
    },
    threeViewStates()
  );
  await page.evaluate((id) => {
    document.getElementById(id).style.width = "400px";
  }, cardId);

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
    const settledIndex = heldIndex(settled);
    if (settledIndex !== null) {
      domSamples++;
      settled.states.forEach((s, i) => {
        const shouldBeActive = i === settledIndex;
        expect(s.inert, `view ${i} inert at positionIndex=${settled.positionIndex}`).toBe(!shouldBeActive);
        expect(s.ariaHidden, `view ${i} aria-hidden at positionIndex=${settled.positionIndex}`).toBe(
          shouldBeActive ? null : "true"
        );
      });
    }

    await page.waitForTimeout(60);
  }
  expect(modelSamples, "must have captured at least a few coherent hold-position model samples").toBeGreaterThan(3);
  expect(domSamples, "must have captured at least a few clean hold-position DOM samples").toBeGreaterThan(3);
});

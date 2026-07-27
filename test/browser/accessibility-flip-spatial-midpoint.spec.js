"use strict";

// AP-08 (Audit 17/27.2): the accessible view (aria-hidden/inert) must match
// the SPATIALLY dominant view throughout a slide transition, not the
// temporal midpoint. cubic-bezier(.45,0,.16,1) (SLIDE_EASING in
// room-climate-card.js) reaches 50% eased/spatial progress at ~35.375% of
// the slide's time, not at 50% time — see accessibility-carousel-timing.test.js
// for the exact bezier-inversion derivation this file's numbers are built on.
//
// This test proves the fix against REAL Chromium rendering rather than the
// card's own math: it freezes Date.now() to exact, hand-picked phase
// points, then reads the REAL computed track transform (via
// getComputedStyle(track).transform, independent of _accessibleViewIndexAt())
// to determine which of the two positions is spatially closer, and checks
// that against the real aria-hidden/inert attributes.
//
// Freezing Date.now() (rather than creating the card live and polling, or
// seeking the CSS Animation object directly) is what removes the
// wall-clock race: _slideTiming() (room-climate-card.js) derives the CSS
// animation's `animation-delay:-${phaseMs}ms` (_trackAnimationCss()) AND
// the accessibility timer's very first _updateViewAccessibility() call
// (fired synchronously inside the same setConfig() via
// _applyAutoSlideStyles() -> _scheduleAccessibilitySync()) from the same
// Date.now() read — freezing it before card creation makes both derive
// from the identical instant, with no dependency on how long the
// page.evaluate() round-trip itself takes.

const { test, expect } = require("@playwright/test");
const { gotoHarness, mkStateObj } = require("../helpers/browser-helpers");

function twoViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
}

async function createCardAtPhase(page, config, statesObj, phaseMs) {
  return page.evaluate(
    ({ config, statesObj, phaseMs }) => {
      const originalNow = Date.now;
      Date.now = () => phaseMs;
      try {
        const hass = {
          language: "en",
          locale: { language: "en" },
          states: statesObj,
          callService: () => {},
        };
        const el = document.createElement("room-climate-card");
        const id = "card-" + Math.random().toString(36).slice(2);
        el.id = id;
        el.style.display = "block";
        el.style.width = "400px";
        document.getElementById("stage").appendChild(el);
        el.hass = hass;
        el.setConfig(config);

        const track = el.shadowRoot.querySelector(".rtc-track");
        const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
        const style = getComputedStyle(track);
        const matrix = new DOMMatrixReadOnly(style.transform);
        const trackWidthPx = track.getBoundingClientRect().width;

        return {
          id,
          observedXPx: matrix.m41,
          trackWidthPx,
          viewCount: views.length,
          states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
        };
      } finally {
        Date.now = originalNow;
      }
    },
    { config, statesObj, phaseMs }
  );
}

test.describe("A11Y-01 spatial midpoint: accessible view follows the real rendered transform, not the temporal midpoint", () => {
  // Matches the fixture in accessibility-carousel-timing.test.js exactly
  // (holdMs=1000, slideMs=800) so the flip point (1000 + 800*0.35375 =
  // 1283ms into the cycle) is directly comparable and exact, not rounded.
  // entity + 2 rooms resolves to exactly the 2 views ["scale", "extremes"]
  // (see dynamic-view-availability.test.js), matching _holdSequence()'s
  // n=2 case (positions=[0,1], no backward-interior segment).
  const config = {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    rotation_seconds: 1,
    slide_seconds: 0.8,
  };

  // Segment 0 (position 0 -> 1) spans phaseMs [1000, 1800). Spatial flip at
  // 1283ms (1000 + 800*0.35375, see A11Y_FLIP_TIME_FRACTION in
  // room-climate-card.js). The old (pre-AP-08) code flipped at the
  // temporal midpoint, 1400ms (1000 + 800/2), instead — the middle sample
  // point (1340ms, i.e. 42.5% into the slide) deliberately sits between
  // the two flip points: the real, spatially-driven transform is already
  // past its midpoint there (42.5% time > 35.375% spatial-flip fraction),
  // so this is exactly the point where the old temporal-midpoint code
  // would have kept the wrong (outgoing) view accessible while the real
  // rendered transform already shows the incoming view dominant — verified
  // below by temporarily reverting the fix and confirming this test fails.
  const samplePoints = [
    { label: "well before the spatial midpoint (12.5% into the slide)", phaseMs: 1100, expectDominant: 0 },
    { label: "past the spatial midpoint, before the old temporal midpoint (42.5% into the slide)", phaseMs: 1340, expectDominant: 1 },
    { label: "well after the spatial midpoint (87.5% into the slide, control)", phaseMs: 1700, expectDominant: 1 },
  ];

  for (const { label, phaseMs, expectDominant } of samplePoints) {
    test(label, async ({ page }) => {
      await gotoHarness(page);
      const result = await createCardAtPhase(page, config, twoViewStates(), phaseMs);

      expect(result.viewCount, "fixture must render exactly 2 views (scale, extremes)").toBe(2);

      // Independently determine spatial dominance from the REAL observed
      // transform: position 0 always sits at x=0%, position 1 at
      // x=-(100/viewCount)% of the track's own width (_viewWidthPct()) —
      // compare the observed pixel offset against the exact midpoint of
      // those two pixel values, not against anything the card's own JS
      // computed.
      const x0Px = 0;
      const x1Px = -(result.trackWidthPx / result.viewCount);
      const midpointPx = (x0Px + x1Px) / 2;
      const observedDominant = Math.abs(result.observedXPx - x1Px) < Math.abs(result.observedXPx - x0Px) ? 1 : 0;
      expect(
        observedDominant,
        `real track transform at phaseMs=${phaseMs} (observedX=${result.observedXPx}px, midpoint=${midpointPx}px, x0=${x0Px}px, x1=${x1Px}px)`
      ).toBe(expectDominant);

      result.states.forEach((s, i) => {
        const shouldBeAccessible = i === expectDominant;
        expect(s.inert, `view ${i} inert at phaseMs=${phaseMs}`).toBe(!shouldBeAccessible);
        expect(s.ariaHidden, `view ${i} aria-hidden at phaseMs=${phaseMs}`).toBe(shouldBeAccessible ? null : "true");
      });
    });
  }
});

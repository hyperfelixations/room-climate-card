"use strict";

// The accessible view (aria-hidden/inert) must match the spatially dominant view through a
// slide, not the temporal midpoint: SLIDE_EASING reaches 50% eased progress at ~35.375% of
// the slide's time. The bezier-inversion derivation is in
// accessibility-carousel-timing.test.js.
//
// This proves the fix against real Chromium rendering: it freezes Date.now() to hand-picked
// phase points, reads the real computed track transform (independent of
// _accessibleViewIndexAt()) to find the spatially closer position, and checks it against
// the real attributes. Freezing before card creation makes the CSS animation-delay and the
// first synchronous _updateViewAccessibility() derive from the same instant, with no
// dependence on the page.evaluate() round-trip.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, mkStateObj } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

function twoViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
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
  // Matches the accessibility-carousel-timing.test.js fixture (holdMs=1000, slideMs=800),
  // so the flip point (1283ms) is exact. entity + 2 rooms resolves to ["scale", "extremes"]
  // — the n=2 hold sequence [0,1].
  const config = {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    rotation_seconds: 1,
    slide_seconds: 0.8,
  };

  // Segment 0 (position 0 -> 1) spans phaseMs [1000, 1800). Spatial flip at 1283ms; a
  // temporal-midpoint flip would be at 1400ms. The middle sample (1340ms, 42.5% into the
  // slide) sits between them: the real transform is already past its spatial midpoint
  // there, so temporal-midpoint code would keep the wrong view accessible.
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

      // Spatial dominance from the real transform: position 0 at x=0%, position 1 at
      // x=-(100/viewCount)% of the track width; compare the observed offset against the
      // midpoint of those two, not against the card's own JS.
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

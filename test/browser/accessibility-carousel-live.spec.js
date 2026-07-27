"use strict";

// A11Y-01 (v2.16.0 audit fix) with a REAL CSS animation clock — the jsdom
// unit layer (accessibility-carousel-timing.test.js) verifies
// _accessibleViewIndexAt()'s math against hand-built timing objects, but
// only Chromium can confirm the fix against an ACTUAL running
// @keyframes rtc-track-slide animation: this reproduces the auditor's
// reported 2->3->1 scenario (visible index cycling via the CSS animation
// while aria-hidden/inert stayed frozen on whichever view was active at
// the last discrete JS transition) and asserts the two now agree
// throughout a live auto-slide cycle, not just at the render moment.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

function threeViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
}

// Reads the track's current translateX as a fraction of one view's width
// (0, 1, 2, ... for view 0, 1, 2, ...), plus each .rtc-view's aria-hidden/
// inert state, in a single page.evaluate() round-trip (avoids the time the
// CSS animation would otherwise advance between separate calls).
async function sample(page, cardId) {
  return page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    const track = el.shadowRoot.querySelector(".rtc-track");
    const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
    const style = getComputedStyle(track);
    const matrix = new DOMMatrixReadOnly(style.transform);
    const trackWidthPx = track.getBoundingClientRect().width;
    const viewWidthPx = trackWidthPx / views.length;
    const positionIndex = -matrix.m41 / viewWidthPx; // 0, 1, 2, ... or a fractional value mid-transition
    return {
      positionIndex,
      states: views.map((v) => ({ ariaHidden: v.getAttribute("aria-hidden"), inert: v.hasAttribute("inert") })),
    };
  }, cardId);
}

test("aria-hidden/inert follow the live CSS auto-slide position throughout a cycle, not just this._activeView", async ({ page }) => {
  await gotoHarness(page);
  // Fast-ish cycle (holdMs=1000, slideMs=150 for 3 views -> 4 hold-sequence
  // positions [0,1,2,1] -> ~4.6s full cycle; rotation_seconds has a 1s
  // floor, see _normalizePositiveSeconds() in room-climate-card.js) so the
  // test can observe multiple full transitions in a short wall-clock window.
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

  let holdSamples = 0;
  const deadline = Date.now() + 9000; // ~2 full cycles at ~4.6s each
  while (Date.now() < deadline) {
    const { positionIndex, states } = await sample(page, cardId);
    const nearestIndex = Math.round(positionIndex);
    const distanceFromHold = Math.abs(positionIndex - nearestIndex);
    // Only assert during a clear hold (not mid-transition, where the
    // translateX is a continuously interpolated value between two
    // integer positions and there's no single "correct" active index to
    // check against) — matches this suite's established practice of not
    // asserting on inherently ambiguous mid-animation frames.
    if (distanceFromHold < 0.05 && nearestIndex >= 0 && nearestIndex < states.length) {
      holdSamples++;
      states.forEach((s, i) => {
        const shouldBeActive = i === nearestIndex;
        expect(s.inert, `view ${i} inert at positionIndex=${positionIndex}`).toBe(!shouldBeActive);
        expect(s.ariaHidden, `view ${i} aria-hidden at positionIndex=${positionIndex}`).toBe(shouldBeActive ? null : "true");
      });
    }
    await page.waitForTimeout(60);
  }
  expect(holdSamples, "must have captured at least a few clean hold-position samples across the polling window").toBeGreaterThan(3);
});

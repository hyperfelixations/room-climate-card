"use strict";

// Regression test for BUG-14 (fixed): the optimal-band label used to detach from
// its band and jump to the bar centre — collapsed to zero width — when the
// axis-maximum edge label grew very wide.
//
// resolveOptimalLabelPosition() (src/render/layout/optimal-label.js) centres the
// label on its band, then clamps it between the min and max edge labels. For a
// reading many orders of magnitude past the scale the axis maximum is a wide
// grouped number ("2,000,000,001 °C"), and on a narrower card no non-overlapping
// slot is left at the label's natural width. The fallback now caps the label to
// the free span between the two edge labels and fills that span, gap-clear of
// both — truncating in place next to the min label — instead of jumping to
// barWidth / 2 with a width cap that evaluated to zero.
//
// The deterministic unit reproduction lives in test/known-issues.test.js; this is
// the end-to-end half, with real Chromium text metrics and the exact sandbox
// configuration BUG-14 was reported from.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");

const GAP_PX = 4; // LABEL_GAP_PX
// Sub-pixel font-rendering variance, matched to label-geometry.spec.js's noOverlap tolerance.
const TOL = 1.5;

// The reported sandbox configuration: a custom temperature profile with a fixed
// [10, 35] reference scale and the 20–24 °C optimal band.
const CLASSIFICATION = {
  source: "custom",
  unit: "°C",
  comparison: ">=",
  bands: { comfort: { min: 18, max: 26 }, optimal: { min: 20, max: 24 } },
  scale: { min: 10, max: 35, step: 1 },
  tiers: [
    { min: 30, score: 3, level: "Hot", zone: "outside" },
    { min: 25, score: 2, level: "Warm", zone: "comfort" },
    { min: 20, score: 0, level: "Optimal", zone: "optimal" },
    { min: 15, score: -2, level: "Cool", zone: "comfort" },
    { default: true, score: -3, level: "Cold", zone: "outside" },
  ],
};

// The narrow end of the supported range, near where the sandbox's side-by-side
// preview frames sit. At this width "200,000,001 °C" and "2,000,000,001 °C" both
// leave no natural slot for the optimal label.
const CARD_WIDTH = 420;

test.describe("main scale: the optimal label fills the free span for a huge reading", () => {
  for (const state of ["200000000", "2000000000"]) {
    test(`${state} °C: optimal label truncates against the min label, not detached at the bar centre`, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.t": mkStateObj("sensor.t", state, {
          device_class: "temperature",
          unit_of_measurement: "°C",
          state_class: "measurement",
        }),
      };
      const cardId = await createCard(page, { entity: "sensor.t", auto_slide: false, classification: CLASSIFICATION }, states, "en");
      const card = page.locator(`#${cardId}`);
      await setCardWidth(page, cardId, CARD_WIDTH);

      const barBox = await card.locator(".rtc-scale-bar").first().boundingBox();
      const minBox = await card.locator(".rtc-scale-label-min").first().boundingBox();
      const centerBox = await card.locator(".rtc-scale-label-center").first().boundingBox();
      const maxBox = await card.locator(".rtc-scale-label-max").first().boundingBox();
      expect(centerBox, "the optimal label must be present and measurable").toBeTruthy();

      // Truncated in place, not collapsed to nothing.
      expect(centerBox.width, "the optimal label collapsed instead of truncating in place").toBeGreaterThan(8);
      // Left edge flush against the min label, one gap clear — this is the "min · gap · optimal" anchor.
      expect(centerBox.x, "left edge overlaps the min label").toBeGreaterThanOrEqual(minBox.x + minBox.width - TOL);
      expect(centerBox.x, "the label drifted away from the min label toward the bar centre").toBeLessThanOrEqual(
        minBox.x + minBox.width + GAP_PX + TOL
      );
      // Right edge one gap clear of the max label — "optimal · gap · max".
      expect(centerBox.x + centerBox.width, "right edge overlaps the max label").toBeLessThanOrEqual(maxBox.x - GAP_PX + TOL);
      // And its centre stays on the band's (left) side of the bar midpoint.
      expect(centerBox.x + centerBox.width / 2, "the label crossed the bar midpoint").toBeLessThan(barBox.x + barBox.width / 2);
    });
  }
});

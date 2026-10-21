"use strict";

// The scale's min and max edge labels with real Chromium text metrics, at axis boundaries too
// wide to sit side by side in full: both scale-shaped views keep the pair apart and inside
// the bar, by the compact form first and a capped ellipsis after it. The width allocation is
// covered in test/unit/render/render-layer-modules.test.js; the BUG-16 regression with
// measured widths is in test/known-issues.test.js.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const GAP_PX = 4; // LABEL_GAP_PX
// Sub-pixel font-rendering variance, matched to label-geometry.spec.js's noOverlap tolerance.
const TOL = 1.5;

const VIEWS = { scale: ".rtc-scale-view", range_scale: ".rtc-range-scale-view" };

async function edgeLabels(page, cardId, viewSelector) {
  const viewEl = page.locator(`#${cardId}`).locator(viewSelector);
  const read = (selector) =>
    viewEl.locator(selector).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return { text: node.textContent, left: box.left, right: box.right, capped: node.style.maxWidth !== "", ellipsized: node.scrollWidth > node.clientWidth };
    });
  const bar = await viewEl.locator(".rtc-scale-bar").evaluate((node) => node.getBoundingClientRect().toJSON());
  return { bar, min: await read(".rtc-scale-label-min"), max: await read(".rtc-scale-label-max") };
}

function expectApartInsideBar({ bar, min, max }) {
  expect(min.left, "the min label leaves the bar").toBeGreaterThanOrEqual(bar.left - TOL);
  expect(max.right, "the max label leaves the bar").toBeLessThanOrEqual(bar.right + TOL);
  expect(min.right + GAP_PX, `"${min.text}" and "${max.text}" touch`).toBeLessThanOrEqual(max.left + TOL);
}

test.describe("edge labels of a reading in the millions or billions", () => {
  // At 320 px both full forms fit; at 250 px the max label takes its compact form. German
  // compact forms keep the number and its scale word together with a no-break space.
  const MAX_LABEL = {
    en: { 1e6: { 250: "1M°C", 320: "1,000,001°C" }, 1e9: { 250: "1B°C", 320: "1,000,000,001°C" } },
    de: { 1e6: { 250: "1\u00a0Mio.°C", 320: "1.000.001°C" }, 1e9: { 250: "1\u00a0Mrd.°C", 320: "1.000.000.001°C" } },
  };
  for (const [language, byReading] of Object.entries(MAX_LABEL)) {
    for (const [reading, byWidth] of Object.entries(byReading)) {
      for (const [width, maxText] of Object.entries(byWidth)) {
        for (const [view, viewSelector] of Object.entries(VIEWS)) {
          test(`${Number(reading)} °C at ${width}px in ${view} (${language})`, async ({ page }) => {
            await gotoHarness(page);
            const value = Number(reading);
            const states = {
              "sensor.avg": mkStateObj("sensor.avg", value, TEMPERATURE_C),
              "sensor.range": mkStateObj("sensor.range", value - 20, { unit_of_measurement: "°C", minimum: 20, maximum: value }),
            };
            const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: view }] }, states, language);
            await setCardWidth(page, cardId, Number(width));
            const labels = await edgeLabels(page, cardId, viewSelector);
            expect(labels.max.text).toBe(maxText);
            expect([labels.min.ellipsized, labels.max.ellipsized], "a full or compact form shows without ellipsis").toEqual([false, false]);
            expectApartInsideBar(labels);
          });
        }
      }
    }
  }
});

test.describe("edge labels whose compact forms still collide", () => {
  // "-123 Mrd.°C" and "123 Mrd.°C" are each wider than half of the 98 px bar: both are capped
  // to it and end in an ellipsis, the one truncation this layout intends.
  const CLASSIFICATION = {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: -10, max: 40 }, optimal: { min: 18, max: 24 } },
    scale: { min: -123e9, max: 123e9, step: 1e9 },
    tiers: [
      { min: 24, score: 1, level: "Warm", zone: "outside" },
      { min: 18, score: 0, level: "Optimal", zone: "optimal" },
      { default: true, score: -1, level: "Cold", zone: "outside" },
    ],
  };
  for (const [view, viewSelector] of Object.entries(VIEWS)) {
    test(`a ±123e9 °C axis at 250px in ${view} (de)`, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", 21, TEMPERATURE_C),
        "sensor.range": mkStateObj("sensor.range", 4, { unit_of_measurement: "°C", minimum: 19, maximum: 23 }),
      };
      const cardId = await createCard(
        page,
        { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, classification: CLASSIFICATION, views: [{ type: view }] },
        states,
        "de"
      );
      await setCardWidth(page, cardId, 250);
      const labels = await edgeLabels(page, cardId, viewSelector);
      expect([labels.min.text, labels.max.text]).toEqual(["-123\u00a0Mrd.°C", "123\u00a0Mrd.°C"]);
      expect([labels.min.capped, labels.max.capped]).toEqual([true, true]);
      expect([labels.min.ellipsized, labels.max.ellipsized]).toEqual([true, true]);
      expectApartInsideBar(labels);
    });
  }
});

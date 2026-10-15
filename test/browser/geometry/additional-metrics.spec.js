"use strict";

// New metric units at compact, regular and wide card widths in three locales.
// Checks rendered number containment, scale labels, warnings and CO precision.
// Uses real font metrics and the normal responsive layout runtime.
// Separate goldens pin fractional bands and grouped mass values at narrow width.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { attributesFor } = require("../../fixtures/attributes.js");
const cases = [["pm1", "µg/m³", 8], ["pm4", "µg/m³", 8], ["pm10", "µg/m³", 24], ["co", "mg/m³", 2.4], ["co", "µg/m³", 2400], ["co", "ppm", 2.1], ["co", "ppb", 2100]];
for (const [kind, unit, value] of cases) {
  for (const width of [320, 400, 520]) {
    for (const language of ["en", "de", "ja"]) {
      test(`${kind} ${unit} ${width}px ${language}`, async ({ page }) => {
        await gotoHarness(page);
        const attributes = attributesFor(kind, unit);
        const states = { "sensor.avg": mkStateObj("sensor.avg", value, attributes), "sensor.r1": mkStateObj("sensor.r1", value * 0.9, attributes), "sensor.r2": mkStateObj("sensor.r2", value * 1.1, attributes) };
        const cardId = await createCard(page, { entity: "sensor.avg", auto_slide: false, room_sort: "invalid", rooms: [{ entity: "sensor.r1", short: "R1" }, { entity: "sensor.r2", short: "R2" }], views: [{ type: "scale" }] }, states, language);
        await setCardWidth(page, cardId, width);
        const card = page.locator(`#${cardId}`);
        await expect(card.locator(".rtc-warning-text")).toBeVisible();
        for (const selector of [".rtc-avg-value", ".rtc-room-value-num", ".rtc-room-value-unit", ".rtc-scale-label-min", ".rtc-scale-label-max"]) {
          const overflow = await card.locator(selector).evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 0.5).map((node) => node.textContent));
          expect(overflow, selector).toEqual([]);
        }
        const root = await card.boundingBox();
        for (const label of await card.locator(".rtc-scale-label-min, .rtc-scale-label-max").all()) {
          const box = await label.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(root.x - 0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(root.x + root.width + 0.5);
        }
      });
    }
  }
}

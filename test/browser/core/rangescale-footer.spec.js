"use strict";

// RangeScale's localized daily footer. Content and data selection are covered in
// test/component/rendering/range-and-spread.test.js via jsdom. This file's job: with real
// text metrics, at a narrow card width, the footer still fits without clipping — and
// renders at all with zero rooms configured.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

test("RangeScale footer renders in a real browser with zero rooms configured, and fits a narrow card without overflowing", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 21, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 5, {
      unit_of_measurement: "°C",
      minimum: 18,
      maximum: 23,
      minimum_zeitpunkt: "2026-07-23T05:00:00+00:00",
      maximum_zeitpunkt: "2026-07-23T15:00:00+00:00",
    }),
  };
  // German ("Tagesspanne ...") is one of the longer footer translations —
  // deliberately chosen here, at a narrow width, to stress-test wrapping.
  const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] }, states, "de");
  await setCardWidth(page, cardId, 300);

  const card = page.locator(`#${cardId}`);
  const footerEl = card.locator(".rtc-range-scale-view .rtc-scale-footer").first();
  await expect(footerEl).toBeVisible();
  const text = await footerEl.textContent();
  expect(text.length).toBeGreaterThan(0);

  const footerBox = await footerEl.boundingBox();
  const containerBox = await card.locator(".rtc-range-scale-view").first().boundingBox();
  expect(footerBox.x, "footer must not overflow past the left edge of its view container").toBeGreaterThanOrEqual(containerBox.x - 1);
  expect(footerBox.x + footerBox.width, "footer must not overflow past the right edge of its view container").toBeLessThanOrEqual(containerBox.x + containerBox.width + 1);
});

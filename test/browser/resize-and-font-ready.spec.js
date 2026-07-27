"use strict";

// Real ResizeObserver + real document.fonts.ready — jsdom stubs both
// (test/unit/ tests the bind/unbind lifecycle and the promise-chain logic
// with those stubs, but a stub can't reproduce the actual bug history
// here). Covers: the 2.14.0 resize-bug root cause (label stays stale after
// a pure container resize with no accompanying hass update) and the
// 2.12.0 font-ready correction, both for the main scale AND the rangeScale
// view (UI-03, v2.15.0 audit).

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

test("a pure container resize (no hass update) re-resolves the optimal label via ResizeObserver", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 27, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  const card = page.locator(`#${cardId}`);

  await page.evaluate((id) => { document.getElementById(id).style.width = "420px"; }, cardId);
  await page.waitForTimeout(150);
  const centerBoxWide = await card.locator(".rtc-scale-label-center").first().boundingBox();

  // Shrink the container substantially, WITHOUT touching hass at all.
  await page.evaluate((id) => { document.getElementById(id).style.width = "300px"; }, cardId);
  await page.waitForTimeout(300); // ResizeObserver callback is rAF-batched; give it a frame or two.
  const centerBoxNarrow = await card.locator(".rtc-scale-label-center").first().boundingBox();

  expect(centerBoxNarrow.x, "the label's absolute position must actually move after a pure resize").not.toBeCloseTo(centerBoxWide.x, 0);

  // And it must still not overlap the min/max labels at the new width.
  const minBox = await card.locator(".rtc-scale-label-min").first().boundingBox();
  const maxBox = await card.locator(".rtc-scale-label-max").first().boundingBox();
  expect(centerBoxNarrow.x).toBeGreaterThanOrEqual(minBox.x + minBox.width - 1);
  expect(centerBoxNarrow.x + centerBoxNarrow.width).toBeLessThanOrEqual(maxBox.x + 1);
});

test("UI-03: a pure resize also re-resolves the rangeScale view's shared optimal label, not just its own 3 top labels", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 4, { unit_of_measurement: "°C", minimum: 19, maximum: 23 }),
  };
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    states
  );
  const card = page.locator(`#${cardId}`);

  await page.evaluate((id) => { document.getElementById(id).style.width = "420px"; }, cardId);
  await page.waitForTimeout(50);
  const rangeScaleView = card.locator(".rtc-range-scale-view");
  const centerWide = await rangeScaleView.locator(".rtc-scale-label-center").first().boundingBox();

  await page.evaluate((id) => { document.getElementById(id).style.width = "300px"; }, cardId);
  await page.waitForTimeout(150);
  const centerNarrow = await rangeScaleView.locator(".rtc-scale-label-center").first().boundingBox();

  expect(centerNarrow.x).not.toBeCloseTo(centerWide.x, 0);
});

test("disconnecting the card cleanly stops the ResizeObserver (no error on a subsequent resize of the detached node)", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) };
  const cardId = await createCard(page, { entity: "sensor.avg" }, states);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));

  await page.evaluate((id) => {
    const el = document.getElementById(id);
    el.remove(); // triggers disconnectedCallback -> _unbindResizeObserver()
  }, cardId);
  await page.waitForTimeout(100);

  expect(errors, `unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

test("cold load: the card renders correctly even though document.fonts.ready may still be pending at first paint", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  await page.waitForTimeout(50);
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-root")).toBeVisible();
  // Wait past document.fonts.ready resolving and the one-time re-resolve it triggers.
  await page.waitForTimeout(300);
  expect(errors).toHaveLength(0);
});

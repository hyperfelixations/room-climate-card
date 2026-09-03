"use strict";

// A double swipe: swipe, then swipe again before the first swipe's phase-aware resume has
// fired, through real Chromium pointer events (jsdom's carousel-ownership.test.js calls the
// handlers directly). It listens for `pageerror`: the defect it exists for threw a
// TypeError inside a pointermove listener, where the card just stops responding and a
// final-index check would not notice.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Timing-sensitive: real mouse.move() sequences whose settling depends on getting a frame
// promptly, so this file requests local retries (see playwright.config.js, retries: 0
// elsewhere). A failure on the retry as well is real.
test.describe.configure({ retries: 2 });


function threeViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
}

// Several intermediate moves with a brief yield each, so the direction threshold and the
// running translate see realistic deltas under parallel-worker CPU load.
async function swipe(page, box, dxPx) {
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dxPx * i) / steps, startY, { steps: 1 });
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(20);
  await page.mouse.up();
}

async function setUpCard(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      auto_slide: true,
    },
    threeViewStates()
  );
  await page.evaluate((id) => {
    document.getElementById(id).style.width = "400px";
  }, cardId);
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  // Freeze on a known index before the first gesture, or the wall-clock auto-slide can tick
  // during the interaction window and make the relative assertion ambiguous.
  await card.evaluate((el) => {
    el._activeView = 0;
    el._updateTrackTransform(false);
  });
  return { card, errors };
}

test("a second swipe while the first swipe's resume is still pending advances one view and raises no page error", async ({ page }) => {
  const { card, errors } = await setUpCard(page);
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  await swipe(page, box, -box.width * 0.3);
  await page.waitForTimeout(500);
  expect(await card.evaluate((el) => el._activeView)).toBe(1);
  // The first swipe must have left a resume pending, or this test never enters its branch.
  expect(await card.evaluate((el) => el._carousel.resumeTimerHandle !== null)).toBe(true);

  await swipe(page, box, -box.width * 0.3);
  await page.waitForTimeout(500);

  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
  expect(await card.evaluate((el) => el._activeView)).toBe(2);
  expect(await card.evaluate((el) => el._isDragging)).toBe(false);
  expect(await card.evaluate((el) => el._interaction.pointer)).toBeNull();
  expect(await card.evaluate((el) => el._carousel.resumeTimerHandle !== null)).toBe(true);
});

test("three swipes in a row keep moving exactly one view each, with no error and no stuck drag", async ({ page }) => {
  const { card, errors } = await setUpCard(page);
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  // 0 -> 1 -> 2, then a rightward swipe back to 1. Each one starts while the previous
  // resume is still pending.
  await swipe(page, box, -box.width * 0.3);
  await page.waitForTimeout(400);
  await swipe(page, box, -box.width * 0.3);
  await page.waitForTimeout(400);
  expect(await card.evaluate((el) => el._activeView)).toBe(2);

  await swipe(page, box, box.width * 0.3);
  await page.waitForTimeout(500);

  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
  expect(await card.evaluate((el) => el._activeView)).toBe(1);
  expect(await card.evaluate((el) => el._isDragging)).toBe(false);
  const track = card.locator(".rtc-track");
  await expect(track).toHaveClass(/rtc-manual/);
});

test("the track keeps following the finger during the second swipe", async ({ page }) => {
  // Not just "no error": the drag must work. A thrown listener would freeze the track where
  // the first swipe settled.
  const { card, errors } = await setUpCard(page);
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  await swipe(page, box, -box.width * 0.3);
  await page.waitForTimeout(500);
  const settled = await card.evaluate((el) => el.shadowRoot.querySelector(".rtc-track").style.transform);

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(startX - i * 15, startY, { steps: 1 });
    await page.waitForTimeout(10);
  }
  const midDrag = await card.evaluate((el) => el.shadowRoot.querySelector(".rtc-track").style.transform);
  expect(midDrag).not.toBe(settled);
  expect(await card.evaluate((el) => el._isDragging)).toBe(true);

  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});

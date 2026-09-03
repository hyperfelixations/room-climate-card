"use strict";

// Real pointer gestures through Chromium's DOM event listeners end to end, where the jsdom
// unit layer (pointer-logic.test.js) calls the handlers directly with a synthetic pointer.
// Covers the >=10px direction threshold, the width*0.18 swipe threshold,
// pointercancel/pointerleave, and an HA update arriving mid-drag.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../../helpers/browser-helpers");
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

async function swipe(page, rotatorBox, dxPx) {
  const startX = rotatorBox.x + rotatorBox.width / 2;
  const startY = rotatorBox.y + rotatorBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate moves, each yielding briefly, so the direction detection and the
  // running translate see realistic deltas under parallel-worker CPU load.
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dxPx * i) / steps, startY, { steps: 1 });
    await page.waitForTimeout(10);
  }
  await page.waitForTimeout(20);
  await page.mouse.up();
}

test("a rightward swipe past the threshold moves to the next view", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    threeViewStates()
  );
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  // Freeze at a known index (0) in manual mode before swiping: reading the live
  // this._activeView instead races the wall-clock auto-slide, which can tick during the
  // ~600ms interaction window.
  await card.evaluate((el) => { el._activeView = 0; el._updateTrackTransform(false); });
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  await swipe(page, box, -box.width * 0.3); // well past the 18% threshold, leftward drag -> next view

  await page.waitForTimeout(500); // settle transition
  const endIndex = await card.evaluate((el) => el._activeView);
  expect(endIndex).toBe(1);
});

test("a leftward swipe past the threshold moves to the previous view", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    threeViewStates()
  );
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  await card.evaluate((el) => { el._activeView = 2; el._updateTrackTransform(false); });
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  await swipe(page, box, box.width * 0.3); // rightward drag -> previous view

  await page.waitForTimeout(500);
  const endIndex = await card.evaluate((el) => el._activeView);
  expect(endIndex).toBe(1);
});

test("a swipe below the threshold snaps back to the nearest view instead of advancing", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, threeViewStates());
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  const startIndex = await card.evaluate((el) => el._activeView);
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();

  await swipe(page, box, -box.width * 0.02); // well under the 18% threshold, with margin against parallel-worker timing jitter

  await page.waitForTimeout(500);
  const endIndex = await card.evaluate((el) => el._activeView);
  expect(endIndex).toBe(startIndex);
});

test("pointercancel settles the track without throwing and clears the drag state", async ({ page }) => {
  // Chromium routes pointermove to the pointerdown target while the mouse button is held,
  // so mouse movement never fires pointerleave/pointercancel on the rotator mid-drag. A
  // real pointercancel is OS-level (touch reinterpreted as a system gesture, stylus lift)
  // and Playwright's mouse API cannot reproduce it, so this dispatches a real
  // PointerEvent("pointercancel") at the DOM level against the registered listener.
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, threeViewStates());
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  await page.waitForTimeout(100);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  const card = page.locator(`#${cardId}`);
  const rotator = card.locator(".rtc-rotator");
  const rotatorBox = await rotator.boundingBox();
  const startX = rotatorBox.x + rotatorBox.width / 2;
  const startY = rotatorBox.y + rotatorBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 40, startY, { steps: 4 }); // start a real horizontal drag, now _isDragging === true
  const draggingBefore = await card.evaluate((el) => el._isDragging);
  expect(draggingBefore).toBe(true);

  await page.evaluate((id) => {
    const el = document.getElementById(id);
    const pointerId = el._interaction.pointer?.id ?? 1;
    el.shadowRoot.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true, composed: true }));
  }, cardId);
  await page.mouse.up();
  await page.waitForTimeout(200);

  expect(errors, `unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);
  const isDragging = await card.evaluate((el) => el._isDragging);
  expect(isDragging).toBe(false);
  const pointer = await card.evaluate((el) => el._interaction.pointer);
  expect(pointer).toBe(null);
});

test("an HA update arriving mid-drag is applied once the drag ends, not silently lost", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, threeViewStates());
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  const rotator = card.locator(".rtc-rotator");
  const box = await rotator.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 30, startY, { steps: 4 }); // now mid-drag (_isDragging true)

  const isDraggingDuring = await card.evaluate((el) => el._isDragging);
  expect(isDraggingDuring).toBe(true);

  // A new hass update arrives while a real drag is in progress.
  const updatedStates = { ...threeViewStates() };
  updatedStates["sensor.avg"] = mkStateObj("sensor.avg", 25.5, TEMPERATURE_C);
  await updateHass(page, cardId, updatedStates);
  const renderPendingDuring = await card.evaluate((el) => el._renderController.isRenderPending);
  expect(renderPendingDuring).toBe(true);

  await page.mouse.move(startX - 5, startY, { steps: 2 }); // release back near start -> below threshold, snaps back
  await page.mouse.up();
  await page.waitForTimeout(500);

  const renderPendingAfter = await card.evaluate((el) => el._renderController.isRenderPending);
  expect(renderPendingAfter).toBe(false);
  const avgText = await card.locator(".rtc-avg-value").first().innerText();
  expect(avgText).toContain("25.5");
});

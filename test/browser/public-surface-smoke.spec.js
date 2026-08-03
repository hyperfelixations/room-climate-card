"use strict";

// The card driven exactly the way Home Assistant drives it, end to end, in one test.
//
// Every other browser spec isolates one mechanism and is free to reach for an internal
// to set it up. This one deliberately does not: it only ever calls `setConfig()`, assigns
// `hass`, moves the mouse, resizes the host and adds or removes the element — the entire
// public surface, and nothing else. No private field is written, and the only internals
// read are the two the assertions cannot be phrased without (which view the model
// believes is visible, and whether a timer is armed).
//
// It ensures a suite of green unit tests
// proves each part still works in isolation, and says nothing about whether the parts
// are still wired to each other. This is that check.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../helpers/browser-helpers");

const C = { device_class: "temperature", unit_of_measurement: "°C" };

function states(average = 22, { room2 = 23, unavailable = false } = {}) {
  if (unavailable) return { "sensor.avg": mkStateObj("sensor.avg", "unavailable", C) };
  return {
    "sensor.avg": mkStateObj("sensor.avg", average, C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, C),
    "sensor.r2": mkStateObj("sensor.r2", room2, C),
  };
}

const CONFIG = {
  entity: "sensor.avg",
  range_entity: "sensor.range",
  rooms: [{ entity: "sensor.r1", name: "Living" }, { entity: "sensor.r2", name: "Bedroom" }],
  auto_slide: true,
  rotation_seconds: 1,
  slide_seconds: 0.15,
};

test("the whole card works through its public surface alone", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await gotoHarness(page);

  // ---- normal rendering ---------------------------------------------------
  const cardId = await createCard(page, CONFIG, states(22));
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-root")).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toContainText("22");
  await expect(card.locator(".rtc-room-chip")).toHaveCount(2);

  // ---- at least two views, and the carousel that moves between them -------
  const views = card.locator(".rtc-view");
  await expect(views).toHaveCount(3); // range, scale, extremes
  await page.evaluate((id) => {
    document.getElementById(id).style.width = "400px";
    window.__card = document.getElementById(id);
  }, cardId);

  // ---- auto-slide: the visible view changes on its own --------------------
  const positionIndex = () =>
    page.evaluate(() => {
      const track = window.__card.shadowRoot.querySelector(".rtc-track");
      const count = window.__card.shadowRoot.querySelectorAll(".rtc-view").length;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      return -matrix.m41 / (track.getBoundingClientRect().width / count);
    });
  const startPosition = await positionIndex();
  await expect.poll(async () => Math.abs((await positionIndex()) - startPosition) > 0.5, {
    message: "the auto-slide must move the track without anyone touching it",
  }).toBe(true);

  // And exactly one view stays reachable while it does.
  expect(
    await page.evaluate(() => {
      const all = Array.from(window.__card.shadowRoot.querySelectorAll(".rtc-view"));
      return all.filter((view) => !view.hasAttribute("inert")).length;
    })
  ).toBe(1);

  // ---- a manual swipe takes over ------------------------------------------
  const box = await card.locator(".rtc-rotator").boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(startX - step * 25, startY, { steps: 1 });
  }

  // ---- an update arriving DURING the swipe --------------------------------
  await updateHass(page, cardId, states(30));
  await expect(card.locator(".rtc-avg-value-num")).toContainText("22"); // deferred on purpose

  // ---- removed mid-gesture, then put back, with no further update ---------
  await page.evaluate(() => window.__card.remove());
  await page.mouse.up(); // the pointerup lands on a detached card
  await page.evaluate(() => document.getElementById("stage").appendChild(window.__card));
  await expect(card.locator(".rtc-avg-value-num"), "the deferred value must be on screen after the reconnect").toContainText("30");

  // The carousel is running again afterwards.
  expect(await page.evaluate(() => window.__card._carousel.accessibilityTimerHandle !== null)).toBe(true);

  // ---- resize and fonts ---------------------------------------------------
  await page.evaluate((id) => {
    document.getElementById(id).style.width = "300px";
  }, cardId);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect.poll(async () => page.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().width), cardId)).toBe(300);
  await expect(card.locator(".rtc-root")).toBeVisible();

  // ---- a tap action reaches Home Assistant --------------------------------
  const actions = await page.evaluate(() => {
    window.__actions = [];
    window.__card.addEventListener("hass-action", (event) => window.__actions.push(event.detail));
    return window.__actions.length;
  });
  expect(actions).toBe(0);
  await card.locator("[data-entity]").first().click();
  await expect.poll(async () => page.evaluate(() => window.__actions.length), {
    message: "a tap on a room chip must dispatch a hass-action",
  }).toBeGreaterThan(0);

  // ---- a hold resolves to the hold action ---------------------------------
  const chip = await card.locator("[data-entity]").first().boundingBox();
  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700); // the configured hold_seconds default is 0.5s
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.__actions.map((detail) => detail.action)),
    "both a tap and a hold must have been dispatched"
  ).toEqual(expect.arrayContaining(["tap", "hold"]));

  // ---- the no-data shell, and back out of it -------------------------------
  await updateHass(page, cardId, states(22, { unavailable: true }));
  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("--");
  await expect(card.locator(".rtc-no-views")).toHaveCount(0);

  await updateHass(page, cardId, states(24));
  await expect(card.locator('.rtc-root[data-state="data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toContainText("24");

  expect(errors, `unexpected page errors: ${errors.join(" | ")}`).toEqual([]);
});

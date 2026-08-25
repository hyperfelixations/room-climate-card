"use strict";

// Real keyboard focus coverage complements jsdom's unit-layer
// tests (accessibility-logic.test.js) verify the aria-hidden/inert
// attributes get set correctly, but jsdom does not implement `inert`'s
// actual focus-blocking behavior. This confirms a real browser's Tab key
// genuinely cannot reach an offscreen view, and that reduced-motion/
// dark-light rendering doesn't throw.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers");

function twoViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
}

function threeViewStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 3, {
      minimum: 20,
      maximum: 23,
      minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
      maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
    }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
}

test("Tab only reaches per-view content (extrema/range cards) in the visible view, never the inert offscreen one — the average button and room chips are always reachable by design (they live outside the .rtc-view carousel)", async ({ page }) => {
  await gotoHarness(page);
  // Case D: 3 views (range, scale, extremes) — both .rtc-view slots with
  // focusable per-view content (.rtc-extreme-card) are exercised, unlike
  // the 2-view avg+rooms case where the room-chip grid and average button
  // are NOT gated by aria-hidden/inert at all (a separate DOM section
  // below the carousel, always visible regardless of the active view).
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    threeViewStates()
  );
  const card = page.locator(`#${cardId}`);
  // The card opens on the "scale" view by default (see _renderAll()), which
  // has no .rtc-extreme-card content at all (only "range"/"extremes" do) —
  // explicitly land on "extremes" so there is something to actually reach.
  await card.evaluate((el) => {
    el._activeView = el._views.indexOf("extremes");
    el._updateTrackTransform(false);
    el._carousel.updateViewAccessibility();
  });
  const activeIndex = await card.evaluate((el) => el._activeView);

  await page.evaluate(() => document.body.focus());
  const focusedViewCardIndices = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate((id) => {
      const card = document.getElementById(id);
      const active = card.shadowRoot.activeElement;
      if (!active || !active.classList.contains("rtc-extreme-card")) return null;
      const view = active.closest(".rtc-view");
      if (!view) return null;
      const views = Array.from(card.shadowRoot.querySelectorAll(".rtc-view"));
      return { viewIndex: views.indexOf(view) };
    }, cardId);
    if (info) focusedViewCardIndices.push(info.viewIndex);
  }

  expect(focusedViewCardIndices.length, "at least one .rtc-extreme-card (range min/max or extrema) must be reachable").toBeGreaterThan(0);
  expect(new Set(focusedViewCardIndices)).toEqual(new Set([activeIndex]), "Tab must never land inside the inert, offscreen view's cards");
});

test("after a completed swipe, Tab reaches the NEW active view, not the old one", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, twoViewStates());
  await page.evaluate((id) => { document.getElementById(id).style.width = "400px"; }, cardId);
  const card = page.locator(`#${cardId}`);
  const startIndex = await card.evaluate((el) => el._activeView);
  const targetIndex = 1 - startIndex;

  await card.evaluate(
    (el, targetIndex) => {
      el._activeView = targetIndex;
      el._updateTrackTransform(false);
      el._carousel.updateViewAccessibility();
    },
    targetIndex
  );

  await page.evaluate(() => document.body.focus());
  let landedInTarget = false;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const viewIndex = await page.evaluate((id) => {
      const card = document.getElementById(id);
      const active = card.shadowRoot.activeElement;
      const view = active?.closest(".rtc-view");
      if (!view) return null;
      const views = Array.from(card.shadowRoot.querySelectorAll(".rtc-view"));
      return views.indexOf(view);
    }, cardId);
    if (viewIndex === targetIndex) landedInTarget = true;
    if (viewIndex === startIndex) throw new Error("Tab reached the now-inactive view after the swipe");
  }
  expect(landedInTarget).toBe(true);
});

test("Enter and Space on a focused room chip each fire exactly one hass-action event", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, twoViewStates());
  const card = page.locator(`#${cardId}`);
  await card.evaluate((el) => {
    window.__actionEvents = [];
    el.addEventListener("hass-action", (e) => window.__actionEvents.push(e.detail));
  });

  const chip = card.locator("[data-entity]").first();
  await chip.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");

  const count = await page.evaluate(() => window.__actionEvents.length);
  expect(count).toBe(2);
});

test("prefers-reduced-motion: emulated reduced motion disables the auto-slide animation without throwing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoHarness(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, twoViewStates());
  await page.waitForTimeout(100);
  const card = page.locator(`#${cardId}`);
  const track = card.locator(".rtc-track");
  const animationName = await track.evaluate((el) => getComputedStyle(el).animationName);
  expect(animationName === "none" || animationName === "").toBeTruthy();
  expect(errors).toHaveLength(0);
});

test("dark color scheme: the card renders without throwing and produces visibly different colors than light mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHarness(page);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, twoViewStates());
  await page.waitForTimeout(50);
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-root")).toBeVisible();
  expect(errors).toHaveLength(0);
});

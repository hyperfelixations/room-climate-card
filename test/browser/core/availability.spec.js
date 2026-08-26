"use strict";

// Availability in a real browser, where the parts jsdom cannot answer live.
//
// The same rules are checked in component/data/availability.test.js against the model. What
// needs a browser is what happens AROUND them: that an unavailable room chip is still a real
// element a user can click, that the no-data shell tears down its carousel timers instead of
// leaving them running, and that recovering from an outage restores the views rather than
// leaving an empty frame behind.
//
// Timers and clickability are the reason this file exists: both are invisible to a model
// test, and both are how an outage used to leave a card quietly broken.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../../helpers/browser-helpers");
const { HUMIDITY, TEMPERATURE_C } = require("../../fixtures/attributes.js");

const TEMP = TEMPERATURE_C;

function room(entity, name, extra = {}) {
  return { entity, name, short: name.slice(0, 2).toUpperCase(), ...extra };
}

test("unavailable room values stay visible, actionable and outside calculations", async ({ page }) => {
  await gotoHarness(page);
  const config = {
    entity: "sensor.primary",
    show_rooms: true,
    rooms: [
      room("sensor.unavailable", "Unavailable", { tap_action: { action: "navigate", navigation_path: "/unavailable" } }),
      room("sensor.usable", "Usable"),
      room("sensor.invalid", "Invalid"),
      room("sensor.missing", "Missing"),
      room("sensor.bad_unit", "Bad unit"),
      room("sensor.foreign", "Foreign"),
    ],
  };
  const states = {
    "sensor.primary": mkStateObj("sensor.primary", 22, TEMP),
    "sensor.unavailable": mkStateObj("sensor.unavailable", "unavailable", TEMP),
    "sensor.usable": mkStateObj("sensor.usable", 21, TEMP),
    "sensor.invalid": mkStateObj("sensor.invalid", "garbage", TEMP),
    "sensor.bad_unit": mkStateObj("sensor.bad_unit", 20, { device_class: "temperature" }),
    "sensor.foreign": mkStateObj("sensor.foreign", 50, HUMIDITY),
  };
  const cardId = await createCard(page, config, states);
  const card = page.locator(`#${cardId}`);

  await expect(card.locator(".rtc-room-chip")).toHaveCount(3);
  expect(await card.locator(".rtc-room-chip").evaluateAll((chips) => chips.map((chip) => chip.dataset.entity))).toEqual([
    "sensor.usable",
    "sensor.unavailable",
    "sensor.invalid",
  ]);
  await expect(card.locator(".rtc-room-short")).toHaveText(["US", "UN", "IN"]);
  await expect(card.locator(".rtc-room-value-num")).toHaveText(["21.0", "--", "--"]);
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(2);

  const action = await page.evaluate((id) => new Promise((resolve) => {
    const el = document.getElementById(id);
    el.addEventListener("hass-action", (event) => resolve(event.detail), { once: true });
    el.shadowRoot.querySelector('[data-entity="sensor.unavailable"]').click();
  }), cardId);
  expect(action.config.entity).toBe("sensor.unavailable");
  expect(action.config.tap_action.navigation_path).toBe("/unavailable");

  await page.evaluate(({ cardId, config }) => {
    document.getElementById(cardId).setConfig({ ...config, unavailable_values: "hide" });
  }, { cardId, config });
  await expect(card.locator(".rtc-room-chip")).toHaveCount(1);
  await expect(card.locator(".rtc-room-short")).toHaveText(["US"]);
});

test("the no-data shell fails and recovers without exposing views or leaving carousel timers", async ({ page }) => {
  await gotoHarness(page);
  const config = {
    entity: "sensor.primary",
    rooms: [room("sensor.kitchen", "Kitchen"), room("sensor.bedroom", "Bedroom")],
    auto_slide: true,
    rotation_seconds: 1,
    slide_seconds: 0.15,
  };
  const unavailable = {
    "sensor.primary": mkStateObj("sensor.primary", "unavailable", TEMP),
    "sensor.kitchen": mkStateObj("sensor.kitchen", "unknown", TEMP),
    "sensor.bedroom": mkStateObj("sensor.bedroom", "garbage", TEMP),
  };
  const cardId = await createCard(page, config, unavailable);
  const card = page.locator(`#${cardId}`);

  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-title")).toHaveText("Temperature");
  await expect(card.locator(".rtc-status-pill")).toHaveText("No data");
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("--");
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(2);
  await expect(card.locator(".rtc-rotator, .rtc-rotator-solo, .rtc-no-views")).toHaveCount(0);
  expect(await page.evaluate((id) => {
    const carousel = document.getElementById(id)._carousel;
    return { auto: carousel.hasAutoSlide(), resume: carousel.resumeTimerHandle, a11y: carousel.accessibilityTimerHandle };
  }, cardId)).toEqual({ auto: false, resume: null, a11y: null });

  await updateHass(page, cardId, {
    "sensor.primary": mkStateObj("sensor.primary", 22, TEMP),
    "sensor.kitchen": mkStateObj("sensor.kitchen", 21, TEMP),
    "sensor.bedroom": mkStateObj("sensor.bedroom", 23, TEMP),
  });
  await expect(card.locator('.rtc-root[data-state="data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toContainText("22");
  await expect(card.locator(".rtc-view")).not.toHaveCount(0);

  await updateHass(page, cardId, unavailable);
  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("--");
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(2);
});

test("a missing primary stays non-clickable and names the configured entity safely", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.missing_primary" }, {});
  const card = page.locator(`#${cardId}`);

  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-title")).toHaveText("Room Climate Card");
  await expect(card.locator(".rtc-subtitle")).toContainText("sensor.missing_primary");
  await expect(card.locator(".rtc-avg-button-disabled")).toHaveCount(1);
  await expect(card.locator(".rtc-avg-button[data-entity]")).toHaveCount(0);
  await expect(card.locator(".rtc-room-chip")).toHaveCount(0);
});

test("a direct single room keeps its label and action while availability changes", async ({ page }) => {
  await gotoHarness(page);
  const config = {
    rooms: [room("sensor.kitchen", "Kitchen", { tap_action: { action: "navigate", navigation_path: "/kitchen" } })],
  };
  const unavailable = { "sensor.kitchen": mkStateObj("sensor.kitchen", "unavailable", TEMP) };
  const cardId = await createCard(page, config, unavailable);
  const card = page.locator(`#${cardId}`);

  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-label")).toHaveText("Kitchen");
  await expect(card.locator(".rtc-avg-button")).toHaveAttribute("data-entity", "sensor.kitchen");
  await expect(card.locator(".rtc-room-grid")).toHaveCount(0);

  await updateHass(page, cardId, { "sensor.kitchen": mkStateObj("sensor.kitchen", 21, TEMP) });
  await expect(card.locator('.rtc-root[data-state="data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-label")).toHaveText("Kitchen");
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("21.0");

  await updateHass(page, cardId, unavailable);
  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-label")).toHaveText("Kitchen");
  const action = await page.evaluate((id) => new Promise((resolve) => {
    const el = document.getElementById(id);
    el.addEventListener("hass-action", (event) => resolve(event.detail), { once: true });
    el.shadowRoot.querySelector(".rtc-avg-button").click();
  }), cardId);
  expect(action.config.entity).toBe("sensor.kitchen");
  expect(action.config.tap_action.navigation_path).toBe("/kitchen");

  await page.evaluate(({ cardId, config }) => {
    document.getElementById(cardId).setConfig({ ...config, show_rooms: true });
  }, { cardId, config });
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(1);
});

test("room consensus survives partial and total outages, restores focus and fits narrow and wide cards", async ({ page }) => {
  await gotoHarness(page);
  const config = { rooms: [room("sensor.alpha", "Alpha"), room("sensor.beta", "Beta")], show_rooms: true };
  const usable = {
    "sensor.alpha": mkStateObj("sensor.alpha", 20, TEMP),
    "sensor.beta": mkStateObj("sensor.beta", 24, TEMP),
  };
  const cardId = await createCard(page, config, usable);
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-avg-button-disabled")).toHaveCount(1);
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("22.0");

  await updateHass(page, cardId, {
    "sensor.alpha": mkStateObj("sensor.alpha", 20, TEMP),
    "sensor.beta": mkStateObj("sensor.beta", "unavailable", TEMP),
  });
  await expect(card.locator('.rtc-root[data-state="data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("20.0");
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(1);

  // sensor.beta now stops EXISTING, which is a different thing from being unavailable:
  // Home Assistant keeps registered entities in the state machine, so an id that is
  // gone is an id it no longer knows. The card is a one-room card from here on — its
  // chip goes, and its one remaining source becomes the interactive headline.
  await card.locator('[data-entity="sensor.beta"]').focus();
  await updateHass(page, cardId, { "sensor.alpha": mkStateObj("sensor.alpha", 20, TEMP) });
  await expect(card.locator('[data-entity="sensor.beta"]')).toHaveCount(0);
  await expect(card.locator(".rtc-avg-label")).toHaveText("Alpha");
  await expect(card.locator("button.rtc-avg-button")).toHaveAttribute("data-entity", "sensor.alpha");
  // Focus follows to that headline rather than to .rtc-root: focusFallbackTarget()
  // prefers a real control whenever one exists. What the assertion protects either way
  // is that focus never leaves the card.
  expect(
    await page.evaluate((id) => document.getElementById(id).shadowRoot.activeElement?.className, cardId)
  ).toContain("rtc-avg-button");

  const unavailable = {
    "sensor.alpha": mkStateObj("sensor.alpha", "unknown", TEMP),
    "sensor.beta": mkStateObj("sensor.beta", "garbage", TEMP),
  };
  await updateHass(page, cardId, unavailable);
  await expect(card.locator('.rtc-root[data-state="no-data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-button-disabled")).toHaveCount(1);
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(2);

  for (const width of [300, 520]) {
    await page.evaluate(({ cardId, width }) => { document.getElementById(cardId).style.width = `${width}px`; }, { cardId, width });
    await expect.poll(async () => card.evaluate((el) => {
      const root = el.shadowRoot.querySelector(".rtc-root");
      return root.scrollWidth <= root.clientWidth && root.getBoundingClientRect().width > 0;
    })).toBe(true);
  }

  await updateHass(page, cardId, usable);
  await expect(card.locator('.rtc-root[data-state="data"]')).toBeVisible();
  await expect(card.locator(".rtc-avg-value-num")).toHaveText("22.0");
  await expect(card.locator(".rtc-room-unavailable")).toHaveCount(0);
});

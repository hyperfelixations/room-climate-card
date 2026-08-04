"use strict";

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };

test("one room without a primary is a clickable headline and follows the show_rooms policy", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.kitchen": mkStateObj("sensor.kitchen", 21, TEMP) };
  const cardId = await createCard(page, {
    rooms: [{
      entity: "sensor.kitchen",
      name: "Kitchen",
      short: "KI",
      tap_action: { action: "navigate", navigation_path: "/lovelace/kitchen" },
    }],
  }, states);

  const auto = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const root = el.shadowRoot;
    const headline = root.querySelector(".rtc-avg-button");
    return {
      label: headline.querySelector(".rtc-avg-label")?.textContent,
      tag: headline.tagName,
      entity: headline.getAttribute("data-entity"),
      roomIndex: headline.getAttribute("data-room-index"),
      grids: root.querySelectorAll(".rtc-room-grid").length,
      extremes: root.querySelectorAll(".rtc-extremes-view").length,
    };
  }, cardId);
  expect(auto).toEqual({
    label: "Kitchen",
    tag: "BUTTON",
    entity: "sensor.kitchen",
    roomIndex: "0",
    grids: 0,
    extremes: 0,
  });

  const action = await page.evaluate((id) => new Promise((resolve) => {
    const el = document.getElementById(id);
    el.addEventListener("hass-action", (event) => resolve(event.detail), { once: true });
    el.shadowRoot.querySelector(".rtc-avg-button").click();
  }), cardId);
  expect(action.action).toBe("tap");
  expect(action.config.tap_action.navigation_path).toBe("/lovelace/kitchen");

  await page.evaluate((id) => {
    const el = document.getElementById(id);
    el.setConfig({ rooms: [{ entity: "sensor.kitchen", name: "Kitchen", short: "KI" }], show_rooms: true });
  }, cardId);
  expect(await page.locator(`#${cardId}`).evaluate((el) => el.shadowRoot.querySelectorAll(".rtc-room-chip").length)).toBe(1);
  expect(await page.locator(`#${cardId}`).evaluate((el) => el.shadowRoot.querySelectorAll(".rtc-room-grid").length)).toBe(1);
});

test("two rooms without a primary produce a calculated non-clickable consensus", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, {
    rooms: [
      { entity: "sensor.a", name: "A" },
      { entity: "sensor.b", name: "B" },
    ],
  }, {
    "sensor.a": mkStateObj("sensor.a", 20, TEMP),
    "sensor.b": mkStateObj("sensor.b", 24, TEMP),
  });

  const result = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const headline = el.shadowRoot.querySelector(".rtc-avg-button");
    const model = el._computeViewModel();
    return {
      tag: headline.tagName,
      entity: headline.getAttribute("data-entity"),
      roomIndex: headline.getAttribute("data-room-index"),
      source: model.average.source,
      value: model.average.value,
      label: model.average.label,
      chips: el.shadowRoot.querySelectorAll(".rtc-room-chip").length,
    };
  }, cardId);
  expect(result).toEqual({
    tag: "DIV",
    entity: null,
    roomIndex: null,
    source: "calculated",
    value: 22,
    label: "Home avg.",
    chips: 2,
  });
});

test("removing the headline label also removes its vertical spacing", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.primary": mkStateObj("sensor.primary", 22, TEMP) };
  const noLabelId = await createCard(page, { entity: "sensor.primary" }, states);
  const withLabelId = await createCard(page, { entity: "sensor.primary", entity_label: "Current" }, states);

  const metrics = await page.evaluate(({ noLabelId, withLabelId }) => {
    function read(id) {
      const root = document.getElementById(id).shadowRoot;
      const headline = root.querySelector(".rtc-avg-button");
      const value = root.querySelector(".rtc-avg-value");
      const label = root.querySelector(".rtc-avg-label");
      return {
        hasLabel: Boolean(label),
        marginTop: getComputedStyle(value).marginTop,
        valueOffset: value.getBoundingClientRect().top - headline.getBoundingClientRect().top,
      };
    }
    return { noLabel: read(noLabelId), withLabel: read(withLabelId) };
  }, { noLabelId, withLabelId });

  expect(metrics.noLabel.hasLabel).toBe(false);
  expect(metrics.noLabel.marginTop).toBe("0px");
  expect(Math.abs(metrics.noLabel.valueOffset)).toBeLessThanOrEqual(1);
  expect(metrics.withLabel.hasLabel).toBe(true);
  expect(metrics.withLabel.marginTop).toBe("4px");
  expect(metrics.withLabel.valueOffset).toBeGreaterThan(metrics.noLabel.valueOffset + 4);
});

// Reported against 2.38.0 from a live Home Assistant: a card configured with one real
// room and one mistyped one drew a room chip and captioned itself "Home avg." — it had
// counted the id Home Assistant does not know as a second source. Home Assistant keeps
// REGISTERED entities in the state machine even while their integration is unloaded,
// publishing them as `unavailable`; an id that is absent from hass.states is absent
// because it is wrong. So this is a one-room card, and it has to look like one.
test("a mistyped room does not turn a one-room card into a two-room card", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(
    page,
    {
      rooms: [
        { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_temperatur" },
        { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
      ],
    },
    { "sensor.az_temperatur": mkStateObj("sensor.az_temperatur", 28.7, { device_class: "temperature", unit_of_measurement: "°C" }) }
  );
  const card = page.locator(`#${cardId}`);

  // The single-room contract, in full: no chip repeating the headline, the room's own
  // name as the caption, and the room's entity on the big value so its tap and hold
  // actions apply.
  await expect(card.locator(".rtc-room-chip")).toHaveCount(0);
  await expect(card.locator(".rtc-room-grid")).toHaveCount(0);
  await expect(card.locator(".rtc-avg-label")).toHaveText("Arbeitszimmer");
  const headline = card.locator(".rtc-avg-button");
  await expect(headline).toHaveAttribute("data-entity", "sensor.az_temperatur");
  await expect(headline).toHaveAttribute("data-room-index", "0");
  expect(await headline.evaluate((node) => node.tagName)).toBe("BUTTON");

  // The typo is still reported — hidden from the layout is not hidden from the user.
  await expect(card.locator(".rtc-subtitle")).toContainText("not found");

  // And the counter-case, in the same browser: an entity that EXISTS but is
  // unavailable keeps the two-room card it was configured as, with its `--` chip.
  const bothId = await createCard(
    page,
    {
      rooms: [
        { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_temperatur" },
        { name: "Bad", short: "BA", entity: "sensor.ba_temperatur" },
      ],
    },
    {
      "sensor.az_temperatur": mkStateObj("sensor.az_temperatur", 28.8, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.ba_temperatur": mkStateObj("sensor.ba_temperatur", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }),
    }
  );
  const both = page.locator(`#${bothId}`);
  await expect(both.locator(".rtc-room-chip")).toHaveCount(2);
  await expect(both.locator(".rtc-avg-label")).toHaveText("Home avg.");
  await expect(both.locator('[data-entity="sensor.ba_temperatur"] .rtc-room-value-num')).toHaveText("--");
});

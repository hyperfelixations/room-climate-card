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
  const withLabelId = await createCard(page, { entity: "sensor.primary", value_label: "Current" }, states);

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

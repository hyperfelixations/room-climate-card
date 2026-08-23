"use strict";

// The one claim about the surface that only a real CSSOM can answer: the card follows the
// background it is PAINTED on, live, including a change made after it was rendered.
//
// jsdom hands back a computed style that does not track a later inline change, so the unit
// layer can only check a card that was styled before its first read. Here the style is
// real, the cascade is real, and a card-mod-style override behaves the way one would in a
// dashboard.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers.js");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };

async function surfaceOf(page, cardId) {
  return page.evaluate((id) => document.getElementById(id)._surface(), cardId);
}

test("the card follows the background it is painted on, and follows it when it changes", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });

  // The harness carries Home Assistant's real light-theme custom properties, so the card
  // resolves its background through the theme exactly as it would in a dashboard.
  expect(await surfaceOf(page, cardId)).toBe("light");

  // What card-mod does. No theme flag knows about this, and the card still has to see it.
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector(".rtc-card").style.backgroundColor = "rgb(20, 20, 20)";
  }, cardId);
  expect(await surfaceOf(page, cardId)).toBe("dark");

  // And back, so the answer tracks the paint rather than latching on the first read.
  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector(".rtc-card").style.backgroundColor = "rgb(250, 250, 250)";
  }, cardId);
  expect(await surfaceOf(page, cardId)).toBe("light");
});

test("a dark colour scheme is read from the painted card, not from a flag", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg" }, { "sensor.avg": mkStateObj("sensor.avg", 22, TEMP) });
  // hass carries no themes object at all here — the answer comes from the rendered card.
  expect(await surfaceOf(page, cardId)).toBe("dark");
});

"use strict";

// Real Chromium confirms that
// keyed DOM-patching actually preserves keyboard focus, not just node
// object identity in jsdom (test/unit/keyed-dom-patching.test.js covers the
// full Pflichtmatrix there) — a genuine browser's focus/activeElement
// semantics (including how a shadow root's own activeElement is exposed)
// are the real-world claim under test, and jsdom's approximation, while
// good enough for the exhaustive matrix, isn't a substitute for one
// end-to-end confirmation against real Chromium.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../helpers/browser-helpers");

// 3 rooms (not 2): removing one to trigger the focus-fallback test must
// leave >=2 valid rooms, or roomsComparable itself flips false -- a
// structural change routed through _renderAll(), not the _updateRoomGrid()
// patch path this file is actually testing.
function fourAreaStates(overrides) {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r3": mkStateObj("sensor.r3", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    ...overrides,
  };
}

function fourAreaConfig() {
  return {
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
  };
}

// Reads which element (if any) is focused inside the card's own shadow
// root, identified by its data-entity so the test can assert on it without
// holding a live element handle across the page.evaluate() boundary.
async function focusedEntity(page, cardId) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    const active = el.shadowRoot.activeElement;
    return active ? active.getAttribute("data-entity") : null;
  }, cardId);
}

test("a focused room chip keeps real browser focus across a value-only hass update", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, fourAreaConfig(), fourAreaStates());

  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]').focus();
  }, cardId);
  expect(await focusedEntity(page, cardId)).toBe("sensor.r1");

  await updateHass(page, cardId, fourAreaStates({ "sensor.r1": mkStateObj("sensor.r1", 25, { device_class: "temperature", unit_of_measurement: "°C" }) }));

  expect(await focusedEntity(page, cardId)).toBe("sensor.r1");
  const { numText, expected } = await page.evaluate((id) => {
    const el = document.getElementById(id);
    return {
      numText: el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"] .rtc-room-value-num').textContent,
      expected: el._fmt(25),
    };
  }, cardId);
  expect(numText).toBe(expected);
});

test("a focused average button keeps real browser focus across a value-only hass update", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, fourAreaConfig(), fourAreaStates());

  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector("button.rtc-avg-button").focus();
  }, cardId);
  expect(await focusedEntity(page, cardId)).toBe("sensor.avg");

  await updateHass(page, cardId, fourAreaStates({ "sensor.avg": mkStateObj("sensor.avg", 24, { device_class: "temperature", unit_of_measurement: "°C" }) }));

  expect(await focusedEntity(page, cardId)).toBe("sensor.avg");
});

test("focus on the room a user is looking at falls back to the average button when that room disappears", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, fourAreaConfig(), fourAreaStates());

  await page.evaluate((id) => {
    document.getElementById(id).shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]').focus();
  }, cardId);
  expect(await focusedEntity(page, cardId)).toBe("sensor.r1");

  await updateHass(page, cardId, fourAreaStates({ "sensor.r1": mkStateObj("sensor.r1", "unavailable", {}) }));

  expect(await focusedEntity(page, cardId)).toBe("sensor.avg");
});

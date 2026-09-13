"use strict";

// How many lines a warning takes in the warnings block, in every language. A single warning is
// read in full, so it has to stay short: on a 320px card every warning the card can show fits
// in three lines. The written values have a typical length (12 characters) and the paths are
// ones a real configuration writes. Boundary: which warning appears is config and notices unit
// tests' to pin; this file only measures lines. See internal dev doc §4 "Diagnosevertrag".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const { HUMIDITY, TEMPERATURE_C } = require("../../fixtures/attributes.js");
const { LANGUAGES } = require("../../manifests/product-surface.js");

const VALUE = "twelve chars";
const MAX_LINES = 3;
const WIDTH = 320;

const ROOMS = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }];
const DATA = {
  "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
  "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
  "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
};
const MIXED = {
  "sensor.avg": mkStateObj("sensor.avg", "unavailable", {}),
  "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
  "sensor.r2": mkStateObj("sensor.r2", 55, HUMIDITY),
};

// An entity id of typical length (30 characters), for the warnings that name one.
const LONG_ENTITY = "sensor.living_room_temperature";
const withLong = (state, attributes) => ({ ...DATA, [LONG_ENTITY]: mkStateObj(LONG_ENTITY, state, attributes) });

// One configuration per sentence the card can show as a warning, each fallback clause once.
const CASES = [
  { name: "a value replaced by its default", config: { show: { unavailable_rooms: VALUE } } },
  { name: "a view option replaced by its default", config: { views: [{ type: "scale", options: { markers: VALUE } }] } },
  { name: "the measurement's own decimals", config: { decimals: VALUE } },
  { name: "the card's action for a room", config: { rooms: [{ entity: "sensor.r1", hold_action: { action: VALUE } }, { entity: "sensor.r2" }] } },
  { name: "a whole option replaced by its default", config: { palette: { optimal: VALUE } } },
  {
    name: "the longest path in a custom profile",
    config: {
      classification: {
        source: "custom",
        unit: "°C",
        bands: { comfort: { min: 19, max: 25 }, optimal: { min: VALUE, max: 23 } },
        scale: { min: 16, max: 28, step: 2 },
        tiers: [{ min: 24, score: 1, level: "Warm", zone: "outside" }, { default: true, score: 0, level: "Ok", zone: "optimal" }],
      },
    },
  },
  { name: "the automatic setting", config: { views: VALUE } },
  { name: "an ignored entry", config: { views: [VALUE] } },
  { name: "the first available view", config: { start_view: VALUE } },
  { name: "the defaults", config: { views: [{ type: "scale", options: VALUE }] } },
  { name: "a foreign key", config: { grid_layout_mode: 1 } },
  { name: "rooms that measure different things", config: {}, states: MIXED },
  { name: "an entity that does not exist", config: { rooms: [{ entity: "sensor.r1" }, { entity: LONG_ENTITY }] } },
  { name: "a unit that fits several measurements", config: { entity: LONG_ENTITY }, states: withLong(700, { unit_of_measurement: "ppm" }) },
  { name: "no device_class and no known unit", config: { entity: LONG_ENTITY }, states: withLong(7, {}) },
  { name: "a unit the card cannot read", config: { entity: LONG_ENTITY }, states: withLong(22, { device_class: "temperature", unit_of_measurement: "furlongs" }) },
  { name: "a room measuring something else", config: { rooms: [{ entity: "sensor.r1" }, { entity: LONG_ENTITY }] }, states: withLong(45, HUMIDITY) },
  { name: "several problems", config: { auto_slide: VALUE, swipe: VALUE } },
];

for (const language of LANGUAGES) {
  test(`every warning fits in ${MAX_LINES} lines on a ${WIDTH}px card: ${language}`, async ({ page }) => {
    await gotoHarness(page);
    const tooLong = [];
    for (const entry of CASES) {
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: ROOMS, ...entry.config }, entry.states ?? DATA, language);
      await setCardWidth(page, cardId, WIDTH);
      const measured = await page.evaluate((id) => {
        const text = document.getElementById(id).shadowRoot.querySelector(".rtc-warning-text");
        return {
          warning: Boolean(text),
          text: text?.textContent ?? "",
          lines: text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)) : 0,
        };
      }, cardId);
      expect(measured.warning, `${entry.name}: no warning was shown, so nothing was measured`).toBe(true);
      if (measured.lines > MAX_LINES) tooLong.push(`${entry.name}: ${measured.lines} lines — ${measured.text}`);
      await page.evaluate((id) => document.getElementById(id).remove(), cardId);
    }
    expect(tooLong, tooLong.join("\n")).toEqual([]);
  });
}

"use strict";

// What a content patch and the layout pass after it write into the shadow DOM in Chromium,
// counted with a MutationObserver. A sensor that reports the same value with a new timestamp
// takes the content path, and the card must leave every node as it is: no text replaced, no
// attribute or style declaration set to the value it already holds. The jsdom counterpart
// (no measured layout) is test/component/rendering/patch-writes.test.js.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, updateHass, setCardWidth } = require("../../helpers/browser-helpers");
const { attributesFor } = require("../../fixtures/attributes.js");

function stateAt(entityId, value, attributes, stamp) {
  return { entity_id: entityId, state: String(value), attributes, last_changed: stamp, last_updated: stamp };
}

// Readings with a third-of-the-bar position, so a percentage the CSSOM could reformat is hit.
function statesAt(kind, unit, stamp) {
  const attributes = attributesFor(kind, unit);
  const base = { temperature: 22.1, co: 2400 }[kind];
  return {
    "sensor.avg": stateAt("sensor.avg", base, attributes, "2026-10-01T10:00:00.000Z"),
    "sensor.range": stateAt("sensor.range", base * 0.2, { unit_of_measurement: unit, minimum: base * 0.9, maximum: base * 1.1 }, "2026-10-01T10:00:00.000Z"),
    "sensor.trend": stateAt("sensor.trend", base * 0.01, { unit_of_measurement: `${unit}/h` }, "2026-10-01T10:00:00.000Z"),
    "sensor.r1": stateAt("sensor.r1", base * (2 / 3), attributes, "2026-10-01T10:00:00.000Z"),
    "sensor.r2": stateAt("sensor.r2", base * 1.05, attributes, stamp),
  };
}

const CONFIG = {
  entity: "sensor.avg",
  range_entity: "sensor.range",
  trend_entity: "sensor.trend",
  auto_slide: false,
  rooms: [{ entity: "sensor.r1", short: "R1" }, { entity: "sensor.r2", short: "R2" }],
  views: [{ type: "scale" }, { type: "range_scale" }, { type: "extremes" }, { type: "range" }],
};

for (const [kind, unit] of [["temperature", "°C"], ["co", "µg/m³"]]) {
  test(`${kind} ${unit}: an unchanged view model writes nothing, through patch and layout`, async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, CONFIG, statesAt(kind, unit, "2026-10-01T10:00:00.000Z"));
    await setCardWidth(page, cardId, 520);
    await page.evaluate((id) => {
      const card = document.getElementById(id);
      // Records reach the callback in a microtask, long before the frames waited for below.
      window.__patchRecords = [];
      window.__patchWrites = new MutationObserver((records) => window.__patchRecords.push(...records));
      window.__patchWrites.observe(card.shadowRoot, { subtree: true, childList: true, attributes: true, characterData: true });
    }, cardId);
    await updateHass(page, cardId, statesAt(kind, unit, "2026-10-01T10:05:00.000Z"));
    const written = await page.evaluate(
      () =>
        new Promise((resolve) => {
          // Two frames: the update's own layout pass and anything it schedules.
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const records = [...window.__patchRecords, ...window.__patchWrites.takeRecords()];
              window.__patchWrites.disconnect();
              resolve(
                records.map((record) => {
                  const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                  return `${record.type}${record.attributeName ? `:${record.attributeName}` : ""} on ${target.getAttribute("class") ?? target.nodeName}`;
                })
              );
            })
          );
        })
    );
    expect(written).toEqual([]);
  });
}

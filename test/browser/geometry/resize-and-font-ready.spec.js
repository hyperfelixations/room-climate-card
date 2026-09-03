"use strict";

// Real ResizeObserver and real document.fonts.ready, which jsdom stubs. Covers a label
// staying stale after a pure container resize with no hass update, and the font-ready
// correction, for both the main scale and the rangeScale view.
//
// Waits on the mechanism, not a duration (see settledLabels below). settledLabels() stays
// local rather than using waitForStableLayout() in test/helpers/browser-helpers.js: it
// returns the measurements from the same page evaluation as the settled check, so nothing
// can move between the check and the values — that atomicity is this file's subject.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Reads the three scale labels once the card has re-measured at its current width. Four
// observable conditions, none a duration: no resize animation frame outstanding,
// document.fonts.ready settled, the card at the asked width, and identical positions across
// two consecutive frames — all inside one page evaluation so nothing settles between the
// check and the returned values.
async function settledLabels(page, cardId, { scope = "", widthPx }) {
  let labels = null;
  await expect
    .poll(
      async () => {
        labels = await page.evaluate(
          async ({ cardId, scope, widthPx }) => {
            const el = document.getElementById(cardId);
            const root = scope ? el.shadowRoot.querySelector(scope) : el.shadowRoot;
            if (!root) return null;
            if (Math.round(el.getBoundingClientRect().width) !== widthPx) return null;
            if (el._resize.hasPendingFrame()) return null;
            await document.fonts.ready;

            const read = () => {
              const box = (selector) => {
                const node = root.querySelector(selector);
                if (!node) return null;
                const rect = node.getBoundingClientRect();
                return { x: rect.x, width: rect.width };
              };
              return { center: box(".rtc-scale-label-center"), min: box(".rtc-scale-label-min"), max: box(".rtc-scale-label-max") };
            };

            const before = read();
            if (!before.center) return null;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (el._resize.hasPendingFrame()) return null;
            const after = read();
            return JSON.stringify(before) === JSON.stringify(after) ? after : null;
          },
          { cardId, scope, widthPx }
        );
        return labels !== null;
      },
      { message: `the card never settled into a stable layout at ${widthPx}px` }
    )
    .toBe(true);
  return labels;
}

async function setWidth(page, cardId, widthPx) {
  await page.evaluate(({ id, widthPx }) => {
    document.getElementById(id).style.width = `${widthPx}px`;
  }, { id: cardId, widthPx });
}

test("a pure container resize (no hass update) re-resolves the optimal label via ResizeObserver", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 19, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 27, TEMPERATURE_C),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);

  await setWidth(page, cardId, 420);
  const wide = await settledLabels(page, cardId, { widthPx: 420 });

  // Shrink the container substantially, WITHOUT touching hass at all.
  await setWidth(page, cardId, 300);
  const narrow = await settledLabels(page, cardId, { widthPx: 300 });

  // A card that never re-measures never settles into a different layout, so waiting on the
  // mechanism times out rather than hiding the bug.
  expect(
    Math.abs(narrow.center.x - wide.center.x),
    "the label's absolute position must actually move after a pure resize"
  ).toBeGreaterThan(0.5);

  // And it must still not overlap the min/max labels at the new width.
  expect(narrow.center.x).toBeGreaterThanOrEqual(narrow.min.x + narrow.min.width - 1);
  expect(narrow.center.x + narrow.center.width).toBeLessThanOrEqual(narrow.max.x + 1);
});

test("UI-03: a pure resize also re-resolves the rangeScale view's shared optimal label, not just its own 3 top labels", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 4, { unit_of_measurement: "°C", minimum: 19, maximum: 23 }),
  };
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    states
  );

  await setWidth(page, cardId, 420);
  const wide = await settledLabels(page, cardId, { scope: ".rtc-range-scale-view", widthPx: 420 });

  await setWidth(page, cardId, 300);
  const narrow = await settledLabels(page, cardId, { scope: ".rtc-range-scale-view", widthPx: 300 });

  expect(Math.abs(narrow.center.x - wide.center.x)).toBeGreaterThan(0.5);

  // The optimal label is positioned with `left: N%`, so its x moves with the container
  // regardless of re-measurement. The non-overlap invariant is the part that only holds if
  // the label was genuinely re-resolved against the new widths.
  expect(narrow.center.x).toBeGreaterThanOrEqual(narrow.min.x + narrow.min.width - 1);
  expect(narrow.center.x + narrow.center.width).toBeLessThanOrEqual(narrow.max.x + 1);
});

test("disconnecting the card cleanly stops the ResizeObserver (no error on a subsequent resize of the detached node)", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C) };
  const cardId = await createCard(page, { entity: "sensor.avg" }, states);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));

  // Detach, then resize the detached node. An observer that survived the disconnect
  // would fire into a card that is no longer in any document.
  await page.evaluate(async (id) => {
    const el = document.getElementById(id);
    el.remove(); // triggers disconnectedCallback -> _unbindResizeObserver()
    el.style.width = "250px";
    // Two frames plus a macrotask turn: enough for a surviving observer to fire and run its
    // coalescing frame.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
  }, cardId);

  expect(await page.evaluate((id) => document.getElementById(id) === null, cardId)).toBe(true);
  expect(errors, `unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

test("cold load: the card renders correctly even though document.fonts.ready may still be pending at first paint", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-root")).toBeVisible();

  // Waits for the actual font-ready re-resolve rather than for a duration: the promise
  // itself, then the measurement frame it schedules.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate((id) => document.getElementById(id)._resize.fontsStateForCurrentSource(), cardId)).toBe("measured");
  expect(errors).toHaveLength(0);
});

"use strict";

// Real ResizeObserver + real document.fonts.ready — jsdom stubs both
// (test/unit/ tests the bind/unbind lifecycle and the promise-chain logic
// with those stubs, but a stub can't reproduce the actual bug history
// here). Covers: the 2.14.0 resize-bug root cause (label stays stale after
// a pure container resize with no accompanying hass update) and the
// 2.12.0 font-ready correction, both for the main scale AND the rangeScale
// view.
//
// NO FIXED TIMEOUTS. These tests assert label positions to within a pixel, and an
// A flat timeout is not a
// contract, it is a guess about how busy the machine is, and it failed once under load.
// Everything below waits on the mechanism instead — see settledLabels().

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

// Reads the three scale labels once the card has finished re-measuring at its current
// width. Four conditions, all observable, none of them a duration:
//
//   1. the resize runtime has no animation frame outstanding. Its ResizeObserver
//      callback coalesces every resize notification onto exactly one frame, so a
//      pending frame means a measurement is still queued.
//   2. document.fonts.ready has settled. Web fonts finishing is the other thing that
//      moves a label after the fact, and it is the whole subject of half this file.
//   3. the card is actually at the width the test asked for, so a reading can never be
//      taken from the layout that is about to be replaced.
//   4. the measured positions are identical across two consecutive animation frames.
//
// All four are read inside ONE page evaluation, so nothing can settle differently
// between the checks and the values that are returned.
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
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 27, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);

  await setWidth(page, cardId, 420);
  const wide = await settledLabels(page, cardId, { widthPx: 420 });

  // Shrink the container substantially, WITHOUT touching hass at all.
  await setWidth(page, cardId, 300);
  const narrow = await settledLabels(page, cardId, { widthPx: 300 });

  // A card that never re-measures never reaches a settled layout that differs from the
  // wide one, so waiting on the mechanism cannot hide the bug this test guards against:
  // it would time out above, and fail here.
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
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
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

  // The assertion above is, on its own, weaker than it looks: the optimal label is
  // positioned with `left: N%`, so its absolute x moves with the container whether or
  // not anything re-measured. The non-overlap invariant is the part that can only hold
  // if the SHARED optimal label was genuinely re-resolved against the new rendered
  // widths — which is what UI-03 was about.
  expect(narrow.center.x).toBeGreaterThanOrEqual(narrow.min.x + narrow.min.width - 1);
  expect(narrow.center.x + narrow.center.width).toBeLessThanOrEqual(narrow.max.x + 1);
});

test("disconnecting the card cleanly stops the ResizeObserver (no error on a subsequent resize of the detached node)", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) };
  const cardId = await createCard(page, { entity: "sensor.avg" }, states);
  const errors = [];
  page.on("pageerror", (err) => errors.push(err));

  // Detach, then resize the detached node. An observer that survived the disconnect
  // would fire into a card that is no longer in any document.
  await page.evaluate(async (id) => {
    const el = document.getElementById(id);
    el.remove(); // triggers disconnectedCallback -> _unbindResizeObserver()
    el.style.width = "250px";
    // Two frames plus a macrotask turn: enough for a surviving observer to have both
    // fired and run its coalescing frame, with no reliance on how long that takes.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
  }, cardId);

  expect(await page.evaluate((id) => document.getElementById(id) === null, cardId)).toBe(true);
  expect(errors, `unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

test("cold load: the card renders correctly even though document.fonts.ready may still be pending at first paint", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
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

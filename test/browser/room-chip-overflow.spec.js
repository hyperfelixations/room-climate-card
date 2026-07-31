"use strict";

// With real layout, a long room name or short override
// must ellipsis-clip inside its chip instead of overflowing the chip
// boundary — jsdom can't measure real text width, so this needs Chromium.
// title/aria-label (already escaped/rendered regardless of visual clipping,
// see _renderRoomChip() in room-climate-card.js) must still carry the full
// name, so the ellipsis stays accessibility-safe. Also covers
// .rtc-extreme-name/.rtc-extreme-label, which got the same CSS treatment.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

const LONG_NAME = "Ein sehr sehr sehr langer Raumname der garantiert nicht in einen Chip passt";
const LONG_SHORT = "XXXXXXXXXX";

test("a very long room name/short does not overflow its chip, and title/aria-label keep the full text", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      rooms: [
        { entity: "sensor.r1", name: LONG_NAME, short: LONG_SHORT },
        { entity: "sensor.r2" },
      ],
    },
    states
  );
  const card = page.locator(`#${cardId}`);
  const chip = card.locator(".rtc-room-chip").first();
  const chipBox = await chip.boundingBox();
  const shortEl = chip.locator(".rtc-room-short");
  const shortBox = await shortEl.boundingBox();
  const markEl = chip.locator(".rtc-room-mark");
  const markBox = await markEl.boundingBox();

  // Ellipsis must actually be engaging (overflow:hidden clips the box to
  // the chip, not the un-clipped natural text width) — assert the short
  // label's rendered box stays within the chip's own bounds.
  expect(shortBox.x + shortBox.width, "the short label must not overflow the chip's right edge").toBeLessThanOrEqual(chipBox.x + chipBox.width + 0.5);
  expect(shortBox.x, "the short label must not overflow the chip's left edge").toBeGreaterThanOrEqual(chipBox.x - 0.5);
  // The mark (up/down/dot indicator) must stay visible at its full fixed size, never squeezed by the long short label.
  expect(markBox.width).toBeGreaterThan(10);

  const title = await chip.getAttribute("title");
  const ariaLabel = await chip.getAttribute("aria-label");
  expect(title, "title must still carry the full room name, not a truncated one").toContain(LONG_NAME);
  expect(ariaLabel, "aria-label must still carry the full room name").toContain(LONG_NAME);
});

test("a very long extreme-value room name does not overflow its card (.rtc-extreme-name/.rtc-extreme-label)", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 15, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 30, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      rooms: [
        { entity: "sensor.r1", name: LONG_NAME },
        { entity: "sensor.r2", name: LONG_NAME },
      ],
    },
    states
  );
  const card = page.locator(`#${cardId}`);
  const nameEl = card.locator(".rtc-extreme-name").first();
  const nameCard = card.locator(".rtc-extreme-card").first();
  const nameBox = await nameEl.boundingBox();
  const cardBox = await nameCard.boundingBox();
  expect(nameBox.x + nameBox.width, "the extreme-name label must not overflow its card's right edge").toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
});

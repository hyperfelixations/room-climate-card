"use strict";

// Room values stay legible at common phone widths: ellipsis must not truncate a normal
// value like "24,7 °C". Room numbers and units are non-truncatable — the automatic layout puts
// as many chips into a row as the card computes for its reading (room-chip-fit.js) before
// adding rows. Two-letter short codes stay fully visible; longer labels keep ellipsis.
// Boundary: room-chip-fit.spec.js holds the computation against the widest typical reading,
// narrow-width-overflow.spec.js covers the wider containment contracts.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { CO2, HUMIDITY, PM25, TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Common phone viewports plus the 460px container-query breakpoint.
const WIDTHS = [360, 375, 390, 393, 412, 460];
// German locale: the acceptance values here (comma decimals, "." grouping, "2.000 ppm")
// are only meaningful in this locale.
const LANGUAGE = "de";

// A minimal display:block `ha-card` stand-in so the @container queries match — see internal
// dev doc §4 "ha-card im Offline-Harness".
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!customElements.get("ha-card")) {
      customElements.define("ha-card", class extends HTMLElement {
        connectedCallback() {
          this.style.display = "block";
        }
      });
    }
  });
});

// CSS ellipsis never changes textContent, so every assertion here is geometric or
// computed-style based.
async function assertFullyVisible(locator, width, label) {
  const info = await locator.evaluate((node) => ({
    fits: node.scrollWidth <= node.clientWidth + 0.5,
    textOverflow: getComputedStyle(node).textOverflow,
  }));
  expect(info.fits, `${label} text must fully fit (scrollWidth<=clientWidth) at ${width}px`).toBe(true);
  expect(info.textOverflow, `${label} must not have ellipsis engaged at ${width}px`).not.toBe("ellipsis");
}

async function assertEllipsized(locator, width, label) {
  const info = await locator.evaluate((node) => ({
    overflows: node.scrollWidth > node.clientWidth + 0.5,
    textOverflow: getComputedStyle(node).textOverflow,
  }));
  expect(info.overflows, `${label} must actually ellipsize (scrollWidth>clientWidth) at ${width}px`).toBe(true);
  expect(info.textOverflow, `${label} must have text-overflow:ellipsis computed at ${width}px`).toBe("ellipsis");
}

async function assertNumberAndUnitContained(chip, width) {
  const chipBox = await chip.boundingBox();
  const numLoc = chip.locator(".rtc-room-value-num");
  const unitLoc = chip.locator(".rtc-room-value-unit");
  const numBox = await numLoc.boundingBox();
  const unitBox = await unitLoc.boundingBox();
  expect(numBox.x, `number left edge inside chip at ${width}px`).toBeGreaterThanOrEqual(chipBox.x - 0.5);
  expect(unitBox.x + unitBox.width, `unit right edge inside chip at ${width}px`).toBeLessThanOrEqual(chipBox.x + chipBox.width + 0.5);
  expect(numBox.x + numBox.width, `number and unit must not overlap at ${width}px`).toBeLessThanOrEqual(unitBox.x + 0.5);
  await assertFullyVisible(numLoc, width, "room value number");
}

// ==== Automatic rows of realistic readings ====

// Two-letter codes for up to twenty rooms, so a row is as full as the computation allows.
const ROOM_CODES = ["WZ", "WC", "SZ", "FL", "BA", "KÜ", "AZ", "GZ", "HW", "EZ", "AR", "DG", "KZ", "FZ", "SP", "TR", "GA", "KE", "DB", "BU"];

const READINGS = {
  temperature: { attributes: TEMPERATURE_C, average: 24.5, values: [24.7, 23.8, 24.1, 24.3, 24.6, 25.2, 25.4, 22.9, 23.3, 24.0] },
  humidity: { attributes: HUMIDITY, average: 39, values: [37.8, 35.5, 39.4, 41.0, 42.2, 43.1, 38.6, 36.9, 40.4, 44.7] },
  co2: { attributes: CO2, average: 1200, values: [800, 1200, 2000, 950, 1500, 700, 1100, 1800, 650, 1350] },
  pm25: { attributes: PM25, average: 20, values: [8.3, 15.9, 24.6, 41.2, 12.1, 30.0, 9.7, 18.4, 27.5, 35.2] },
};

function roomsOf(count) {
  return ROOM_CODES.slice(0, count).map((short, i) => ({ entity: `sensor.r${i}`, short }));
}

function statesOf(reading, count) {
  const { attributes, average, values } = READINGS[reading];
  const states = { "sensor.avg": mkStateObj("sensor.avg", average, attributes) };
  for (let i = 0; i < count; i++) states[`sensor.r${i}`] = mkStateObj(`sensor.r${i}`, values[i % values.length], attributes);
  return states;
}

// The automatic row limit the card computes for the reading, read from a one-room card.
async function autoRowLimit(page, reading) {
  const probeId = await createCard(page, { entity: "sensor.avg", rooms: roomsOf(1) }, statesOf(reading, 1), LANGUAGE);
  return page.evaluate((id) => {
    const card = document.getElementById(id);
    const columns = card._autoRoomColumns();
    card.remove();
    return columns;
  }, probeId);
}

async function chipCountsPerRow(card) {
  const counts = [];
  for (const row of await card.locator(".rtc-room-row").all()) counts.push(await row.locator(".rtc-room-chip").count());
  return counts;
}

for (const reading of Object.keys(READINGS)) {
  for (const width of WIDTHS) {
    test(`${reading}: a full automatic row stays in one row, fully legible at ${width}px`, async ({ page }) => {
      await gotoHarness(page);
      const columns = await autoRowLimit(page, reading);
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: roomsOf(columns) }, statesOf(reading, columns), LANGUAGE);
      await setCardWidth(page, cardId, width);
      const card = page.locator(`#${cardId}`);
      expect(await chipCountsPerRow(card), `${columns} ${reading} rooms must fit in a single row at ${width}px`).toEqual([columns]);
      for (const chip of await card.locator(".rtc-room-chip").all()) {
        await assertNumberAndUnitContained(chip, width);
        if (reading === "pm25") {
          const unitText = await chip.locator(".rtc-room-value-unit").innerText();
          expect(unitText, "the full µg/m³ unit must render, not a truncated form").toContain("µg/m³");
        }
      }
    });
  }

  test(`${reading}: one room more than the automatic row limit wraps into two evenly split rows`, async ({ page }) => {
    await gotoHarness(page);
    const columns = await autoRowLimit(page, reading);
    const count = columns + 1;
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: roomsOf(count) }, statesOf(reading, count), LANGUAGE);
    await setCardWidth(page, cardId, 390);
    const card = page.locator(`#${cardId}`);
    expect(await chipCountsPerRow(card), `${count} ${reading} rooms must split into two rows`).toEqual([Math.ceil(count / 2), Math.floor(count / 2)]);
    for (const chip of await card.locator(".rtc-room-chip").all()) {
      await assertNumberAndUnitContained(chip, 390);
    }
  });
}

// ==== Room short codes: exactly-two-uppercase-letter guarantee ====

test("room short codes: the codes of a full automatic temperature row stay fully visible at 360px", async ({ page }) => {
  await gotoHarness(page);
  const columns = await autoRowLimit(page, "temperature");
  const rooms = roomsOf(columns);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, statesOf("temperature", columns), LANGUAGE);
  await setCardWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  for (const room of rooms) {
    const chip = card.locator(`.rtc-room-chip[data-entity="${room.entity}"]`);
    const chipBox = await chip.boundingBox();
    const shortLoc = chip.locator(".rtc-room-short");
    const shortBox = await shortLoc.boundingBox();
    const markBox = await chip.locator(".rtc-room-mark").boundingBox();
    expect(shortBox.x, `${room.short}: left edge inside chip`).toBeGreaterThanOrEqual(chipBox.x - 0.5);
    expect(shortBox.x + shortBox.width, `${room.short}: right edge must not overlap .rtc-room-mark`).toBeLessThanOrEqual(markBox.x + 0.5);
    await assertFullyVisible(shortLoc, 360, `room short code ${room.short}`);
    const text = await shortLoc.innerText();
    expect(text, `${room.short}: visible text must be the exact code`).toBe(room.short);
  }
});

// The next two tests squeeze a long label into one of seven chips in a 360px row; room_columns
// makes that row independent of the automatic limit.
test("room short codes: a long explicit short (WOHNZ) is NOT guaranteed and still ellipsizes when squeezed", async ({ page }) => {
  await gotoHarness(page);
  const rooms = [...roomsOf(6), { entity: "sensor.long", short: "WOHNZ" }];
  const states = statesOf("temperature", 6);
  states["sensor.long"] = mkStateObj("sensor.long", 22.5, TEMPERATURE_C);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms, room_columns: 7 }, states, LANGUAGE);
  await setCardWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  expect(await chipCountsPerRow(card), "7 rooms in a single row").toEqual([7]);
  const chip = card.locator('.rtc-room-chip[data-entity="sensor.long"]');
  const shortEl = chip.locator(".rtc-room-short");
  expect(await shortEl.getAttribute("data-short-guaranteed"), "WOHNZ must not carry the guarantee attribute").toBeNull();
  await assertEllipsized(shortEl, 360, "room short code WOHNZ");
});

test("room short codes: a room with no configured short (long derived name) is NOT guaranteed and still ellipsizes when squeezed", async ({ page }) => {
  await gotoHarness(page);
  const rooms = [...roomsOf(6), { entity: "sensor.noname", name: "Gaestezimmer im Dachgeschoss" }];
  const states = statesOf("temperature", 6);
  states["sensor.noname"] = mkStateObj("sensor.noname", 21.3, TEMPERATURE_C);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms, room_columns: 7 }, states, LANGUAGE);
  await setCardWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  const chip = card.locator('.rtc-room-chip[data-entity="sensor.noname"]');
  const shortEl = chip.locator(".rtc-room-short");
  expect(await shortEl.getAttribute("data-short-guaranteed")).toBeNull();
  await assertEllipsized(shortEl, 360, "derived long room label");
});

// ==== Average/main value regression ====

test("average value never ellipsizes at any of the mandated widths (regression guard, unrelated to this fix)", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: roomsOf(7) }, statesOf("temperature", 7), LANGUAGE);
  for (const width of WIDTHS) {
    await setCardWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const avgNum = card.locator(".rtc-avg-value-num").first();
    await assertFullyVisible(avgNum, width, "average value number");
  }
});

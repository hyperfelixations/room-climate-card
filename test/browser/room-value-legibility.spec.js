"use strict";

// Regression fix for a real screenshot bug: AP-10's .rtc-room-value-num
// ellipsis rule was over-broad and silently truncated completely normal
// room values (7 temperature/humidity chips at a typical phone width, e.g.
// "24,7 °C" rendering as "2...°C"). See the updated describe block in
// narrow-width-overflow.spec.js and this round's Umsetzungsnotiz in
// "readme climate card.md" for the full writeup.
//
// The fix has two parts, both exercised here:
//   A. .rtc-room-value-num's ellipsis rule was reverted entirely -- room
//      values (number+unit) are non-truncatable information in automatic
//      mode. "Not enough space" is solved by an extra row (Part B), not by
//      shrinking text.
//   B. Automatic (no room_columns/room_rows override) max chips per row is
//      now metric-specific: 7 for temperature/humidity, 5 for CO2/PM2.5
//      (see METRIC_META.autoRoomColumns / _autoRoomColumnsFor() /
//      _roomGridRows()'s autoMaxColumns parameter). Exceeding the limit
//      still distributes evenly across the required rows.
//   D. An explicitly two-Unicode-uppercase-letter room short code (WZ, WC,
//      AZ, SZ, FL, BA, KÜ, ...) is now guaranteed to render fully -- see
//      .rtc-room-short[data-short-guaranteed] and TWO_UPPER_LETTER_RE.
//      Longer labels (e.g. "WOHNZ") keep the normal ellipsis fallback.
//   E. Average/main values were never affected -- covered here purely as a
//      regression guard.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

// The widths mandated by the task spec: common phone viewports plus the
// 460px container-query breakpoint.
const WIDTHS = [360, 375, 390, 393, 412, 460];
// German locale matches the reported regression (comma decimals, "."
// thousands grouping, e.g. "24,7 °C" / "2.000 ppm") -- the exact values in
// this file's acceptance criteria are only meaningful in this locale.
const LANGUAGE = "de";

// Registers a minimal ha-card stand-in so @container queries in the card's
// styles actually match against the card's real rendered width (same
// rationale/setup as narrow-width-overflow.spec.js -- ha-card is never a
// registered custom element in the offline test harness, so it defaults to
// display:inline, under which CSS Containment never applies).
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

async function setWidth(page, cardId, width) {
  await page.evaluate(({ cardId, width }) => {
    document.getElementById(cardId).style.width = `${width}px`;
  }, { cardId, width });
  await page.waitForTimeout(120);
}

// CSS ellipsis never changes textContent -- every assertion here is
// geometric or computed-style based, never a text-content/"contains no
// dots" check (that would pass even with active ellipsis).
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

// ==== Temperature: 7 chips in one row, all fully legible ====

function tempRooms() {
  return [
    { entity: "sensor.wz", short: "WZ" },
    { entity: "sensor.wc", short: "WC" },
    { entity: "sensor.sz", short: "SZ" },
    { entity: "sensor.fl", short: "FL" },
    { entity: "sensor.ba", short: "BA" },
    { entity: "sensor.ku", short: "KÜ" },
    { entity: "sensor.az", short: "AZ" },
  ];
}

function tempStates(values) {
  const states = { "sensor.avg": mkStateObj("sensor.avg", 24.5, { device_class: "temperature", unit_of_measurement: "°C" }) };
  for (const room of tempRooms()) {
    const key = room.entity.split(".")[1];
    states[room.entity] = mkStateObj(room.entity, values[key], { device_class: "temperature", unit_of_measurement: "°C" });
  }
  return states;
}

const TEMP_VALUES = { wz: 24.7, wc: 23.8, sz: 24.1, fl: 24.3, ba: 24.6, ku: 25.2, az: 25.4 };

for (const width of WIDTHS) {
  test(`temperature: 7 rooms (WZ/WC/SZ/FL/BA/KÜ/AZ) stay in one row, fully legible at ${width}px`, async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: tempRooms() }, tempStates(TEMP_VALUES), LANGUAGE);
    await setWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const rows = await card.locator(".rtc-room-row").all();
    expect(rows.length, `7 temperature rooms must fit in a single row (autoMaxColumns=7) at ${width}px`).toBe(1);
    const chips = await card.locator(".rtc-room-chip").all();
    expect(chips.length).toBe(7);
    for (const chip of chips) {
      await assertNumberAndUnitContained(chip, width);
    }
  });
}

test("temperature: an 8th room automatically wraps into a second, evenly-split row (4+4)", async ({ page }) => {
  await gotoHarness(page);
  const rooms = [...tempRooms(), { entity: "sensor.extra", short: "EX" }];
  const states = tempStates(TEMP_VALUES);
  states["sensor.extra"] = mkStateObj("sensor.extra", 22.9, { device_class: "temperature", unit_of_measurement: "°C" });
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, states, LANGUAGE);
  await setWidth(page, cardId, 390);
  const card = page.locator(`#${cardId}`);
  const rows = await card.locator(".rtc-room-row").all();
  expect(rows.length, "8 rooms must split into 2 rows").toBe(2);
  const counts = [];
  for (const row of rows) counts.push((await row.locator(".rtc-room-chip").all()).length);
  counts.sort((a, b) => b - a);
  expect(counts).toEqual([4, 4]);
});

// ==== Humidity: 7 chips in one row, all fully legible ====

function humidityRooms() {
  return [
    { entity: "sensor.hwz", short: "WZ" },
    { entity: "sensor.hwc", short: "WC" },
    { entity: "sensor.hsz", short: "SZ" },
    { entity: "sensor.hfl", short: "FL" },
    { entity: "sensor.hba", short: "BA" },
    { entity: "sensor.hku", short: "KÜ" },
    { entity: "sensor.haz", short: "AZ" },
  ];
}

const HUMIDITY_VALUES = { hwz: 37.8, hwc: 35.5, hsz: 39.4, hfl: 41.0, hba: 42.2, hku: 43.1, haz: 38.6 };

function humidityStates(values) {
  const states = { "sensor.avg": mkStateObj("sensor.avg", 39, { device_class: "humidity", unit_of_measurement: "%" }) };
  for (const room of humidityRooms()) {
    const key = room.entity.split(".")[1];
    states[room.entity] = mkStateObj(room.entity, values[key], { device_class: "humidity", unit_of_measurement: "%" });
  }
  return states;
}

for (const width of WIDTHS) {
  test(`humidity: 7 rooms stay in one row, fully legible at ${width}px (35,5/39,4/43,1% etc.)`, async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: humidityRooms() }, humidityStates(HUMIDITY_VALUES), LANGUAGE);
    await setWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const rows = await card.locator(".rtc-room-row").all();
    expect(rows.length, `7 humidity rooms must fit in a single row at ${width}px`).toBe(1);
    for (const chip of await card.locator(".rtc-room-chip").all()) {
      await assertNumberAndUnitContained(chip, width);
    }
  });
}

// ==== CO2: autoMaxColumns=5 -- exact single-row limit AND the 6-room split ====

function co2Rooms(count) {
  return Array.from({ length: count }, (_, i) => ({ entity: `sensor.co${i}`, short: `C${i}` }));
}

function co2States(count, values) {
  const states = { "sensor.avg": mkStateObj("sensor.avg", 1200, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }) };
  for (let i = 0; i < count; i++) {
    states[`sensor.co${i}`] = mkStateObj(`sensor.co${i}`, values[i], { device_class: "carbon_dioxide", unit_of_measurement: "ppm" });
  }
  return states;
}

for (const width of WIDTHS) {
  test(`CO2: exactly 5 rooms stay in one row (autoMaxColumns limit) at ${width}px`, async ({ page }) => {
    await gotoHarness(page);
    const values = [800, 1200, 2000, 950, 1500];
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: co2Rooms(5) }, co2States(5, values), LANGUAGE);
    await setWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const rows = await card.locator(".rtc-room-row").all();
    expect(rows.length, `5 CO2 rooms must fit in a single row at ${width}px`).toBe(1);
    for (const chip of await card.locator(".rtc-room-chip").all()) {
      await assertNumberAndUnitContained(chip, width);
    }
  });
}

test("CO2: a 6th room automatically wraps into a second, evenly-split row (3+3)", async ({ page }) => {
  await gotoHarness(page);
  const values = [800, 1200, 2000, 950, 1500, 700];
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: co2Rooms(6) }, co2States(6, values), LANGUAGE);
  await setWidth(page, cardId, 390);
  const card = page.locator(`#${cardId}`);
  const rows = await card.locator(".rtc-room-row").all();
  expect(rows.length, "6 CO2 rooms must split into 2 rows").toBe(2);
  const counts = [];
  for (const row of rows) counts.push((await row.locator(".rtc-room-chip").all()).length);
  counts.sort((a, b) => b - a);
  expect(counts).toEqual([3, 3]);
  for (const chip of await card.locator(".rtc-room-chip").all()) {
    await assertNumberAndUnitContained(chip, 390);
  }
});

// ==== PM2.5: autoMaxColumns=5 -- exact single-row limit AND the 6-room split ====

function pm25Rooms(count) {
  return Array.from({ length: count }, (_, i) => ({ entity: `sensor.pm${i}`, short: `P${i}` }));
}

function pm25States(count, values) {
  const states = { "sensor.avg": mkStateObj("sensor.avg", 20, { device_class: "pm25", unit_of_measurement: "µg/m³" }) };
  for (let i = 0; i < count; i++) {
    states[`sensor.pm${i}`] = mkStateObj(`sensor.pm${i}`, values[i], { device_class: "pm25", unit_of_measurement: "µg/m³" });
  }
  return states;
}

for (const width of WIDTHS) {
  test(`PM2.5: exactly 5 rooms stay in one row (autoMaxColumns limit) at ${width}px, full µg/m³ unit`, async ({ page }) => {
    await gotoHarness(page);
    const values = [8.3, 15.9, 24.6, 41.2, 12.1];
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: pm25Rooms(5) }, pm25States(5, values), LANGUAGE);
    await setWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const rows = await card.locator(".rtc-room-row").all();
    expect(rows.length, `5 PM2.5 rooms must fit in a single row at ${width}px`).toBe(1);
    for (const chip of await card.locator(".rtc-room-chip").all()) {
      await assertNumberAndUnitContained(chip, width);
      const unitText = await chip.locator(".rtc-room-value-unit").innerText();
      expect(unitText, "the full µg/m³ unit must render, not a truncated form").toContain("µg/m³");
    }
  });
}

test("PM2.5: a 6th room automatically wraps into a second, evenly-split row (3+3)", async ({ page }) => {
  await gotoHarness(page);
  const values = [8.3, 15.9, 24.6, 41.2, 12.1, 30.0];
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: pm25Rooms(6) }, pm25States(6, values), LANGUAGE);
  await setWidth(page, cardId, 390);
  const card = page.locator(`#${cardId}`);
  const rows = await card.locator(".rtc-room-row").all();
  expect(rows.length, "6 PM2.5 rooms must split into 2 rows").toBe(2);
  const counts = [];
  for (const row of rows) counts.push((await row.locator(".rtc-room-chip").all()).length);
  counts.sort((a, b) => b - a);
  expect(counts).toEqual([3, 3]);
});

// ==== Room short codes: exactly-two-uppercase-letter guarantee ====

test("room short codes: all seven example codes (WZ/WC/AZ/SZ/FL/BA/KÜ) stay fully visible at 360px", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: tempRooms() }, tempStates(TEMP_VALUES), LANGUAGE);
  await setWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  for (const room of tempRooms()) {
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

test("room short codes: a long explicit short (WOHNZ) is NOT guaranteed and still ellipsizes when squeezed", async ({ page }) => {
  await gotoHarness(page);
  const rooms = [...tempRooms().slice(0, 6), { entity: "sensor.long", short: "WOHNZ" }];
  const states = tempStates(TEMP_VALUES);
  states["sensor.long"] = mkStateObj("sensor.long", 22.5, { device_class: "temperature", unit_of_measurement: "°C" });
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, states, LANGUAGE);
  await setWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  const rows = await card.locator(".rtc-room-row").all();
  expect(rows.length, "7 rooms must still fit in a single row (autoMaxColumns=7)").toBe(1);
  const chip = card.locator('.rtc-room-chip[data-entity="sensor.long"]');
  const shortEl = chip.locator(".rtc-room-short");
  expect(await shortEl.getAttribute("data-short-guaranteed"), "WOHNZ must not carry the guarantee attribute").toBeNull();
  await assertEllipsized(shortEl, 360, "room short code WOHNZ");
});

test("room short codes: a room with no configured short (long derived name) is NOT guaranteed and still ellipsizes when squeezed", async ({ page }) => {
  await gotoHarness(page);
  const rooms = [...tempRooms().slice(0, 6), { entity: "sensor.noname", name: "Gaestezimmer im Dachgeschoss" }];
  const states = tempStates(TEMP_VALUES);
  states["sensor.noname"] = mkStateObj("sensor.noname", 21.3, { device_class: "temperature", unit_of_measurement: "°C" });
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, states, LANGUAGE);
  await setWidth(page, cardId, 360);
  const card = page.locator(`#${cardId}`);
  const chip = card.locator('.rtc-room-chip[data-entity="sensor.noname"]');
  const shortEl = chip.locator(".rtc-room-short");
  expect(await shortEl.getAttribute("data-short-guaranteed")).toBeNull();
  await assertEllipsized(shortEl, 360, "derived long room label");
});

// ==== Average/main value regression (Teil E) ====

test("average value never ellipsizes at any of the mandated widths (regression guard, unrelated to this fix)", async ({ page }) => {
  await gotoHarness(page);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: tempRooms() }, tempStates(TEMP_VALUES), LANGUAGE);
  for (const width of WIDTHS) {
    await setWidth(page, cardId, width);
    const card = page.locator(`#${cardId}`);
    const avgNum = card.locator(".rtc-avg-value-num").first();
    await assertFullyVisible(avgNum, width, "average value number");
  }
});

"use strict";

// The automatic room-chip column count (src/presentation/view-model/room-chip-fit.js) held
// against Chromium and the self-hosted Roboto: (a) the glyph table is the font's, at the weights
// the chips are drawn with; (b) at the computed count, the widest typical reading and a
// two-letter short code stay inside every chip from the reference width up, in both width
// layouts; (c) one chip more does not fit, so the count is not overcautious. The count itself is
// the computation's; only temperature and humidity have a fixed one (test/unit/presentation/
// room-chip-fit.test.js). See internal dev doc §5 "Raumchip-Passung".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const A = require("../../fixtures/attributes.js");

// The reference width, both sides of the narrow layout's end (container = card − 2 px of
// border), and wider cards of the wide layout.
const REFERENCE_WIDTH = 375;
const WIDE_START = 463;
const WIDTHS = [REFERENCE_WIDTH, 390, 412, 460, 462, WIDE_START, 480, 520, 600, 700];
// Layout rounds to 1/64 px; the glyph table to 1/10000 em.
const FIT_TOLERANCE_PX = 0.1;
const GLYPH_TOLERANCE_EM = 0.0002;

const SCENARIOS = [
  { name: "temperature °C", attributes: A.TEMPERATURE_C },
  { name: "temperature °C (en)", attributes: A.TEMPERATURE_C, language: "en" },
  { name: "temperature °F", attributes: A.TEMPERATURE_F },
  { name: "temperature K", attributes: A.TEMPERATURE_K },
  { name: "temperature °C, decimals 0", attributes: A.TEMPERATURE_C, config: { decimals: 0 } },
  { name: "temperature °C, decimals 2", attributes: A.TEMPERATURE_C, config: { decimals: 2 } },
  { name: "humidity", attributes: A.HUMIDITY },
  { name: "CO2", attributes: A.CO2 },
  { name: "CO2 (en)", attributes: A.CO2, language: "en" },
  { name: "CO2, space_comma", attributes: A.CO2, config: { number_format: "space_comma" } },
  { name: "PM2.5", attributes: A.PM25 },
  { name: "CO mg/m³", attributes: A.CO },
  { name: "CO ppm", attributes: A.CO_PPM },
  { name: "CO ppb", attributes: A.CO_PPB },
  { name: "CO ppb (en)", attributes: A.CO_PPB, language: "en" },
  { name: "CO µg/m³", attributes: A.CO_MICROGRAM },
];

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

function roomsOf(count) {
  return Array.from({ length: count }, (_, i) => ({ entity: `sensor.r${i}`, short: "WW" }));
}

function statesOf(scenario, rooms, values) {
  const states = { "sensor.avg": mkStateObj("sensor.avg", values[0], scenario.attributes) };
  rooms.forEach((room, i) => {
    states[room.entity] = mkStateObj(room.entity, values[i % values.length], scenario.attributes);
  });
  return states;
}

// The count the card computes and the ends of its typical reading in the sensor's unit, read
// from a one-room card of the scenario.
async function typicalRow(page, scenario) {
  const rooms = roomsOf(1);
  const probe = await createCard(page, { entity: "sensor.avg", rooms, ...scenario.config }, statesOf(scenario, rooms, [20]), scenario.language ?? "de");
  return page.evaluate(async (cardId) => {
    const { metricMetaFor } = await import("/src/presentation/view-model/metric-meta.js");
    const card = document.getElementById(cardId);
    const profile = card._resolveMetricContext().displayUnitProfile;
    const { min, max } = metricMetaFor(card._metricType()).typicalReading;
    const row = { columns: card._autoRoomColumns(), values: [profile.fromCanonical(max), profile.fromCanonical(min)] };
    card.remove();
    return row;
  }, probe);
}

// The tightest chip of the card: how far its value row and its short-code row stay inside the
// padding box (negative: past it), and whether a text is cut.
async function tightestChip(page, cardId) {
  return page.evaluate((id) => {
    const card = document.getElementById(id);
    const chips = [...card.shadowRoot.querySelectorAll(".rtc-room-chip")];
    const cut = (node) => node.scrollWidth > node.clientWidth + 0.5;
    return chips.reduce(
      (tightest, chip) => {
        const style = getComputedStyle(chip);
        const box = chip.getBoundingClientRect();
        const border = parseFloat(style.borderLeftWidth);
        const paddingBoxRight = box.right - border;
        const number = chip.querySelector(".rtc-room-value-num");
        const unit = chip.querySelector(".rtc-room-value-unit").getBoundingClientRect();
        const short = chip.querySelector(".rtc-room-short");
        const mark = chip.querySelector(".rtc-room-mark").getBoundingClientRect();
        return {
          valueSlack: Math.min(tightest.valueSlack, paddingBoxRight - unit.right),
          labelSlack: Math.min(tightest.labelSlack, paddingBoxRight - mark.right, mark.left - short.getBoundingClientRect().right),
          cut: tightest.cut || cut(number) || cut(short),
          text: chip.querySelector(".rtc-room-value").textContent,
        };
      },
      { valueSlack: Infinity, labelSlack: Infinity, cut: false, text: "" }
    );
  }, cardId);
}

function fits(chip) {
  return chip.valueSlack >= -FIT_TOLERANCE_PX && chip.labelSlack >= -FIT_TOLERANCE_PX && !chip.cut;
}

test("the glyph table holds Roboto's advance widths at the weights the chips are drawn with", async ({ page }) => {
  await gotoHarness(page);
  const rooms = roomsOf(1);
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, statesOf({ attributes: A.TEMPERATURE_C }, rooms, [21.5]), "de");
  const deviations = await page.evaluate(async (id) => {
    const { GLYPH_ADVANCE_EM } = await import("/src/presentation/view-model/room-chip-metrics.js");
    const chip = document.getElementById(id).shadowRoot.querySelector(".rtc-room-chip");
    const roles = { value: ".rtc-room-value-num", unit: ".rtc-room-value-unit", label: ".rtc-room-short" };
    const size = 1000;
    const found = {};
    for (const [role, selector] of Object.entries(roles)) {
      const drawn = getComputedStyle(chip.querySelector(selector));
      await document.fonts.load(`${drawn.fontWeight} ${size}px ${drawn.fontFamily}`, Object.keys(GLYPH_ADVANCE_EM[role]).join(""));
      for (const [character, advance] of Object.entries(GLYPH_ADVANCE_EM[role])) {
        const span = document.createElement("span");
        span.textContent = character;
        span.style.cssText = `position:absolute;white-space:pre;font-family:${drawn.fontFamily};font-weight:${drawn.fontWeight};font-variant-numeric:${drawn.fontVariantNumeric};font-size:${size}px;letter-spacing:0`;
        document.body.appendChild(span);
        const measured = span.getBoundingClientRect().width / size;
        span.remove();
        found[`${role} ${JSON.stringify(character)}`] = { table: advance, measured };
      }
    }
    return found;
  }, cardId);
  expect(Object.keys(deviations).length).toBeGreaterThan(30);
  for (const [glyph, { table, measured }] of Object.entries(deviations)) {
    expect(Math.abs(table - measured), `${glyph}: table ${table} em, Roboto ${measured} em`).toBeLessThanOrEqual(GLYPH_TOLERANCE_EM);
  }
});

for (const scenario of SCENARIOS) {
  test(`${scenario.name}: the computed chips per row hold the widest typical reading and a two-letter code, one more does not`, async ({ page }) => {
    await gotoHarness(page);
    const language = scenario.language ?? "de";
    const { columns, values } = await typicalRow(page, scenario);

    // (b) The computed count, in the automatic layout, from the reference width up.
    const rooms = roomsOf(columns);
    const cardId = await createCard(page, { entity: "sensor.avg", rooms, room_sort: "configured", ...scenario.config }, statesOf(scenario, rooms, values), language);
    for (const width of WIDTHS) {
      await setCardWidth(page, cardId, width);
      const card = page.locator(`#${cardId}`);
      expect(await card.locator(".rtc-room-row").count(), `${columns} chips are one row at ${width}px`).toBe(1);
      const chip = await tightestChip(page, cardId);
      expect(fits(chip), `${columns} chips at ${width}px: ${JSON.stringify(chip)}`).toBe(true);
    }

    // (c) One chip more, forced into the row, does not fit where the computation is bound.
    const more = roomsOf(columns + 1);
    const moreId = await createCard(page, { entity: "sensor.avg", rooms: more, room_columns: columns + 1, room_sort: "configured", ...scenario.config }, statesOf(scenario, more, values), language);
    const bound = [];
    for (const width of [REFERENCE_WIDTH, WIDE_START]) {
      await setCardWidth(page, moreId, width);
      bound.push({ width, ...(await tightestChip(page, moreId)) });
    }
    expect(bound.some((chip) => !fits(chip)), `${columns + 1} chips must not fit at both ${REFERENCE_WIDTH}px and ${WIDE_START}px: ${JSON.stringify(bound)}`).toBe(true);
  });
}

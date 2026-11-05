"use strict";

// The `size` option drawn in Chromium: the card measures its own width (ResizeObserver) and draws
// the size that width allows. Across sizes, widths, views and languages nothing is cut, spills or
// overlaps — only the labels the card always lets ellipsize may — a reading stays below the
// headline where the rooms keep below the panel, and a sized card reads clearly larger than the
// drawn one. Without a size the stylesheet never depends on the width. The resolution itself is
// test/unit/presentation/card-size.test.js; see internal dev doc §5 "Kartengröße".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const ROOMS = [
  { name: "Bedroom", short: "BE", value: 20.6 },
  { name: "Living Room", short: "LR", value: 21.8 },
  { name: "Kitchen", short: "KI", value: 22.4 },
  { name: "Office", short: "OF", value: 23.1 },
  { name: "Bathroom", short: "BA", value: 24.0 },
  { name: "Hallway", short: "HW", value: 21.2 },
  { name: "Guest Room", short: "GU", value: 22.9 },
];
const SIZES = {
  small: "small",
  medium: "medium",
  large: "large",
  "large, fixed": { header: "large", panel: "large", rooms: "large", dynamic: false },
  "rooms large": { rooms: "large" },
};
const WIDTHS = [320, 375, 400, 440, 500, 600];
// The labels the card lets ellipsize at any size; a value, a unit, the title and the pill never.
const ELLIPSIS_ALLOWED = [".rtc-subtitle", ".rtc-avg-label", ".rtc-extreme-label", ".rtc-extreme-name", ".rtc-scale-footer", ".rtc-scale-labels span", ".rtc-scale-comfort-label", ".rtc-room-short:not([data-short-guaranteed])"];

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

function heroCard(size, extra = {}) {
  const states = { "sensor.house": mkStateObj("sensor.house", 22.4, TEMPERATURE_C) };
  const rooms = ROOMS.map((room, i) => {
    states[`sensor.r${i}`] = mkStateObj(`sensor.r${i}`, room.value, TEMPERATURE_C);
    return { entity: `sensor.r${i}`, name: room.name, short: room.short };
  });
  return { config: { entity: "sensor.house", rooms, auto_slide: false, size, ...extra }, states };
}

// Everything a reader would call cut or broken, and the font sizes the hierarchy is about.
async function inspect(page, cardId) {
  return page.evaluate(({ id, allowed }) => {
    const root = document.getElementById(id).shadowRoot;
    const name = (el) => (typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : el.tagName);
    const defects = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("[hidden]") || el.tagName === "STYLE") continue;
      const style = getComputedStyle(el);
      if (style.display === "none") continue;
      const text = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim();
      if (!text) continue;
      if (el.scrollWidth > el.clientWidth + 0.5 && !(style.textOverflow === "ellipsis" && allowed.some((selector) => el.matches(selector)))) {
        defects.push(`${name(el)} "${text}" does not fit`);
      }
      let clip = el.parentElement;
      while (clip && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement;
      if (clip) {
        const box = el.getBoundingClientRect();
        const bounds = clip.getBoundingClientRect();
        if (Math.max(bounds.left - box.left, box.right - bounds.right) > 0.5) defects.push(`${name(el)} "${text}" leaves its box`);
      }
    }
    const parts = [".rtc-icon-badge", ".rtc-title", ".rtc-status-pill"].map((selector) => root.querySelector(selector).getBoundingClientRect());
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const [a, b] = [parts[i], parts[j]];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) defects.push("header parts overlap");
      }
    }
    const font = (selector) => parseFloat(getComputedStyle(root.querySelector(selector)).fontSize);
    return {
      defects,
      roomValue: font(".rtc-room-value"),
      headline: font(".rtc-avg-value"),
      roomLabel: font(".rtc-room-short"),
      entityLabel: font(".rtc-avg-label"),
      css: root.querySelector("style").textContent,
      rows: [...root.querySelectorAll(".rtc-room-row")].map((row) => row.querySelectorAll(".rtc-room-chip").length),
    };
  }, { id: cardId, allowed: ELLIPSIS_ALLOWED });
}

for (const language of ["en", "de"]) {
  for (const view of ["scale", "extremes"]) {
    test(`${language}, ${view}: every size draws without a cut, spilling or overlapping text at ${WIDTHS.join(", ")} px`, async ({ page }) => {
      await gotoHarness(page);
      for (const [label, size] of Object.entries(SIZES)) {
        const { config, states } = heroCard(size, { views: [view] });
        const cardId = await createCard(page, config, states, language);
        for (const width of WIDTHS) {
          await setCardWidth(page, cardId, width);
          const drawn = await inspect(page, cardId);
          // The drawn card has always run out of room for seven chips below 360 px; a size does not.
          const defects = label === "small" && width < 360 ? [] : drawn.defects;
          expect(defects, `${label} at ${width} px`).toEqual([]);
          if (label !== "rooms large") {
            expect(drawn.roomValue, `${label} at ${width} px: the reading below the headline`).toBeLessThan(drawn.headline);
            expect(drawn.roomLabel, `${label} at ${width} px: the short code at the entity label`).toBeLessThanOrEqual(drawn.entityLabel * 1.1 + 0.01);
          }
        }
        await page.evaluate((id) => document.getElementById(id).remove(), cardId);
      }
    });
  }
}

test("medium and large read clearly larger than the drawn card at every common width", async ({ page }) => {
  await gotoHarness(page);
  const cards = {};
  for (const label of ["small", "medium", "large"]) {
    const { config, states } = heroCard(SIZES[label]);
    cards[label] = await createCard(page, config, states);
  }
  for (const width of [375, 400, 440]) {
    const drawn = {};
    for (const [label, cardId] of Object.entries(cards)) {
      await setCardWidth(page, cardId, width);
      drawn[label] = await inspect(page, cardId);
    }
    for (const label of ["medium", "large"]) {
      expect(drawn[label].roomValue, `${label} at ${width} px: the readings`).toBeGreaterThanOrEqual(1.3 * drawn.small.roomValue);
      expect(drawn[label].headline, `${label} at ${width} px: the headline`).toBeGreaterThan(drawn.small.headline);
    }
    expect(drawn.large.headline, `at ${width} px: large at least as large as medium`).toBeGreaterThanOrEqual(drawn.medium.headline);
  }
});

test("a sized card draws again for a new width; without a size the stylesheet never depends on it", async ({ page }) => {
  await gotoHarness(page);
  const sized = heroCard("large");
  const sizedId = await createCard(page, sized.config, sized.states);
  await setCardWidth(page, sizedId, 375);
  const narrow = await inspect(page, sizedId);
  await setCardWidth(page, sizedId, 600);
  const wide = await inspect(page, sizedId);
  expect(wide.headline).toBeGreaterThan(narrow.headline);
  expect(wide.css).not.toBe(narrow.css);

  const drawn = heroCard(undefined);
  const drawnId = await createCard(page, drawn.config, drawn.states);
  await setCardWidth(page, drawnId, 375);
  const before = await inspect(page, drawnId);
  await setCardWidth(page, drawnId, 600);
  const after = await inspect(page, drawnId);
  expect(after.css).toBe(before.css);
  expect(after.rows).toEqual(before.rows);
});

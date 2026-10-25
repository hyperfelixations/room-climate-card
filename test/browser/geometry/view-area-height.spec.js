"use strict";

// The view area: every view registers a height, the area takes the tallest active one, and every
// slot inside it — rotator, track, slide, view root, metric card — fills exactly that height. A
// narrow card adds the panel's fixed allowance. A taller area is driven through the two tokens on
// the host, which outrank the card's own `:host` rule, to show that the shipped 70px views fill
// and stay centred in a taller area. Boundary: label containment at narrow widths is
// narrow-width-overflow.spec.js; the height rules themselves are render-shell.test.js. See
// internal dev doc §5 "View-System, Verfügbarkeit und Registry".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth, waitForStableLayout } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// A minimal display:block `ha-card` stand-in so the @container breakpoints are testable —
// see internal dev doc §4 "ha-card im Offline-Harness".
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

const VIEW_TYPES = ["range", "range_scale", "scale", "extremes"];
const VIEW_ROOT = {
  range: ".rtc-range-view",
  range_scale: ".rtc-range-scale-view",
  scale: ".rtc-scale-view",
  extremes: ".rtc-extremes-view",
};

// The container is ha-card's content box, the card width less its 1px border on each side: 363
// is the narrowest card above the 360px breakpoint, 362 the widest at it.
const WIDTHS = [
  { width: 400, height: 70 },
  { width: 363, height: 70 },
  { width: 362, height: 74 },
  { width: 320, height: 74 },
];

const STATES = {
  "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
  "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 26 }),
  "sensor.r1": mkStateObj("sensor.r1", 20, TEMPERATURE_C),
  "sensor.r2": mkStateObj("sensor.r2", 24, TEMPERATURE_C),
};

function configFor(types) {
  return {
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    auto_slide: false,
    views: types.map((type) => ({ type, enabled: true })),
  };
}

// Every slot's height, keyed by what it is.
async function slotHeights(page, cardId) {
  return page.evaluate(
    ({ cardId, roots }) => {
      const shadow = document.getElementById(cardId).shadowRoot;
      const heights = {};
      const record = (label, nodes) => {
        nodes.forEach((node, index) => {
          heights[`${label}[${index}]`] = node.getBoundingClientRect().height;
        });
      };
      record(".rtc-rotator", shadow.querySelectorAll(".rtc-rotator, .rtc-rotator-solo"));
      record(".rtc-track", shadow.querySelectorAll(".rtc-track"));
      record(".rtc-view", shadow.querySelectorAll(".rtc-view"));
      for (const selector of Object.values(roots)) record(selector, shadow.querySelectorAll(selector));
      record(".rtc-extreme-card", shadow.querySelectorAll(".rtc-extreme-card"));
      return heights;
    },
    { cardId, roots: VIEW_ROOT }
  );
}

function expectAll(heights, expected, label) {
  expect(Object.keys(heights).length, `${label}: slots were measured`).toBeGreaterThan(0);
  for (const [slot, height] of Object.entries(heights)) {
    expect(height, `${label}: ${slot}`).toBeCloseTo(expected, 1);
  }
}

test.describe("every slot fills the registered view-area height", () => {
  for (const { width, height } of WIDTHS) {
    for (const type of VIEW_TYPES) {
      test(`${type} alone at ${width}px is ${height}px`, async ({ page }) => {
        await gotoHarness(page);
        const cardId = await createCard(page, configFor([type]), STATES);
        await setCardWidth(page, cardId, width);
        const heights = await slotHeights(page, cardId);
        expect(Object.keys(heights)).toContain(`${VIEW_ROOT[type]}[0]`);
        expectAll(heights, height, `${type} at ${width}px`);
      });
    }

    test(`all four views in the carousel at ${width}px are ${height}px`, async ({ page }) => {
      await gotoHarness(page);
      const cardId = await createCard(page, configFor(VIEW_TYPES), STATES);
      await setCardWidth(page, cardId, width);
      const heights = await slotHeights(page, cardId);
      expect(Object.keys(heights).filter((slot) => slot.startsWith(".rtc-view["))).toHaveLength(4);
      expectAll(heights, height, `carousel at ${width}px`);
    });
  }
});

test.describe("a taller view area", () => {
  async function tallCard(page, types, width) {
    await gotoHarness(page);
    const cardId = await createCard(page, configFor(types), STATES);
    await page.evaluate((cardId) => {
      const el = document.getElementById(cardId);
      el.style.setProperty("--rtc-view-height", "140px");
      el.style.setProperty("--rtc-view-height-narrow", "144px");
    }, cardId);
    await setCardWidth(page, cardId, width);
    await waitForStableLayout(page, cardId, width);
    return cardId;
  }

  test("is filled by every view, at normal and at narrow width", async ({ page }) => {
    let cardId = await tallCard(page, VIEW_TYPES, 400);
    expectAll(await slotHeights(page, cardId), 140, "carousel at 400px");
    cardId = await tallCard(page, VIEW_TYPES, 320);
    expectAll(await slotHeights(page, cardId), 144, "carousel at 320px");
  });

  test("keeps the scale and the large value vertically centred", async ({ page }) => {
    const cardId = await tallCard(page, ["scale"], 400);
    const offsets = await page.evaluate((cardId) => {
      const shadow = document.getElementById(cardId).shadowRoot;
      const centre = (rect) => rect.top + rect.height / 2;
      const view = shadow.querySelector(".rtc-scale-view").getBoundingClientRect();
      const children = [...shadow.querySelector(".rtc-scale-view").children].map((node) => node.getBoundingClientRect());
      const top = Math.min(...children.map((rect) => rect.top));
      const bottom = Math.max(...children.map((rect) => rect.bottom));
      const rotator = shadow.querySelector(".rtc-rotator-solo").getBoundingClientRect();
      const average = shadow.querySelector(".rtc-average").getBoundingClientRect();
      return {
        above: top - view.top,
        below: view.bottom - bottom,
        averageOffset: centre(average) - centre(rotator),
      };
    }, cardId);
    expect(offsets.above).toBeGreaterThan(20);
    expect(offsets.above).toBeCloseTo(offsets.below, 0);
    expect(Math.abs(offsets.averageOffset)).toBeLessThanOrEqual(0.5);
  });
});

"use strict";

// Narrow-width containment, three contracts: all carousel views share the responsive
// height, extreme labels keep their ellipsis policy, and realistic room values stay fully
// legible. Room values cannot be truncated, so metric-specific auto-max-columns must add
// rows when horizontal space runs short. Boundary: this file's three contracts only;
// randomized-geometry.spec.js is the generic overflow sweep.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { CO2, PM25, TEMPERATURE_C } = require("../../fixtures/attributes.js");

const WIDTHS = [280, 300, 320, 360, 460, 700];
// A curated subset (`test/architecture/suite-structure.test.js` allows one), not the
// manifest's fifteen: the typographic extremes — longest German compounds, Polish and
// Russian case endings, Latvian unit words — that make a 280 px card overflow.
const LANGUAGES = ["en", "de", "pl", "ru", "lv"];

// A minimal display:block `ha-card` stand-in so the @container breakpoints are testable —
// see interne Doku §4 "`ha-card` im Offline-Harness".
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

// Only the three classes this file's contracts cover. Excludes .rtc-track-nested nodes
// (like randomized-geometry.spec.js): non-active carousel slides sit outside the visible
// card via the track transform, clipped by .rtc-rotator — normal, not a bug.
async function overflowingTargetElements(page, cardId) {
  return page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    const cardRect = el.getBoundingClientRect();
    const selectors = [".rtc-range-scale-view", ".rtc-extreme-label", ".rtc-room-value", ".rtc-room-value-num", ".rtc-avg-value"];
    const bad = [];
    selectors.forEach((sel) => {
      el.shadowRoot.querySelectorAll(sel).forEach((node) => {
        if (node.closest(".rtc-track")) return;
        const r = node.getBoundingClientRect();
        if (r.width > 0 && (r.right > cardRect.right + 0.5 || r.left < cardRect.left - 0.5)) {
          bad.push({ sel, left: r.left, right: r.right, cardLeft: cardRect.left, cardRight: cardRect.right });
        }
      });
    });
    return bad;
  }, cardId);
}

function soloViewConfig(type, extra) {
  return { views: [{ type, enabled: true }], ...extra };
}

function carouselConfig(types, extra) {
  return { views: types.map((type) => ({ type, enabled: true })), ...extra };
}

const RANGE_SCALE_EXTRA = {
  range_entity: "sensor.range",
};

function baseStates() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 26 }),
    "sensor.r1": mkStateObj("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 24, TEMPERATURE_C),
  };
}

const ROOMS = [
  { entity: "sensor.r1", name: "Wohnzimmer" },
  { entity: "sensor.r2", name: "Schlafzimmer" },
];

test.describe(".rtc-range-scale-view follows shared narrow-width height rules", () => {
  test("solo range_scale view at 360px matches .rtc-scale-view's 74px narrow height (no longer 70px)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.avg", ...RANGE_SCALE_EXTRA, ...soloViewConfig("range_scale") }, baseStates());
    await setCardWidth(page, cardId, 360);
    const card = page.locator(`#${cardId}`);
    const box = await card.locator(".rtc-range-scale-view").boundingBox();
    expect(box.height, "range_scale must pick up the 74px narrow-width height, matching scale/extremes/range").toBeCloseTo(74, 0);
  });

  test("range_scale in a carousel with scale at 360px: both views share the exact same height (no ~4px gap)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", rooms: ROOMS, ...RANGE_SCALE_EXTRA, ...carouselConfig(["range_scale", "scale", "extremes"]) },
      baseStates()
    );
    await setCardWidth(page, cardId, 360);
    const card = page.locator(`#${cardId}`);
    const rangeScaleBox = await card.locator(".rtc-range-scale-view").boundingBox();
    const scaleBox = await card.locator(".rtc-scale-view").boundingBox();
    expect(rangeScaleBox.height).toBeCloseTo(74, 0);
    expect(rangeScaleBox.height, "range_scale and scale must render at the identical height inside the same carousel").toBeCloseTo(scaleBox.height, 0);
  });

  // The `@supports not (container-type: inline-size)` fallback block is inert in every
  // browser this suite runs (Chromium always supports container queries), so no test here
  // can exercise it; its CSS mirrors the @container block above property for property.
});

test.describe(".rtc-extreme-label keeps ellipsis at narrow widths", () => {
  for (const width of [460, 600]) {
    test(`computed overflow/text-overflow stay hidden/ellipsis at ${width}px (regression for the removed override)`, async ({ page }) => {
      await gotoHarness(page);
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: ROOMS, ...carouselConfig(["extremes", "scale"]) }, baseStates());
      if (width === 600) await page.setViewportSize({ width: 600, height: 720 });
      await setCardWidth(page, cardId, width === 600 ? 599 : width);
      const card = page.locator(`#${cardId}`);
      const style = await card.locator(".rtc-extreme-label").first().evaluate((node) => {
        const computed = getComputedStyle(node);
        return { overflow: computed.overflowX, textOverflow: computed.textOverflow };
      });
      expect(style.overflow, `at ${width}px, .rtc-extreme-label must stay overflow:hidden`).toBe("hidden");
      expect(style.textOverflow, `at ${width}px, .rtc-extreme-label must stay text-overflow:ellipsis`).toBe("ellipsis");
    });
  }

  test("an artificially long label visibly ellipsizes and stays within its card's bounds at 460px", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: ROOMS, ...carouselConfig(["extremes", "scale"]) }, baseStates());
    await setCardWidth(page, cardId, 460);
    const card = page.locator(`#${cardId}`);
    const cardEl = card.locator(".rtc-extreme-card").first();
    await card.locator(".rtc-extreme-label").first().evaluate((node) => {
      node.textContent = "Ein garantiert viel zu langes Label das niemals in diese schmale Karte passt";
    });
    const cardBox = await cardEl.boundingBox();
    const labelBox = await card.locator(".rtc-extreme-label").first().boundingBox();
    expect(labelBox.x + labelBox.width, "the overlong label must not overflow its card's right edge").toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
    const clipped = await card.locator(".rtc-extreme-label").first().evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(clipped, "ellipsis must actually engage (scrollWidth > clientWidth), not just avoid overflow by luck").toBe(true);
  });
});

// A single-room card captions itself with the room's own name, which the user writes, so
// .rtc-avg-label must clip and ellipsize like every other single-line label rather than
// painting across the scale beside it.
test.describe(".rtc-avg-label stays inside its column whatever the room is called", () => {
  const LONG_NAME = "DASISTEINETESTKONFIGURATION";
  const singleRoomStates = () => ({
    "sensor.az": mkStateObj("sensor.az", 28.6, TEMPERATURE_C),
  });

  for (const width of [320, 400, 600]) {
    test(`an overlong room name is clipped rather than painted over the view at ${width}px`, async ({ page }) => {
      await gotoHarness(page);
      const cardId = await createCard(page, { rooms: [{ entity: "sensor.az", name: LONG_NAME }] }, singleRoomStates());
      await setCardWidth(page, cardId, width);
      const label = page.locator(`#${cardId}`).locator(".rtc-avg-label");
      await expect(label).toHaveText(LONG_NAME);

      const measured = await label.evaluate((node) => {
        const computed = getComputedStyle(node);
        const column = node.closest(".rtc-average") || node.parentElement;
        return {
          overflow: computed.overflowX,
          textOverflow: computed.textOverflow,
          clipped: node.scrollWidth > node.clientWidth,
          right: node.getBoundingClientRect().right,
          columnRight: column.getBoundingClientRect().right,
        };
      });

      // overflow:hidden stops the paint; the ellipsis makes the truncation legible.
      expect(measured.overflow, "the caption must clip its own overflow").toBe("hidden");
      expect(measured.textOverflow, "a clipped caption must end in an ellipsis").toBe("ellipsis");
      expect(measured.clipped, "this name must genuinely be too long, or the test proves nothing").toBe(true);
      expect(measured.right, "the caption box must not reach past its column").toBeLessThanOrEqual(measured.columnRight + 0.5);
    });
  }

  test("a room name that fits is not truncated", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(page, { rooms: [{ entity: "sensor.az", name: "Bad" }] }, singleRoomStates());
    await setCardWidth(page, cardId, 400);
    const clipped = await page
      .locator(`#${cardId}`)
      .locator(".rtc-avg-label")
      .evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(clipped, "a short caption must render in full — the fix must not shorten what already fits").toBe(false);
  });
});

test.describe("room-value-legibility fix: .rtc-room-value-num never ellipsizes realistic CO2/PM2.5 values", () => {
  // Realistic values only (room-value-legibility.spec.js has the full matrix): natural
  // width is guaranteed by metric-specific auto-max-columns (5/row for CO2/PM2.5), not by
  // ellipsis as a safety net.
  function coHass() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 1200, CO2),
      "sensor.r1": mkStateObj("sensor.r1", 800, CO2),
      "sensor.r2": mkStateObj("sensor.r2", 1200, CO2),
      "sensor.r3": mkStateObj("sensor.r3", 2000, CO2),
      "sensor.r4": mkStateObj("sensor.r4", 950, CO2),
    };
  }
  function pm25Hass() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 24.6, PM25),
      "sensor.r1": mkStateObj("sensor.r1", 8.3, PM25),
      "sensor.r2": mkStateObj("sensor.r2", 24.6, PM25),
      "sensor.r3": mkStateObj("sensor.r3", 41.2, PM25),
      "sensor.r4": mkStateObj("sensor.r4", 15.9, PM25),
    };
  }
  // 4 rooms stays within CO2/PM2.5's autoMaxColumns=5 (single row, tightest realistic
  // per-chip width in automatic mode).
  const roomsFor4 = [
    { entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }, { entity: "sensor.r4" },
  ];

  // CSS ellipsis leaves textContent untouched, so assertions are geometric/computed-style.
  async function assertNoEllipsis(chip, width, language) {
    const chipBox = await chip.boundingBox();
    const numLoc = chip.locator(".rtc-room-value-num");
    const unitLoc = chip.locator(".rtc-room-value-unit");
    const numBox = await numLoc.boundingBox();
    const unitBox = await unitLoc.boundingBox();
    expect(numBox.x + numBox.width, `number must stay inside the chip at ${width}px/${language}`).toBeLessThanOrEqual(chipBox.x + chipBox.width + 0.5);
    expect(unitBox.x + unitBox.width, `unit must stay inside the chip at ${width}px/${language}`).toBeLessThanOrEqual(chipBox.x + chipBox.width + 0.5);
    expect(numBox.x + numBox.width, `number and unit must not overlap at ${width}px/${language}`).toBeLessThanOrEqual(unitBox.x + 0.5);
    const info = await numLoc.evaluate((node) => ({
      fits: node.scrollWidth <= node.clientWidth + 0.5,
      textOverflow: getComputedStyle(node).textOverflow,
    }));
    expect(info.fits, `value text must fully fit its box at ${width}px/${language} (scrollWidth<=clientWidth)`).toBe(true);
    expect(info.textOverflow, `a realistic value must never engage ellipsis at ${width}px/${language}`).not.toBe("ellipsis");
  }

  for (const width of [320, 360, 460]) {
    for (const language of LANGUAGES) {
      test(`CO2 realistic values (800/1.200/2.000 ppm) never ellipsize at ${width}px, language=${language}`, async ({ page }) => {
        await gotoHarness(page);
        const cardId = await createCard(page, { entity: "sensor.avg", rooms: roomsFor4 }, coHass(), language);
        await setCardWidth(page, cardId, width);
        const card = page.locator(`#${cardId}`);
        for (const chip of await card.locator(".rtc-room-chip").all()) {
          await assertNoEllipsis(chip, width, language);
        }
      });

      test(`PM2.5 realistic values (µg/m³) never ellipsize at ${width}px, language=${language}`, async ({ page }) => {
        await gotoHarness(page);
        const cardId = await createCard(page, { entity: "sensor.avg", rooms: roomsFor4 }, pm25Hass(), language);
        await setCardWidth(page, cardId, width);
        const card = page.locator(`#${cardId}`);
        for (const chip of await card.locator(".rtc-room-chip").all()) {
          await assertNoEllipsis(chip, width, language);
        }
      });
    }
  }
});

test.describe("every view avoids unintended overflow across widths", () => {
  const viewTypes = ["scale", "range_scale", "extremes", "range"];

  for (const width of WIDTHS) {
    test(`solo views at ${width}px`, async ({ page }) => {
      await gotoHarness(page);
      for (const type of viewTypes) {
        const cardId = await createCard(
          page,
          { entity: "sensor.avg", rooms: ROOMS, ...RANGE_SCALE_EXTRA, ...soloViewConfig(type) },
          baseStates()
        );
        await setCardWidth(page, cardId, width);
        const bad = await overflowingTargetElements(page, cardId);
        expect(bad, `view="${type}" at ${width}px: ${JSON.stringify(bad)}`).toHaveLength(0);
      }
    });

    test(`carousel (all four views) at ${width}px`, async ({ page }) => {
      await gotoHarness(page);
      const cardId = await createCard(
        page,
        { entity: "sensor.avg", rooms: ROOMS, ...RANGE_SCALE_EXTRA, ...carouselConfig(viewTypes) },
        baseStates()
      );
      await setCardWidth(page, cardId, width);
      const bad = await overflowingTargetElements(page, cardId);
      expect(bad, `carousel at ${width}px: ${JSON.stringify(bad)}`).toHaveLength(0);
    });
  }
});

// The headline value must never paint over its neighbour. The column sizes itself to its
// content, from the old 106px cap as a floor, growing only as far as leaving the view 40%
// of the panel allows. These tests hold both halves: no overflow anywhere, and no change
// for values that already fit.
test.describe(".rtc-avg-value stays inside its column", () => {
  // Realistic readings per metric spanning the digit counts each produces. `-12.5 °C` is
  // here because it overflowed too.
  const HEADLINE_CASES = [
    ["temperature", "°C", [22.2, -12.5, -19.9]],
    ["humidity", "%", [55.4, 100]],
    ["carbon_dioxide", "ppm", [800, 1273, 2252, 5000]],
    ["pm25", "µg/m³", [8.2, 23.5, 118.4, 999.9]],
  ];

  function headlineStates(value, deviceClass, unit, withPrimary) {
    const attributes = { device_class: deviceClass, unit_of_measurement: unit };
    const states = {
      "sensor.r1": mkStateObj("sensor.r1", value, attributes),
      "sensor.r2": mkStateObj("sensor.r2", value, attributes),
    };
    if (withPrimary) states["sensor.avg"] = mkStateObj("sensor.avg", value, attributes);
    return states;
  }

  // The panel content box and how the two grid tracks divide it, read from the live grid
  // so the assertion survives a padding or gap change.
  async function panelColumns(page, cardId) {
    return page.evaluate((cardId) => {
      const root = document.getElementById(cardId).shadowRoot;
      const panel = root.querySelector(".rtc-main-panel");
      const computed = getComputedStyle(panel);
      const tracks = computed.gridTemplateColumns.split(" ").map(parseFloat);
      const value = root.querySelector(".rtc-avg-value");
      return {
        headline: tracks[0],
        view: tracks[1],
        content: panel.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight),
        overflow: value.scrollWidth - value.clientWidth,
      };
    }, cardId);
  }

  for (const [deviceClass, unit, values] of HEADLINE_CASES) {
    for (const value of values) {
      // Both headline shapes: the button branch is the harder one, so the consensus branch
      // is checked too, not assumed.
      for (const withPrimary of [true, false]) {
        test(`${value} ${unit} never overflows its column (${withPrimary ? "main entity" : "calculated"})`, async ({ page }) => {
          await gotoHarness(page);
          for (const width of WIDTHS) {
            const config = { rooms: ROOMS };
            if (withPrimary) config.entity = "sensor.avg";
            const cardId = await createCard(page, config, headlineStates(value, deviceClass, unit, withPrimary));
            await setCardWidth(page, cardId, width);
            const measured = await panelColumns(page, cardId);
            expect(
              measured.overflow,
              `${value} ${unit} at ${width}px paints ${measured.overflow}px past its column`
            ).toBeLessThanOrEqual(0);
            await page.evaluate((id) => document.getElementById(id).remove(), cardId);
          }
        });
      }
    }
  }

  // The other half: a value that fits must produce the same column at every breakpoint.
  // `22.2 °C` is the canonical reading and sits inside the floor.
  test("a value that already fits leaves the column at its documented width", async ({ page }) => {
    await gotoHarness(page);
    const expected = { 320: 90, 400: 96, 520: 106 };
    for (const [width, headline] of Object.entries(expected)) {
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: ROOMS }, headlineStates(22.2, "temperature", "°C", true));
      await setCardWidth(page, cardId, Number(width));
      const measured = await panelColumns(page, cardId);
      expect(measured.headline, `at ${width}px the headline column must stay ${headline}px`).toBeCloseTo(headline, 1);
      await page.evaluate((id) => document.getElementById(id).remove(), cardId);
    }
  });

  // Without an upper bound a broken sensor could evict the view; instead the value clips —
  // a nine-digit CO2 reading is not a reading.
  test("a runaway reading cannot push the view below 40% of the panel", async ({ page }) => {
    await gotoHarness(page);
    for (const width of WIDTHS) {
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: ROOMS }, headlineStates(123456789, "carbon_dioxide", "ppm", true));
      await setCardWidth(page, cardId, width);
      const measured = await panelColumns(page, cardId);
      expect(
        measured.view,
        `at ${width}px the view kept only ${Math.round(measured.view)}px of a ${Math.round(measured.content)}px panel`
      ).toBeGreaterThanOrEqual(measured.content * 0.4 - 0.5);
      await page.evaluate((id) => document.getElementById(id).remove(), cardId);
    }
  });

  // The caption ellipsizes (describe above) and must not widen the column the value sizes:
  // without inline-size containment on .rtc-avg-label a long room name would drag it open.
  test("an overlong caption does not widen the column the value sizes", async ({ page }) => {
    await gotoHarness(page);
    const expected = { 320: 90, 400: 96, 520: 106 };
    for (const [width, headline] of Object.entries(expected)) {
      const cardId = await createCard(
        page,
        { rooms: [{ entity: "sensor.az", name: "DASISTEINETESTKONFIGURATION" }] },
        { "sensor.az": mkStateObj("sensor.az", 28.6, TEMPERATURE_C) }
      );
      await setCardWidth(page, cardId, Number(width));
      const measured = await panelColumns(page, cardId);
      expect(measured.headline, `at ${width}px an overlong caption must leave the column at ${headline}px`).toBeCloseTo(headline, 1);
      await page.evaluate((id) => document.getElementById(id).remove(), cardId);
    }
  });
});

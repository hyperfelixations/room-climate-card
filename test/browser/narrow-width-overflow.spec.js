"use strict";

// Narrow-width coverage spans three distinct containment contracts: all carousel
// views share the responsive height, extreme labels retain their ellipsis policy,
// and realistic room values remain fully legible. Room values are non-truncatable
// information, so metric-specific auto-max-columns must create additional rows when
// horizontal space is insufficient.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../helpers/browser-helpers");

const WIDTHS = [280, 300, 320, 360, 460, 700];
const LANGUAGES = ["en", "de", "pl", "ru", "lv"];

// ha-card is never registered as a custom element in the shared offline
// harness (no real Home Assistant frontend loaded), so it defaults to
// display:inline -- CSS Containment has no effect on inline boxes, so every
// @container rtc-card (...) rule in room-climate-card.js's styles (which
// this file specifically exercises at 360px and the 460px
// breakpoint fixes) would silently never match, regardless of the card's
// actual rendered width. Registering a minimal stand-in (mirroring just
// real HA's ha-card display:block) makes those breakpoints testable.
// Scoped to this file via addInitScript rather than editing the shared
// harness.html, since that would also change every OTHER spec's layout and
// invalidate their golden screenshots.
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

// Checks only the three classes whose containment contracts this file covers:
// deliberately narrower than randomized-geometry.spec.js's generic sweep so
// this file's intent (and any future failure) stays unambiguous. Excludes
// .rtc-track-nested nodes, same as randomized-geometry.spec.js: non-active
// carousel slides are legitimately positioned outside the visible card via
// the track's transform, clipped horizontally by .rtc-rotator's directional
// clip-path --
// that's normal carousel behavior, not a bug. The dedicated tests above
// already cover range_scale/extremes as the ACTIVE slide in a carousel.
async function overflowingTargetElements(page, cardId) {
  return page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    const cardRect = el.getBoundingClientRect();
    const selectors = [".rtc-range-scale-view", ".rtc-extreme-label", ".rtc-room-value", ".rtc-room-value-num"];
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
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 26 }),
    "sensor.r1": mkStateObj("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
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

  // The @supports not (container-type: inline-size) @media(380px) fallback
  // block (see room-climate-card.js) exists for browsers WITHOUT container
  // query support. Playwright's bundled Chromium always supports container
  // queries, so @supports not (container-type: inline-size) is permanently
  // false there -- that fallback block is provably inert in every browser
  // this test suite can run in, and no test here can genuinely exercise it
  // (forcing the viewport narrow
  // only re-triggers the SAME @container rule and would pass even if the
  // fallback block's own .rtc-range-scale-view line were missing -- a false
  // sense of coverage). Its CSS is a straight, mechanical mirror of the
  // @container block above (same properties, same selectors) and was fixed
  // in the same edit; correctness here rests on that mirroring, not on a
  // dedicated browser test.
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

test.describe("room-value-legibility fix: .rtc-room-value-num never ellipsizes realistic CO2/PM2.5 values", () => {
  // Realistic values only (see room-value-legibility.spec.js for the full
  // matrix) -- the old synthetic 7-digit stress values (1234567 ppm,
  // 999999.9 µg/m³) are no longer relevant: the design no longer relies on
  // ellipsis as a safety net for extreme/malformed readings, it relies on
  // Part B's conservative metric-specific auto-max-columns (max 5/row for
  // CO2/PM2.5) to guarantee enough natural width in the first place.
  function coHass() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 1200, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r1": mkStateObj("sensor.r1", 800, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r2": mkStateObj("sensor.r2", 1200, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r3": mkStateObj("sensor.r3", 2000, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r4": mkStateObj("sensor.r4", 950, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    };
  }
  function pm25Hass() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 24.6, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
      "sensor.r1": mkStateObj("sensor.r1", 8.3, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
      "sensor.r2": mkStateObj("sensor.r2", 24.6, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
      "sensor.r3": mkStateObj("sensor.r3", 41.2, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
      "sensor.r4": mkStateObj("sensor.r4", 15.9, { device_class: "pm25", unit_of_measurement: "µg/m³" }),
    };
  }
  // 4 rooms stays within CO2/PM2.5's autoMaxColumns=5 (single row, the
  // tightest realistic per-chip width in automatic mode).
  const roomsFor4 = [
    { entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }, { entity: "sensor.r4" },
  ];

  // CSS ellipsis leaves textContent untouched, so assertions must be
  // geometric/computed-style based, never a text-content check.
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

"use strict";

// The trend indicator, measured rather than inspected.
//
// Whether a trend is rising, stable or falling is arithmetic and is tested in the domain
// layer. What is checked here is everything that only exists once it is drawn: that the block
// without a trend keeps exactly the height it had before, that both variants stay vertically
// centred, and that switching rising to stable to falling to hidden does not move the focused
// node out from under the user.
//
// The Fahrenheit case is here for the same reason: a converted RATE is a different number
// from a converted reading, and it must appear in the scale footer and nowhere else.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, updateHass, mkStateObj } = require("../../helpers/browser-helpers");

const MODES = {
  temperature: {
    value: 22,
    trend: 0.2,
    trendText: "+0.2 °C/h",
    deviceClass: "temperature",
    unit: "°C",
  },
  humidity: {
    value: 50,
    trend: 1,
    trendText: "+1.0 %/h",
    deviceClass: "humidity",
    unit: "%",
  },
  co2: {
    value: 700,
    trend: 30,
    trendText: "+30 ppm/h",
    deviceClass: "carbon_dioxide",
    unit: "ppm",
  },
  pm25: {
    value: 8,
    trend: 1,
    trendText: "+1.0 µg/m³/h",
    deviceClass: "pm25",
    unit: "µg/m³",
  },
};

function statesFor(fx, trend = fx.trend) {
  return {
    "sensor.avg": mkStateObj("sensor.avg", fx.value, {
      device_class: fx.deviceClass,
      unit_of_measurement: fx.unit,
    }),
    "sensor.trend": mkStateObj("sensor.trend", trend, {
      unit_of_measurement: `${fx.unit}/h`,
    }),
    "sensor.r1": mkStateObj("sensor.r1", fx.value * 0.9, {
      device_class: fx.deviceClass,
      unit_of_measurement: fx.unit,
    }),
    "sensor.r2": mkStateObj("sensor.r2", fx.value * 1.1, {
      device_class: fx.deviceClass,
      unit_of_measurement: fx.unit,
    }),
  };
}

async function verifyMetricTrendLayout(page, mode, fx) {
  await gotoHarness(page);

  for (const width of [320, 400, 520]) {
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        trend_entity: "sensor.trend",
        rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
        views: [{ type: "scale" }],
        auto_slide: false,
      },
      statesFor(fx)
    );
    await page.evaluate(
      ({ cardId, width }) => {
        document.getElementById(cardId).style.width = `${width}px`;
      },
      { cardId, width }
    );
    await page.waitForTimeout(50);

    const card = page.locator(`#${cardId}`);
    const avg = card.locator(".rtc-avg-button");
    const arrow = card.locator(".rtc-avg-trend-arrow");
    const arrowSvg = card.locator(".rtc-avg-trend-arrow-svg");
    const footer = card.locator(".rtc-scale-view .rtc-scale-footer");

    await expect(avg, `${mode}/${width}: trend modifier`).toHaveClass(/rtc-has-trend/);
    await expect(avg, `${mode}/${width}: rising direction`).toHaveAttribute("data-trend-direction", "rising");
    await expect(arrow, `${mode}/${width}: arrow visible`).toBeVisible();
    await expect(arrow, `${mode}/${width}: no Unicode/emoji fallback`).toHaveText("");
    await expect(arrowSvg, `${mode}/${width}: deterministic SVG`).toBeVisible();
    await expect(arrowSvg.locator("path"), `${mode}/${width}: minimalist SVG path`).toHaveCount(1);
    await expect(avg.locator(".rtc-avg-reading"), `${mode}/${width}: no trend-only average wrapper`).toHaveCount(0);
    await expect(avg.locator(".rtc-avg-trend"), `${mode}/${width}: no visible/hidden rate in average`).toHaveCount(0);
    await expect(footer, `${mode}/${width}: rate restored to scale footer`).toContainText(`Trend ${fx.trendText}`);

    const geometry = await card.evaluate((host) => {
      const root = host.shadowRoot;
      const box = (selector) => {
        const rect = root.querySelector(selector).getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const centerX = (rect) => rect.left + rect.width / 2;
      const layoutRoot = root.querySelector(".rtc-root");
      const footerEl = root.querySelector(".rtc-scale-view .rtc-scale-footer");
      const arrowSvgEl = root.querySelector(".rtc-avg-trend-arrow-svg");
      const geometry = {
        label: box(".rtc-avg-label"),
        value: box(".rtc-avg-value"),
        unit: box(".rtc-avg-value-unit"),
        arrow: box(".rtc-avg-trend-arrow-svg"),
        footer: box(".rtc-scale-view .rtc-scale-footer"),
        scaleView: box(".rtc-scale-view"),
        button: box(".rtc-avg-button"),
        panel: box(".rtc-main-panel"),
        overflow: layoutRoot.scrollWidth - layoutRoot.clientWidth,
        footerOverflow: footerEl.scrollWidth - footerEl.clientWidth,
        arrowStrokeWidth: getComputedStyle(arrowSvgEl).strokeWidth,
      };
      return {
        ...geometry,
        arrowUnitCenterDelta: Math.abs(centerX(geometry.arrow) - centerX(geometry.unit)),
        arrowUnitGap: geometry.unit.top - geometry.arrow.bottom,
        topGap: geometry.label.top - geometry.panel.top,
        bottomGap: geometry.panel.bottom - geometry.value.bottom,
        arrowText: root.querySelector(".rtc-avg-trend-arrow").textContent.trim(),
      };
    });
    expect(geometry.arrowText, `${mode}/${width}: arrow DOM contains no text glyph`).toBe("");
    expect(geometry.arrow.top, `${mode}/${width}: arrow is visually separated below the average label`).toBeGreaterThanOrEqual(geometry.label.bottom + 1);
    expect(geometry.arrow.top, `${mode}/${width}: arrow stays inside the large-value row`).toBeGreaterThanOrEqual(geometry.value.top - 1);
    expect(geometry.arrowUnitGap, `${mode}/${width}: arrow sits exactly one optical pixel above the unit`).toBeGreaterThanOrEqual(0.5);
    expect(geometry.arrowUnitGap, `${mode}/${width}: arrow is not lifted more than one optical pixel`).toBeLessThanOrEqual(1.5);
    expect(geometry.arrowUnitCenterDelta, `${mode}/${width}: arrow centered exactly over visible unit`).toBeLessThanOrEqual(0.75);
    expect(parseFloat(geometry.arrowStrokeWidth), `${mode}/${width}: arrow uses the deliberately light 1.2px stroke`).toBeCloseTo(1.2, 2);
    expect(geometry.unit.bottom, `${mode}/${width}: unit stays inside the large-value row`).toBeLessThanOrEqual(geometry.value.bottom + 1);
    expect(Math.abs(geometry.topGap - geometry.bottomGap), `${mode}/${width}: historic label/value block remains vertically centered`).toBeLessThanOrEqual(2.1);
    expect(geometry.button.top, `${mode}/${width}: average stays inside panel`).toBeGreaterThanOrEqual(geometry.panel.top);
    expect(geometry.button.bottom, `${mode}/${width}: average stays inside panel`).toBeLessThanOrEqual(geometry.panel.bottom);
    expect(geometry.footer.left, `${mode}/${width}: clipped footer stays inside Scale view`).toBeGreaterThanOrEqual(geometry.scaleView.left - 1);
    expect(geometry.footer.right, `${mode}/${width}: clipped footer stays inside Scale view`).toBeLessThanOrEqual(geometry.scaleView.right + 1);
    if (width === 520) {
      expect(geometry.footerOverflow, `${mode}/${width}: full localized trend footer is visible at regular width`).toBeLessThanOrEqual(1);
    }
    expect(geometry.overflow, `${mode}/${width}: no horizontal overflow`).toBeLessThanOrEqual(1);

    await page.evaluate((id) => document.getElementById(id).remove(), cardId);
  }
}

for (const [mode, fx] of Object.entries(MODES)) {
  test(`trend arrow and Scale footer: ${mode} at 320px, 400px, and 520px`, async ({ page }) => {
    await verifyMetricTrendLayout(page, mode, fx);
  });
}

test("trend average layout: no-trend block stays unchanged while both variants remain vertically centered", async ({ page }) => {
  await gotoHarness(page);
  const fx = MODES.temperature;
  const configBase = {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    views: [{ type: "scale" }],
    auto_slide: false,
  };
  const withoutId = await createCard(page, configBase, statesFor(fx));
  const withId = await createCard(
    page,
    { ...configBase, trend_entity: "sensor.trend" },
    statesFor(fx)
  );
  await page.evaluate(
    ({ withoutId, withId }) => {
      document.getElementById(withoutId).style.width = "320px";
      document.getElementById(withId).style.width = "320px";
    },
    { withoutId, withId }
  );
  await page.waitForTimeout(50);

  const positions = await page.evaluate(
    ({ withoutId, withId }) => {
      const positionsFor = (id) => {
        const root = document.getElementById(id).shadowRoot;
        const panel = root.querySelector(".rtc-main-panel").getBoundingClientRect();
        const label = root.querySelector(".rtc-avg-label").getBoundingClientRect();
        const value = root.querySelector(".rtc-avg-value").getBoundingClientRect();
        const button = root.querySelector(".rtc-avg-button").getBoundingClientRect();
        return {
          label: label.top - panel.top,
          value: value.top - panel.top,
          buttonTop: button.top - panel.top,
          buttonBottom: panel.bottom - button.bottom,
          topGap: label.top - panel.top,
          bottomGap: panel.bottom - value.bottom,
          hasTrend: root.querySelector(".rtc-avg-button").classList.contains("rtc-has-trend"),
          childClasses: Array.from(root.querySelector(".rtc-avg-button").children, (child) => child.className),
          hasTrendTextNode: Boolean(root.querySelector(".rtc-avg-trend")),
          hasReadingWrapper: Boolean(root.querySelector(".rtc-avg-reading")),
        };
      };
      return { without: positionsFor(withoutId), with: positionsFor(withId) };
    },
    { withoutId, withId }
  );

  expect(positions.without.hasTrend).toBe(false);
  expect(positions.with.hasTrend).toBe(true);
  expect(positions.without.childClasses).toEqual(["rtc-avg-label", "rtc-avg-value"]);
  expect(positions.with.childClasses).toEqual(positions.without.childClasses);
  expect(positions.with.hasTrendTextNode).toBe(false);
  expect(positions.with.hasReadingWrapper).toBe(false);
  // Preserve the pre-trend optical baseline: Roboto's real glyph/baseline
  // metrics leave a stable ~2.02px difference although the CSS box itself
  // is centered. Existing no-trend goldens protect the exact pixels.
  expect(Math.abs(positions.without.topGap - positions.without.bottomGap)).toBeLessThanOrEqual(2.1);
  expect(Math.abs(positions.with.topGap - positions.with.bottomGap)).toBeLessThanOrEqual(2.1);
  for (const key of ["label", "value", "buttonTop", "buttonBottom"]) {
    expect(Math.abs(positions.with[key] - positions.without[key]), `${key}: trend must not move the historic average block`).toBeLessThanOrEqual(0.1);
  }
});

test("trend average live update preserves the focused node while changing rising → stable → falling → hidden", async ({ page }) => {
  await gotoHarness(page);
  const fx = MODES.temperature;
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      trend_entity: "sensor.trend",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "scale" }],
      auto_slide: false,
    },
    statesFor(fx)
  );

  await page.evaluate((id) => {
    const avg = document.getElementById(id).shadowRoot.querySelector("button.rtc-avg-button");
    window.__trendAverageNode = avg;
    window.__trendArrowSvgNode = avg.querySelector(".rtc-avg-trend-arrow-svg");
    avg.focus();
  }, cardId);

  const transforms = [];
  for (const [value, direction] of [
    [0, "stable"],
    [-0.2, "falling"],
  ]) {
    await updateHass(page, cardId, statesFor(fx, value));
    const card = page.locator(`#${cardId}`);
    await expect(card.locator(".rtc-avg-button")).toHaveAttribute("data-trend-direction", direction);
    await expect(card.locator(".rtc-avg-trend")).toHaveCount(0);
    await expect(card.locator(".rtc-avg-trend-arrow")).toHaveText("");
    const displayedValue = value === 0 ? "0.0 °C/h" : "-0.2 °C/h";
    await expect(card.locator(".rtc-scale-view .rtc-scale-footer")).toContainText(`Trend ${displayedValue}`);
    const state = await page.evaluate((id) => {
        const root = document.getElementById(id).shadowRoot;
        const svg = root.querySelector(".rtc-avg-trend-arrow-svg");
        return {
          identityAndFocus: root.querySelector("button.rtc-avg-button") === window.__trendAverageNode
            && svg === window.__trendArrowSvgNode
            && root.activeElement === window.__trendAverageNode,
          transform: getComputedStyle(svg).transform,
        };
      }, cardId);
    expect(state.identityAndFocus).toBe(true);
    transforms.push(state.transform);
  }
  expect(transforms[0]).not.toBe(transforms[1]);

  await updateHass(page, cardId, statesFor(fx, "unavailable"));
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-avg-button")).not.toHaveClass(/rtc-has-trend/);
  await expect(card.locator(".rtc-avg-trend")).toHaveCount(0);
  await expect(card.locator(".rtc-avg-trend-arrow")).toBeHidden();
  await expect(card.locator(".rtc-scale-view .rtc-scale-footer")).not.toContainText(/Trend|°C\/h/i);
  expect(
    await page.evaluate((id) => {
      const root = document.getElementById(id).shadowRoot;
      return root.querySelector("button.rtc-avg-button") === window.__trendAverageNode
        && root.querySelector(".rtc-avg-trend-arrow-svg") === window.__trendArrowSvgNode
        && root.activeElement === window.__trendAverageNode;
    }, cardId)
  ).toBe(true);
});

test("trend footer: Fahrenheit boundary is stable and the converted rate appears only in Scale footer", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 71.6, {
      device_class: "temperature",
      unit_of_measurement: "°F",
      spread: 3.6,
    }),
    "sensor.trend": mkStateObj("sensor.trend", 0.18, {
      unit_of_measurement: "°F/h",
    }),
    "sensor.r1": mkStateObj("sensor.r1", 69.8, {
      device_class: "temperature",
      unit_of_measurement: "°F",
    }),
    "sensor.r2": mkStateObj("sensor.r2", 73.4, {
      device_class: "temperature",
      unit_of_measurement: "°F",
    }),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      trend_entity: "sensor.trend",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "scale" }],
      auto_slide: false,
    },
    states
  );
  const card = page.locator(`#${cardId}`);
  await expect(card.locator(".rtc-avg-button")).toHaveAttribute("data-trend-direction", "stable");
  await expect(card.locator(".rtc-avg-trend")).toHaveCount(0);
  await expect(card.locator(".rtc-scale-view .rtc-scale-footer")).toContainText("Trend +0.2 °F/h");
});

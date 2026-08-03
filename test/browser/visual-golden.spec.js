"use strict";

// Visual golden tests cover desktop/mobile widths, light/dark, all four modes,
// no-data state, 1-4 views, supported languages and RangeScale collisions.
// Uses Playwright's built-in
// toHaveScreenshot(), which on the FIRST run writes baseline PNGs into
// test/browser/visual-golden.spec.js-snapshots/ (committed alongside the
// test as the reference) and on every subsequent run pixel-diffs against
// them, failing if the rendered output drifts unexpectedly.
//
// Coverage note: a representative cross-section rather than the full
// 4-mode x 5-language x N-width x light/dark combinatorial matrix (that
// many baseline images would be impractical to review/maintain by hand) —
// all 4 modes once each, no-data state, 1/2/3/4 views, one narrow+one wide
// width, light+dark, and one non-English language as a sanity check that
// longer translated strings don't visibly break layout.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

async function shot(page, cardId, name, width = 400) {
  await page.evaluate(({ id, width }) => { document.getElementById(id).style.width = `${width}px`; }, { id: cardId, width });
  await page.waitForTimeout(200); // let ResizeObserver/font-ready settle
  // #stage (not the bare card) so the card's box-shadow and the
  // surrounding page-background gutter are captured too -- see the
  // #stage comment in harness.html.
  await expect(page.locator("#stage")).toHaveScreenshot(name, { animations: "disabled" });
}

test.describe("visual golden: one representative render per mode", () => {
  const MODES = {
    temperature: { value: 22, device_class: "temperature", unit: "°C" },
    humidity: { value: 50, device_class: "humidity", unit: "%" },
    co2: { value: 700, device_class: "carbon_dioxide", unit: "ppm" },
    pm25: { value: 8, device_class: "pm25", unit: "µg/m³" },
  };
  for (const [mode, fx] of Object.entries(MODES)) {
    test(mode, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", fx.value, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
        "sensor.r1": mkStateObj("sensor.r1", fx.value * 0.9, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
        "sensor.r2": mkStateObj("sensor.r2", fx.value * 1.1, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
      await shot(page, cardId, `mode-${mode}.png`);
    });
  }
});

test.describe("visual golden: narrow trend arrow and Scale footer per mode", () => {
  const TREND_VALUES = {
    temperature: 0.2,
    humidity: 1,
    co2: 30,
    pm25: 1,
  };

  for (const [mode, fx] of Object.entries({
    temperature: { value: 22.4, roomLow: 21.6, roomHigh: 23.1, device_class: "temperature", unit: "°C" },
    humidity: { value: 50, roomLow: 45, roomHigh: 56, device_class: "humidity", unit: "%" },
    co2: { value: 700, roomLow: 620, roomHigh: 810, device_class: "carbon_dioxide", unit: "ppm" },
    pm25: { value: 8, roomLow: 5, roomHigh: 12, device_class: "pm25", unit: "µg/m³" },
  })) {
    test(mode, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", fx.value, {
          device_class: fx.device_class,
          unit_of_measurement: fx.unit,
        }),
        "sensor.trend": mkStateObj("sensor.trend", TREND_VALUES[mode], {
          unit_of_measurement: `${fx.unit}/h`,
        }),
        "sensor.r1": mkStateObj("sensor.r1", fx.roomLow, {
          device_class: fx.device_class,
          unit_of_measurement: fx.unit,
        }),
        "sensor.r2": mkStateObj("sensor.r2", fx.roomHigh, {
          device_class: fx.device_class,
          unit_of_measurement: fx.unit,
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
      await expect(card.locator(".rtc-avg-button")).toHaveAttribute("data-trend-direction", "rising");
      await expect(card.locator(".rtc-avg-trend-arrow")).toHaveText("");
      await expect(card.locator(".rtc-avg-trend-arrow-svg path")).toHaveCount(1);
      await expect(card.locator(".rtc-avg-trend")).toHaveCount(0);
      await expect(card.locator(".rtc-scale-footer")).toContainText(/trend/i);
      const screenshotName = mode === "temperature"
        ? "trend-summary-narrow-320.png"
        : `trend-summary-${mode}-narrow-320.png`;
      await shot(page, cardId, screenshotName, 320);
    });
  }
});

test("visual golden: no-data state", async ({ page }) => {
  await gotoHarness(page);
  const states = { "sensor.avg": mkStateObj("sensor.avg", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }) };
  const cardId = await createCard(page, { entity: "sensor.avg" }, states);
  await shot(page, cardId, "no-data-state.png");
});

test.describe("visual golden: 1/2/3/4 views", () => {
  test("1 view (avg only)", async ({ page }) => {
    await gotoHarness(page);
    const states = { "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) };
    const cardId = await createCard(page, { entity: "sensor.avg" }, states);
    await shot(page, cardId, "views-1.png");
  });

  test("2 views (avg + rooms)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
    await shot(page, cardId, "views-2.png");
  });

  test("3 views (avg + range + rooms)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 20,
        maximum: 23,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
      states
    );
    await shot(page, cardId, "views-3.png");
  });

  test("4 views (avg + range + rangeScale + rooms)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 20,
        maximum: 23,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        range_entity: "sensor.range",
        views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }, { type: "extremes" }],
        rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      },
      states
    );
    await shot(page, cardId, "views-4.png");
  });
});

test("visual golden: narrow width (320px)", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r3": mkStateObj("sensor.r3", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r4": mkStateObj("sensor.r4", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r5": mkStateObj("sensor.r5", 22.5, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r6": mkStateObj("sensor.r6", 20.5, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r7": mkStateObj("sensor.r7", 23.5, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const rooms = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `Room ${i}`, entity: `sensor.r${i}` }));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, states);
  await shot(page, cardId, "narrow-320.png", 320);
});

test("visual golden: dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  await shot(page, cardId, "dark-mode.png");
});

test("visual golden: German (longer strings than English)", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states, "de");
  await shot(page, cardId, "german.png");
});

test.describe("visual golden: long-/short-form label architecture", () => {
  // Polish scale.optimalLabel and French rangeScale.currentLabel were
  // permanently abbreviated to fix a real 320px overlap; both are now the
  // full word by default, with the abbreviation only substituted at
  // measure time when it genuinely doesn't fit (see _resolveLabelForm() in
  // room-climate-card.js). These pin the actual rendered pixels at exactly
  // a narrow width so the layout contract cannot silently regress.
  test("Polish scale.optimalLabel at 320px (co2, the mode with a left-anchored optimal band)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r1": mkStateObj("sensor.r1", 650, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
      "sensor.r2": mkStateObj("sensor.r2", 750, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states, "pl");
    const card = page.locator(`#${cardId}`);
    await page.evaluate((id) => { document.getElementById(id).style.width = "320px"; }, cardId);
    await page.waitForTimeout(200);
    // Functional assertion first: either the full "optymalny" or
    // its "opt." fallback is legitimately on screen, never neither/garbled.
    const text = await card.locator(".rtc-card").innerText();
    expect(text).toMatch(/optymalny|opt\./);
    await expect(page.locator("#stage")).toHaveScreenshot("label-short-form-pl-320.png", { animations: "disabled" });
  });

  test("French rangeScale.currentLabel at 320px", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 9, { unit_of_measurement: "°C", minimum: 12, maximum: 21 }),
    };
    // Solo view (range_scale only, no carousel) so the screenshot actually
    // shows the current/min/max labels this test is about, instead of
    // whichever view happens to be the carousel's first slide.
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] },
      states,
      "fr"
    );
    const card = page.locator(`#${cardId}`);
    await page.evaluate((id) => { document.getElementById(id).style.width = "320px"; }, cardId);
    await page.waitForTimeout(200);
    const text = await card.locator(".rtc-card").innerText();
    expect(text).toMatch(/maintenant|act\./);
    await expect(page.locator("#stage")).toHaveScreenshot("label-short-form-fr-320.png", { animations: "disabled" });
  });
});

test.describe("visual golden: native Fahrenheit at normal and narrow widths", () => {
  async function fahrenheitCard(page) {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 72, { unit_of_measurement: "°F" }),
      "sensor.r1": mkStateObj("sensor.r1", 70, { unit_of_measurement: "°F" }),
      "sensor.r2": mkStateObj("sensor.r2", 74, { unit_of_measurement: "°F" }),
    };
    return createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  }

  // Functional assertions precede the snapshot so it validates real DOM
  // semantics as well as pixel stability.
  async function assertNativeFahrenheit(page, cardId) {
    const text = await page.locator(`#${cardId} .rtc-card`).innerText();
    expect(text).toContain("72");
    expect(text).toContain("°F");
    expect(text.toLowerCase()).not.toContain("very hot");
    expect(text.toLowerCase()).not.toContain("too warm");
  }

  test("normal width", async ({ page }) => {
    const cardId = await fahrenheitCard(page);
    await assertNativeFahrenheit(page, cardId);
    await shot(page, cardId, "fahrenheit-normal.png");
  });

  test("narrow width (320px)", async ({ page }) => {
    const cardId = await fahrenheitCard(page);
    await assertNativeFahrenheit(page, cardId);
    await shot(page, cardId, "fahrenheit-narrow-320.png", 320);
  });
});

test("visual golden: rangeScale view with a collision-prone configuration (all three labels near-identical)", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 21.1, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 0.4, { unit_of_measurement: "°C", minimum: 20.9, maximum: 21.3 }),
  };
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    states
  );
  await page.evaluate((id) => {
    const el = document.getElementById(id);
    el._activeView = el._views.indexOf("range_scale");
    el._updateTrackTransform(false);
  }, cardId);
  await shot(page, cardId, "rangescale-collision.png");
});

test("visual golden: rangeScale edge collision lifts max only while min remains lower", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 26, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkStateObj("sensor.range", 11.1, {
      unit_of_measurement: "°C",
      minimum: 14.9,
      maximum: 26,
      minimum_zeitpunkt: "2026-07-24T06:02:00",
      maximum_zeitpunkt: "2026-07-24T18:20:00",
    }),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      title: "Außen-Temperatur",
      range_entity: "sensor.range",
      auto_slide: false,
      views: [{ type: "range_scale" }],
    },
    states,
    "de"
  );
  const card = page.locator(`#${cardId}`);
  await page.evaluate((id) => { document.getElementById(id).style.width = "529px"; }, cardId);
  await page.waitForTimeout(200);
  await expect(card.locator(".rtc-range-scale-label-max")).toHaveClass(/rtc-range-scale-label-upper/);
  await expect(card.locator(".rtc-range-scale-label-min")).not.toHaveClass(/rtc-range-scale-label-upper/);
  await shot(page, cardId, "rangescale-single-label-upper.png", 529);
});

test("visual golden: PM2.5 rangeScale keeps the lifted min label fully painted", async ({ page }) => {
  await gotoHarness(page);
  const metric = { device_class: "pm25", unit_of_measurement: "µg/m³" };
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 2.6, metric),
    "sensor.range": mkStateObj("sensor.range", 13.2, {
      unit_of_measurement: "µg/m³",
      minimum: 0.8,
      maximum: 14,
      minimum_zeitpunkt: "2026-07-24T01:15:00",
      maximum_zeitpunkt: "2026-07-24T18:20:00",
    }),
    "sensor.az": mkStateObj("sensor.az", 2, metric),
    "sensor.wz": mkStateObj("sensor.wz", 2, metric),
    "sensor.sz": mkStateObj("sensor.sz", 2.6, metric),
    "sensor.ku": mkStateObj("sensor.ku", 4, metric),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      auto_slide: false,
      rooms: [
        { entity: "sensor.az", name: "Arbeitszimmer", short: "AZ" },
        { entity: "sensor.wz", name: "Wohnzimmer", short: "WZ" },
        { entity: "sensor.sz", name: "Schlafzimmer", short: "SZ" },
        { entity: "sensor.ku", name: "Küche", short: "KÜ" },
      ],
      views: [{ type: "range_scale" }],
    },
    states,
    "de"
  );
  const card = page.locator(`#${cardId}`);
  await page.evaluate((id) => { document.getElementById(id).style.width = "393px"; }, cardId);
  await page.waitForTimeout(200);
  const minLabel = card.locator(".rtc-range-scale-label-min");
  await expect(minLabel).toHaveClass(/rtc-range-scale-label-upper/);
  await expect(card.locator(".rtc-range-scale-label-max")).not.toHaveClass(/rtc-range-scale-label-upper/);
  expect(await minLabel.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.overflowX, style.overflowY, style.textOverflow];
  })).toEqual(["visible", "visible", "clip"]);
  await shot(page, cardId, "rangescale-pm25-min-upper.png", 393);
});

test.describe("visual golden: null-view policy (collapse vs. localized hint)", () => {
  // Functional/DOM assertions precede the snapshot; resolve-active-views.test.js
  // covers the same two cases at the DOM-assertion
  // level; this only re-proves it visually.
  test("deliberately empty views: collapses the view area — no hint markup, no empty space artifact", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [] }, states);
    const card = page.locator(`#${cardId}`);
    await expect(card.locator(".rtc-no-views")).toHaveCount(0);
    await expect(card.locator(".rtc-rotator-solo")).toHaveCount(0);
    await expect(card.locator(".rtc-rotator")).toHaveCount(0);
    await shot(page, cardId, "null-view-collapsed.png");
  });

  test("a requested-but-unavailable view (range_scale with no range_entity) shows the localized hint", async ({ page }) => {
    await gotoHarness(page);
    const states = { "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) };
    const cardId = await createCard(page, { entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }, states);
    const card = page.locator(`#${cardId}`);
    const hint = card.locator(".rtc-no-views");
    await expect(hint).toHaveCount(1);
    await expect(hint).toContainText("No view available");
    await shot(page, cardId, "null-view-hint.png");
  });
});

test.describe("visual golden: view-customizer band visibility (Teil 2, show_comfort_band/show_optimal_band)", () => {
  function bandFixture() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
      "sensor.r1": mkStateObj("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
  }

  test("scale: show_comfort_band false alone (optimal band still visible)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { show_comfort_band: false } }] },
      bandFixture()
    );
    await shot(page, cardId, "scale-comfort-band-hidden.png");
  });

  test("scale: show_optimal_band false alone (comfort band still visible)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { show_optimal_band: false } }] },
      bandFixture()
    );
    await shot(page, cardId, "scale-optimal-band-hidden.png");
  });

  test("scale: both bands hidden — bar height and marker positions stay unchanged", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
        views: [{ type: "scale", options: { show_comfort_band: false, show_optimal_band: false } }],
      },
      bandFixture()
    );
    await shot(page, cardId, "scale-both-bands-hidden.png");
  });

  test("mixed setup: range_scale shows only its comfort band, scale shows only its optimal band", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        range_entity: "sensor.range",
        rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
        views: [
          { type: "scale", options: { show_comfort_band: false } },
          { type: "range_scale", enabled: true, options: { show_optimal_band: false } },
          { type: "extremes" },
        ],
      },
      bandFixture()
    );
    // views: lists scale first, so it's already the active/default carousel position.
    await shot(page, cardId, "scale-mixed-band-setup-scale.png");
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      el._activeView = el._views.indexOf("range_scale");
      el._updateTrackTransform(false);
    }, cardId);
    await shot(page, cardId, "scale-mixed-band-setup-rangescale.png");
  });
});

test.describe("visual golden: view-specific options", () => {
  function apc3Fixture() {
    return {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 18,
        maximum: 24,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
  }

  test("scale: markers:average shows only the avg marker (no coldest/warmest)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { markers: "average" } }] },
      apc3Fixture()
    );
    await shot(page, cardId, "scale-markers-average.png");
  });

  test("range_scale: footer compact (no min/max timestamps)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true, options: { footer: "compact" } }] },
      apc3Fixture()
    );
    await shot(page, cardId, "rangescale-footer-compact.png");
  });

  test("range: show_time false (min/max cards show only the value, no timestamp)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range", options: { show_time: false } }] },
      apc3Fixture()
    );
    await shot(page, cardId, "range-show-time-false.png");
  });

  test("extremes: show_value false (coldest/warmest cards show only the room name, no value)", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "extremes", options: { show_value: false } }] },
      apc3Fixture()
    );
    await shot(page, cardId, "extremes-show-value-false.png");
  });
});

test.describe("visual golden: adaptive outdoor scale and per-room markers", () => {
  test("outdoor winter values use a compact data-following scale with off-axis bands hidden", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 3, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r1": mkStateObj("sensor.r1", -2, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 2, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r3": mkStateObj("sensor.r3", 5, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r4": mkStateObj("sensor.r4", 8, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        classification: "outdoor",
        rooms: [
          { entity: "sensor.r1", short: "R1" },
          { entity: "sensor.r2", short: "R2" },
          { entity: "sensor.r3", short: "R3" },
          { entity: "sensor.r4", short: "R4" },
        ],
        auto_slide: false,
        views: [{ type: "scale" }],
      },
      states,
      "de"
    );
    const card = page.locator(`#${cardId}`);
    await expect(card.locator(".rtc-scale-label-min")).toHaveText("-3°C");
    await expect(card.locator(".rtc-scale-label-max")).toHaveText("9°C");
    await expect(card.locator(".rtc-comfort-band")).toHaveAttribute("hidden", "");
    await expect(card.locator(".rtc-optimal-band")).toHaveAttribute("hidden", "");
    await shot(page, cardId, "outdoor-winter-adaptive-scale.png", 420);
  });

  test("markers:all renders every room smaller than the emphasized average", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r1": mkStateObj("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r2": mkStateObj("sensor.r2", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r3": mkStateObj("sensor.r3", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.r4": mkStateObj("sensor.r4", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    };
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        rooms: [
          { entity: "sensor.r1", short: "R1" },
          { entity: "sensor.r2", short: "R2" },
          { entity: "sensor.r3", short: "R3" },
          { entity: "sensor.r4", short: "R4" },
        ],
        auto_slide: false,
        views: [{ type: "scale", options: { markers: "all" } }],
      },
      states,
      "de"
    );
    const card = page.locator(`#${cardId}`);
    await expect(card.locator(".rtc-marker-room")).toHaveCount(4);
    const roomHeight = await card.locator(".rtc-marker-room").first().evaluate((node) => node.getBoundingClientRect().height);
    const averageHeight = await card.locator(".rtc-marker-avg").evaluate((node) => node.getBoundingClientRect().height);
    expect(roomHeight).toBeLessThan(averageHeight);
    await shot(page, cardId, "scale-markers-all.png", 420);
  });
});

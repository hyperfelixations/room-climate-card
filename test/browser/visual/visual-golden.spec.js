"use strict";

// Golden screenshots via Playwright's toHaveScreenshot(), diffed against committed PNGs in
// visual-golden.spec.js-snapshots/. A representative cross-section, not the full
// mode x language x width x theme matrix: all four modes once, no-data, 1-4 views, one
// narrow and one wide width, light and dark, one non-English language. Each PNG is mapped
// to the card function it exercises in interne Doku §4 "Golden-Inventar"; budget and the
// guard test are in §4 "Baseline- und Golden-Vertrag".

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { CO2, HUMIDITY, PM25, TEMPERATURE_C } = require("../../fixtures/attributes.js");

async function shot(page, cardId, name, width = 400) {
  // Waits on the layout mechanism, not a duration (see setCardWidth) — a frame-early
  // screenshot is non-deterministic noise, not a visible failure.
  await setCardWidth(page, cardId, width);
  // #stage, not the bare card, so the box-shadow and page-background gutter are captured
  // (see harness.html).
  await expect(page.locator("#stage")).toHaveScreenshot(name, { animations: "disabled" });
}

test.describe("visual golden: one representative render per mode", () => {
  const MODES = {
    temperature: { value: 22, attributes: TEMPERATURE_C },
    humidity: { value: 50, attributes: HUMIDITY },
    co2: { value: 700, attributes: CO2 },
    pm25: { value: 8, attributes: PM25 },
  };
  for (const [mode, fx] of Object.entries(MODES)) {
    test(mode, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", fx.value, fx.attributes),
        "sensor.r1": mkStateObj("sensor.r1", fx.value * 0.9, fx.attributes),
        "sensor.r2": mkStateObj("sensor.r2", fx.value * 1.1, fx.attributes),
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
    temperature: { value: 22.4, roomLow: 21.6, roomHigh: 23.1, attributes: TEMPERATURE_C },
    humidity: { value: 50, roomLow: 45, roomHigh: 56, attributes: HUMIDITY },
    co2: { value: 700, roomLow: 620, roomHigh: 810, attributes: CO2 },
    pm25: { value: 8, roomLow: 5, roomHigh: 12, attributes: PM25 },
  })) {
    test(mode, async ({ page }) => {
      await gotoHarness(page);
      // The trend sensor reports a RATE, so it carries the metric unit per hour and no
      // device class of its own — the one entity here whose attributes are not the metric's.
      const perHour = { unit_of_measurement: `${fx.attributes.unit_of_measurement}/h` };
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", fx.value, fx.attributes),
        "sensor.trend": mkStateObj("sensor.trend", TREND_VALUES[mode], perHour),
        "sensor.r1": mkStateObj("sensor.r1", fx.roomLow, fx.attributes),
        "sensor.r2": mkStateObj("sensor.r2", fx.roomHigh, fx.attributes),
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
  const states = { "sensor.avg": mkStateObj("sensor.avg", "unavailable", TEMPERATURE_C) };
  const cardId = await createCard(page, { entity: "sensor.avg" }, states);
  await shot(page, cardId, "no-data-state.png");
});

test.describe("visual golden: 1/2/3/4 views", () => {
  test("1 view (avg only)", async ({ page }) => {
    await gotoHarness(page);
    const states = { "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C) };
    const cardId = await createCard(page, { entity: "sensor.avg" }, states);
    await shot(page, cardId, "views-1.png");
  });

  test("2 views (avg + rooms)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
    await shot(page, cardId, "views-2.png");
  });

  test("3 views (avg + range + rooms)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 20,
        maximum: 23,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
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
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 20,
        maximum: 23,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
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
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
    "sensor.r3": mkStateObj("sensor.r3", 19, TEMPERATURE_C),
    "sensor.r4": mkStateObj("sensor.r4", 25, TEMPERATURE_C),
    "sensor.r5": mkStateObj("sensor.r5", 22.5, TEMPERATURE_C),
    "sensor.r6": mkStateObj("sensor.r6", 20.5, TEMPERATURE_C),
    "sensor.r7": mkStateObj("sensor.r7", 23.5, TEMPERATURE_C),
  };
  const rooms = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ name: `Room ${i}`, entity: `sensor.r${i}` }));
  const cardId = await createCard(page, { entity: "sensor.avg", rooms }, states);
  await shot(page, cardId, "narrow-320.png", 320);
});

// The card exactly as the README's screenshot.png / screenshot-dark.png advertise it:
// primary value, five rooms all inside the comfort band, default sort and views. Re-record
// only together with the README images.
test.describe("visual golden: the card the README advertises", () => {
  const HERO_ROOMS = [
    { name: "Bedroom", short: "BE", entity: "sensor.bedroom", value: 20.6 },
    { name: "Living Room", short: "LR", entity: "sensor.living_room", value: 21.8 },
    { name: "Kitchen", short: "KI", entity: "sensor.kitchen", value: 22.4 },
    { name: "Office", short: "OF", entity: "sensor.office", value: 23.1 },
    { name: "Bathroom", short: "BA", entity: "sensor.bathroom", value: 24.0 },
  ];
  const TEMP = TEMPERATURE_C;

  async function createHeroCard(page) {
    const states = { "sensor.house": mkStateObj("sensor.house", 22.4, TEMP) };
    for (const room of HERO_ROOMS) states[room.entity] = mkStateObj(room.entity, room.value, TEMP);
    return createCard(
      page,
      {
        entity: "sensor.house",
        rooms: HERO_ROOMS.map(({ name, short, entity }) => ({ name, short, entity })),
      },
      states
    );
  }

  test("light", async ({ page }) => {
    await gotoHarness(page);
    const cardId = await createHeroCard(page);
    const card = page.locator(`#${cardId}`);
    // Assert the state the images promise, so a golden cannot be re-recorded around a card
    // that stopped saying it.
    await expect(card.locator(".rtc-status-pill")).toHaveText("Optimal");
    await expect(card.locator(".rtc-avg-value-num")).toHaveText("22.4");
    await expect(card.locator(".rtc-room-chip")).toHaveCount(5);
    await expect(card.locator(".rtc-scale-footer").first()).toContainText("Comfort 5/5");
    await expect(card.locator(".rtc-scale-footer").first()).toContainText("Spread 3.4");
    // 450px: the width the published images were taken at (narrower ellipsizes the subtitle).
    await shot(page, cardId, "readme-hero-light.png", 450);
  });

  test("dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoHarness(page);
    const cardId = await createHeroCard(page);
    await shot(page, cardId, "readme-hero-dark.png", 450);
  });
});

test("visual golden: dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states);
  await shot(page, cardId, "dark-mode.png");
});

test("visual golden: German (longer strings than English)", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
  };
  const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states, "de");
  await shot(page, cardId, "german.png");
});

test.describe("visual golden: long-/short-form label architecture", () => {
  // Polish scale.optimalLabel and French rangeScale.currentLabel are the full word by
  // default, abbreviated only at measure time when they do not fit (_resolveLabelForm()).
  // These pin the rendered pixels at a narrow width so that contract cannot regress.
  test("Polish scale.optimalLabel at 320px (co2, the mode with a left-anchored optimal band)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 700, CO2),
      "sensor.r1": mkStateObj("sensor.r1", 650, CO2),
      "sensor.r2": mkStateObj("sensor.r2", 750, CO2),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states, "pl");
    const card = page.locator(`#${cardId}`);
    await setCardWidth(page, cardId, 320);
    // Functional assertion first: the full "optymalny" or its "opt." fallback is on screen,
    // never neither.
    const text = await card.locator(".rtc-card").innerText();
    expect(text).toMatch(/optymalny|opt\./);
    await expect(page.locator("#stage")).toHaveScreenshot("label-short-form-pl-320.png", { animations: "disabled" });
  });

  test("French rangeScale.currentLabel at 320px", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 20, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 9, { unit_of_measurement: "°C", minimum: 12, maximum: 21 }),
    };
    // Solo range_scale view (no carousel) so the screenshot shows the current/min/max
    // labels this test is about.
    const cardId = await createCard(
      page,
      { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] },
      states,
      "fr"
    );
    const card = page.locator(`#${cardId}`);
    await setCardWidth(page, cardId, 320);
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

  // Functional assertions precede the snapshot so it validates DOM semantics too.
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
    "sensor.avg": mkStateObj("sensor.avg", 21.1, TEMPERATURE_C),
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
    "sensor.avg": mkStateObj("sensor.avg", 26, TEMPERATURE_C),
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
  await setCardWidth(page, cardId, 529);
  await expect(card.locator(".rtc-range-scale-label-max")).toHaveClass(/rtc-range-scale-label-upper/);
  await expect(card.locator(".rtc-range-scale-label-min")).not.toHaveClass(/rtc-range-scale-label-upper/);
  await shot(page, cardId, "rangescale-single-label-upper.png", 529);
});

test("visual golden: PM2.5 rangeScale keeps the lifted min label fully painted", async ({ page }) => {
  await gotoHarness(page);
  const metric = PM25;
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
  await setCardWidth(page, cardId, 393);
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
  // resolve-active-views.test.js covers these two cases at the DOM level; this re-proves
  // them visually.
  test("deliberately empty views: collapses the view area — no hint markup, no empty space artifact", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
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
    const states = { "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C) };
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
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
      "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23, TEMPERATURE_C),
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
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 3, {
        unit_of_measurement: "°C",
        minimum: 18,
        maximum: 24,
        minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
      }),
      "sensor.r1": mkStateObj("sensor.r1", 19, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 25, TEMPERATURE_C),
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
      "sensor.avg": mkStateObj("sensor.avg", 3, TEMPERATURE_C),
      "sensor.r1": mkStateObj("sensor.r1", -2, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 2, TEMPERATURE_C),
      "sensor.r3": mkStateObj("sensor.r3", 5, TEMPERATURE_C),
      "sensor.r4": mkStateObj("sensor.r4", 8, TEMPERATURE_C),
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
      "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
      "sensor.r1": mkStateObj("sensor.r1", 19, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 21, TEMPERATURE_C),
      "sensor.r3": mkStateObj("sensor.r3", 23, TEMPERATURE_C),
      "sensor.r4": mkStateObj("sensor.r4", 25, TEMPERATURE_C),
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

// Two headline shapes: a calculated-consensus headline (a different element than an
// entity-owned one, spaced differently) and a reading wide enough to leave its column.
test.describe("visual golden: headline shapes and headline widths", () => {
  const CONSENSUS_ROOMS = [
    { name: "Living Room", short: "LR", entity: "sensor.r1" },
    { name: "Bedroom", short: "BE", entity: "sensor.r2" },
  ];

  test("a calculated consensus headline (no main entity)", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.r1": mkStateObj("sensor.r1", 21.4, TEMPERATURE_C),
      "sensor.r2": mkStateObj("sensor.r2", 23.2, TEMPERATURE_C),
    };
    const cardId = await createCard(page, { rooms: CONSENSUS_ROOMS }, states);
    const card = page.locator(`#${cardId}`);
    // Asserted, not assumed: a headline attributable to no entity, therefore not a control.
    expect(await card.locator(".rtc-avg-button").evaluate((node) => node.tagName)).toBe("DIV");
    await expect(card.locator(".rtc-avg-button")).not.toHaveAttribute("data-entity", /.*/);
    await expect(card.locator(".rtc-avg-label")).toHaveText("Home avg.");
    await shot(page, cardId, "source-calculated-consensus.png");
  });

  const WIDE_READINGS = {
    co2: { value: 2252, attributes: CO2, low: 1800, high: 2700 },
    pm25: { value: 23.5, attributes: PM25, low: 18.1, high: 28.9 },
  };
  for (const [mode, fx] of Object.entries(WIDE_READINGS)) {
    for (const width of [320, 520]) {
      test(`${mode} ${fx.value} ${fx.attributes.unit_of_measurement} at ${width}px`, async ({ page }) => {
        await gotoHarness(page);
        const attributes = fx.attributes;
        const states = {
          "sensor.avg": mkStateObj("sensor.avg", fx.value, attributes),
          "sensor.r1": mkStateObj("sensor.r1", fx.low, attributes),
          "sensor.r2": mkStateObj("sensor.r2", fx.high, attributes),
        };
        const cardId = await createCard(
          page,
          { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", short: "R1" }, { entity: "sensor.r2", short: "R2" }], auto_slide: false, views: [{ type: "scale" }] },
          states
        );
        await setCardWidth(page, cardId, width);
        // The whole value stays on screen inside its own box — a baseline alone would not
        // catch it creeping back out.
        const fits = await page
          .locator(`#${cardId}`)
          .locator(".rtc-avg-value")
          .evaluate((node) => node.scrollWidth <= node.clientWidth);
        expect(fits, `${fx.value} ${fx.attributes.unit_of_measurement} must fit its column at ${width}px`).toBe(true);
        await shot(page, cardId, `headline-wide-${mode}-${width}.png`, width);
      });
    }
  }
});

// One picture per palette: a palette recolours the headline, scale bands, chips and
// extremes at once, and a picture also catches a colour reaching somewhere the palette was
// never threaded through. The eight cover every road into the palette layer — default, a
// second shipped design, the colour-vision one, the short one whose wings fall short of the
// profile, one derived from a colour name (no file to inspect), a YAML palette with only a
// middle (a single-colour card), and the two interpolated spellings (`blue-red` short way
// through violet; `blue-green-red` with a named middle and interpolated wings).
test.describe("visual golden: the shipped palettes", () => {
  for (const palette of ["pastel", "vivid", "color-vision", "signal", "blue", "blue-red", "blue-green-red", { optimal: "1DB85D" }]) {
    const name = typeof palette === "string" ? palette : "single-color";
    test(name, async ({ page }) => {
      await gotoHarness(page);
      const attributes = TEMPERATURE_C;
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", 22, attributes),
        "sensor.range": mkStateObj("sensor.range", 6, { ...attributes, minimum: 18, maximum: 27 }),
        "sensor.r1": mkStateObj("sensor.r1", 18.4, attributes),
        "sensor.r2": mkStateObj("sensor.r2", 22.1, attributes),
        "sensor.r3": mkStateObj("sensor.r3", 26.8, attributes),
      };
      const cardId = await createCard(
        page,
        {
          entity: "sensor.avg",
          range_entity: "sensor.range",
          palette,
          auto_slide: false,
          rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
          views: [{ type: "scale" }],
        },
        states
      );
      await shot(page, cardId, `palette-${name}.png`, 400);
    });
  }
});

// The subtitle when it is longer than the card is wide. Two pictures, because the promise
// is a comparison: `clip` ellipsizes on one line, `wrap` lets the line run on and pushes
// the panel down (not overlapped), with a long unbroken entity id wrapping inside the card.
test.describe("visual golden: the subtitle", () => {
  for (const overflow of ["clip", "wrap"]) {
    test(overflow, async ({ page }) => {
      await gotoHarness(page);
      const attributes = TEMPERATURE_C;
      const cardId = await createCard(
        page,
        {
          entity: "sensor.avg",
          auto_slide: false,
          subtitle: {
            text: "Ground floor sensors, averaged every five minutes by sensor.ground_floor_temperature_average",
            overflow,
          },
          views: [{ type: "scale" }],
        },
        { "sensor.avg": mkStateObj("sensor.avg", 22, attributes) }
      );
      await shot(page, cardId, `subtitle-${overflow}.png`, 400);
    });
  }
});

// One derived palette (`palette: blue`) in dark mode — the ramp derived from a colour name
// is the only one with no file to inspect, and a washed-out result shows up in dark. The
// hand-written palettes are readable hex and need no dark twin.
test("visual golden: a derived palette in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHarness(page);
  const attributes = TEMPERATURE_C;
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      palette: "blue",
      auto_slide: false,
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
      views: [{ type: "scale" }],
    },
    {
      "sensor.avg": mkStateObj("sensor.avg", 22, attributes),
      "sensor.r1": mkStateObj("sensor.r1", 18.4, attributes),
      "sensor.r2": mkStateObj("sensor.r2", 22.1, attributes),
      "sensor.r3": mkStateObj("sensor.r3", 26.8, attributes),
    }
  );
  await shot(page, cardId, "palette-blue-dark.png", 400);
});

// Pure yellow on a light card: a colour almost identical to the tint of itself it sits on
// (a 20% tint of #FFFF00 on white is #FFFFEC). paint-role-calibration.spec.js measures the
// pill separation and fails first; this picture is the human check that the adjusted
// result still looks like a yellow card. Everything else in the shot — accent line, scale,
// markers, chips — is full-strength yellow.
test("visual golden: a colour that has to be adjusted to be read on itself", async ({ page }) => {
  await gotoHarness(page);
  const attributes = TEMPERATURE_C;
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      palette: "yellow",
      auto_slide: false,
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
      views: [{ type: "scale" }],
    },
    {
      "sensor.avg": mkStateObj("sensor.avg", 22, attributes),
      "sensor.r1": mkStateObj("sensor.r1", 18.4, attributes),
      "sensor.r2": mkStateObj("sensor.r2", 22.1, attributes),
      "sensor.r3": mkStateObj("sensor.r3", 26.8, attributes),
    }
  );
  await shot(page, cardId, "palette-yellow.png", 400);
});

// The card with `show.accent_line: false`: removing the line leaves nothing behind — no
// gap, no substitute border, the top corner radius matching the bottom. Only the "off" case
// needs a picture; the default is in every other golden here.
test("visual golden: the card without its accent line", async ({ page }) => {
  await gotoHarness(page);
  const attributes = TEMPERATURE_C;
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      show: { accent_line: false },
      auto_slide: false,
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "scale" }],
    },
    {
      "sensor.avg": mkStateObj("sensor.avg", 22, attributes),
      "sensor.r1": mkStateObj("sensor.r1", 19.8, attributes),
      "sensor.r2": mkStateObj("sensor.r2", 24.3, attributes),
    }
  );
  await shot(page, cardId, "accent-line-off.png", 400);
});

// The card with a part taken out. Six pictures, each about shape not colour: whether the
// row still reads as a row, whether what is left sits where it should, and whether the
// missing part's space went with it — none of which an assertion settles. The default is
// not among them (it is in every other golden here).
test.describe("visual golden: the parts a card can leave out", () => {
  const SHOW_CASES = [
    ["no-icon", { icon: false }],
    ["no-title-block", { title: false, subtitle: false }],
    ["no-pill", { pill: false }],
    ["no-panel", { panel: false }],
    ["rooms-only", { icon: false, title: false, subtitle: false, pill: false, panel: false }],
    ["nothing-shown", { icon: false, title: false, subtitle: false, pill: false, panel: false, rooms: false }],
  ];

  for (const [name, show] of SHOW_CASES) {
    test(name, async ({ page }) => {
      await gotoHarness(page);
      const attributes = TEMPERATURE_C;
      const cardId = await createCard(
        page,
        {
          entity: "sensor.avg",
          auto_slide: false,
          show,
          rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
          views: [{ type: "scale" }],
        },
        {
          "sensor.avg": mkStateObj("sensor.avg", 22, attributes),
          "sensor.r1": mkStateObj("sensor.r1", 18.4, attributes),
          "sensor.r2": mkStateObj("sensor.r2", 22.1, attributes),
          "sensor.r3": mkStateObj("sensor.r3", 26.8, attributes),
        }
      );
      await shot(page, cardId, `show-${name}.png`, 400);
    });
  }
});

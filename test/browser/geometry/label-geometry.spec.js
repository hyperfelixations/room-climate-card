"use strict";

// Real layout coverage complements jsdom tests, which can only test
// the label-placement algorithm against mocked getBoundingClientRect()
// widths; this exercises the actual browser text-measurement/CSS pipeline.
// The matrix covers supported languages, all four modes and representative bar widths:
// min=avg=max, close together, far apart, avg outside min/max, no overlap
// or an explicitly-tested ellipsis fallback.
//
// Coverage uses every supported language and mode at representative widths for both
// the main scale's optimal-label-vs-min/max case and
// the rangeScale 3-label solver, plus one deliberately narrow two-line
// fallback case. A finer-grained width sweep would mostly be
// redundant with the deterministic solver already covered exactly in
// test/unit/ — this layer's job is confirming REAL text metrics don't
// break the algorithm's assumptions, not re-testing the algorithm itself.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");

// From the manifest — see test/contracts/product-surface.js.
const { LANGUAGES } = require("../../contracts/product-surface.js");
const { CO2, TEMPERATURE_C } = require("../../fixtures/attributes.js");
// Widths cover the supported 280-500 px range. Below that range, some long-label
// combinations cannot fit without exceeding the solver's layout assumptions.
const WIDTHS = [280, 320, 380, 420, 500];

const MODE_FIXTURES = {
  temperature: { entity: "sensor.avg", value: 22, device_class: "temperature", unit: "°C", roomLow: 19, roomHigh: 27 },
  humidity: { entity: "sensor.avg", value: 50, device_class: "humidity", unit: "%", roomLow: 33, roomHigh: 68 },
  co2: { entity: "sensor.avg", value: 700, device_class: "carbon_dioxide", unit: "ppm", roomLow: 350, roomHigh: 1250 },
  pm25: { entity: "sensor.avg", value: 8, device_class: "pm25", unit: "µg/m³", roomLow: 0, roomHigh: 22 },
};

function noOverlap(rects) {
  // 1.5px tolerance: sub-pixel font-rendering/anti-aliasing variance
  // between otherwise-identical runs was observed to occasionally push a
  // boundingBox() reading a fraction of a pixel past its neighbor at the
  // narrowest tested width (280px) — not a real, visually perceptible
  // overlap, and not reproducible as a deterministic failure (it passed on
  // an immediate retry with byte-identical inputs every time it was seen).
  const sorted = [...rects].sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].left < sorted[i - 1].right - 1.5) return false;
  }
  return true;
}

function boxesOverlap2d(a, b, tolerance = 1.5) {
  return (
    a.x < b.x + b.width - tolerance &&
    b.x < a.x + a.width - tolerance &&
    a.y < b.y + b.height - tolerance &&
    b.y < a.y + a.height - tolerance
  );
}


async function expectUpperLabelPaintViewport(card, viewportSelector) {
  const policy = await card.locator(viewportSelector).evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      contain: style.contain,
      clipPath: style.clipPath,
    };
  });
  expect(
    { overflowX: policy.overflowX, overflowY: policy.overflowY },
    "the viewport must not apply its old border-box overflow clip to an upper label"
  ).toEqual({ overflowX: "visible", overflowY: "visible" });
  expect(policy.contain.split(/\s+/), "paint containment would silently restore the same border-box clip").not.toContain("paint");
  expect(policy.clipPath, "a directional clip must still prevent horizontal carousel-slide bleed").not.toBe("none");

  const topPaintProbe = await card.locator(".rtc-range-scale-label-upper").evaluate((label, selector) => {
    const viewport = label.closest(selector);
    const viewportRect = viewport.getBoundingClientRect();
    const initialRect = label.getBoundingClientRect();
    const initialTop = Number.parseFloat(getComputedStyle(label).top);
    // Simulate the few-pixel font-metric shift observed in the user's real
    // Home Assistant screenshot: put the label box 4px above the viewport,
    // still well inside the declared 10px upper paint allowance.
    label.style.top = `${initialTop - (initialRect.top - viewportRect.top) - 4}px`;
    const shiftedRect = label.getBoundingClientRect();
    const root = label.getRootNode();
    const hit = root.elementFromPoint(shiftedRect.left + shiftedRect.width / 2, viewportRect.top - 2);
    label.style.top = "";
    return {
      shiftedTop: shiftedRect.top,
      viewportTop: viewportRect.top,
      hitUpperLabel: hit === label || label.contains(hit),
    };
  }, viewportSelector);
  expect(topPaintProbe.shiftedTop, "probe must actually extend above the normal viewport").toBeLessThan(topPaintProbe.viewportTop);
  expect(topPaintProbe.hitUpperLabel, "the directional upper paint allowance must remain hit-test-visible above the viewport").toBe(true);
}

test.describe("main scale: optimal-label never overlaps min/max labels", () => {
  for (const lang of LANGUAGES) {
    for (const mode of Object.keys(MODE_FIXTURES)) {
      test(`${mode} / ${lang}`, async ({ page }) => {
        await gotoHarness(page);
        const fx = MODE_FIXTURES[mode];
        const states = {
          [fx.entity]: mkStateObj(fx.entity, fx.value, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
          "sensor.r1": mkStateObj("sensor.r1", fx.roomLow, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
          "sensor.r2": mkStateObj("sensor.r2", fx.roomHigh, { device_class: fx.device_class, unit_of_measurement: fx.unit }),
        };
        const cardId = await createCard(page, { entity: fx.entity, auto_slide: false, rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, states, lang);
        const card = page.locator(`#${cardId}`);
        for (const width of WIDTHS) {
          await setCardWidth(page, cardId, width);
          const centerBox = await card.locator(".rtc-scale-label-center").first().boundingBox();
          const minBox = await card.locator(".rtc-scale-label-min").first().boundingBox();
          const maxBox = await card.locator(".rtc-scale-label-max").first().boundingBox();
          expect(centerBox, `width=${width}`).toBeTruthy();
          const rects = [minBox, centerBox, maxBox].map((b) => ({ left: b.x, right: b.x + b.width }));
          expect(noOverlap(rects), `${mode}/${lang} at ${width}px: min/center/max overlap`).toBe(true);
        }
      });
    }
  }
});

test.describe("rangeScale: the 3-label solver never overlaps, across value configurations", () => {
  const CASES = {
    "close together": { min: 20.8, avg: 21.0, max: 21.2 },
    "far apart": { min: 12, avg: 20, max: 29 },
    "all three identical": { min: 21, avg: 21, max: 21 },
    "avg outside [min,max]": { min: 18, avg: 30, max: 23 },
  };
  for (const lang of LANGUAGES) {
    for (const [caseName, v] of Object.entries(CASES)) {
      test(`${caseName} / ${lang}`, async ({ page }) => {
        await gotoHarness(page);
        const states = {
          "sensor.avg": mkStateObj("sensor.avg", v.avg, TEMPERATURE_C),
          "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
        };
        const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, lang);
        const card = page.locator(`#${cardId}`);
        for (const width of WIDTHS) {
          await setCardWidth(page, cardId, width);
          const avgBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
          const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
          const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
          expect(boxesOverlap2d(avgBox, minBox), `${caseName}/${lang} at ${width}px: current/min overlap`).toBe(false);
          expect(boxesOverlap2d(avgBox, maxBox), `${caseName}/${lang} at ${width}px: current/max overlap`).toBe(false);
          expect(boxesOverlap2d(minBox, maxBox), `${caseName}/${lang} at ${width}px: min/max overlap`).toBe(false);
        }
      });
    }
  }
});

test.describe("label reading order follows displayed values, not raw anchor positions", () => {
  // Reproduces the reported "Ø min max" bug: current sits at a raw pixel
  // position left of min (current=20.001 < min=20.049), but both ROUND to
  // the same displayed "20.0" at the default 1-decimal precision — sorting
  // by raw anchor alone would place the "current" label before "min" even
  // though a user reading two identical "20.0" numbers expects them
  // left-to-right in role order (min before current). See
  // _resolveRangeScaleLabels() in room-climate-card.js.
  //
  // Fixed-pivot follow-up: this reading order must never be achieved by
  // moving CURRENT — only min/max are allowed to drift from their own
  // anchors. Both cases below already satisfy that (min/max are the ones
  // whose raw anchor sits on the "wrong" side of current's rounded-tie
  // comparison, not current's), so the marker-fidelity assertion is added
  // here rather than weakening the reading-order assertions.
  const CASES = {
    "precision-collision: current < min but both display as the same rounded number": { min: 20.049, current: 20.001, max: 21.0 },
    "precision-collision: current and max both display the same rounded number": { min: 18.0, current: 20.049, max: 20.001 },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.current, TEMPERATURE_C),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      await setCardWidth(page, cardId, 420); // wide enough that no ellipsis-shrink path interferes with pure ordering
      const currentBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
      const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
      const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
      expect(minBox.x, `${caseName}: min must read left of current`).toBeLessThanOrEqual(currentBox.x);
      expect(currentBox.x, `${caseName}: current must read left of max`).toBeLessThanOrEqual(maxBox.x);

      const currentMarkerBox = await card.locator(".rtc-marker-avg").first().boundingBox();
      const labelCenter = currentBox.x + currentBox.width / 2;
      const markerCenter = currentMarkerBox.x + currentMarkerBox.width / 2;
      expect(
        Math.abs(labelCenter - markerCenter),
        `${caseName}: the reading order above must be achieved by moving min/max, never by moving current away from its own marker`
      ).toBeLessThanOrEqual(1.5);
    });
  }
});

test.describe("grouped and thousands-separated numbers sort correctly", () => {
  // Side assignment must compare raw values: Number("1,200") is NaN, so parsing
  // localized display text would misplace realistic four-digit CO2 readings.
  const CASES = {
    "min below 1000, current and max grouped (>=1000)": { min: 800, current: 1200, max: 1600 },
    "all three grouped and close together (realistic co2 spike)": { min: 1150, current: 1200, max: 1300 },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.current, CO2),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "ppm", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      await setCardWidth(page, cardId, 420);
      const currentBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
      const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
      const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
      expect(minBox.x, `${caseName}: min (${v.min}) must read left of current (${v.current})`).toBeLessThan(currentBox.x);
      expect(currentBox.x, `${caseName}: current (${v.current}) must read left of max (${v.max})`).toBeLessThan(maxBox.x);
    });
  }
});

test.describe("rangeScale: current genuinely outside [rangeMin, rangeMax] reads \"min max jetzt\" / \"jetzt min max\", by design (not the historical UI-01 bug)", () => {
  // Real-world trigger: range_entity (day min/max) updates less often than
  // the live averaging entity (see "Auto-Slide und Bedienung" in the dev
  // doc) -- on a near-flat day, the live average can tick a hair above the
  // still-recorded day maximum (or below the day minimum) between range-
  // entity refreshes. Reported via a user screenshot: Ø WOHNUNG 24,2°C,
  // Min 24,1°C, "Tagesspanne 0,0°C" -- current numerically above a day-max
  // that had not yet caught up. _resolveRangeScaleLabels() already handles
  // this intentionally: min/max are assigned to whichever side of the
  // fixed current pivot they numerically belong on, so BOTH land on the
  // same side (packed in their own min-before-max order) instead of a
  // naive always-"min current max" text order that would misrepresent
  // which value is actually highest. This is a REGRESSION GUARD proving
  // that behavior.
  //
  // Values deliberately keep >=0.1 separation at 1-decimal precision (the
  // reported case's own 24,1/24,15 gap turned out to accidentally trigger
  // the UNRELATED, already-covered precision-collision tie-break above
  // instead: Intl-locale rounding of 24.15 displays as "24,2", identical
  // to current's "24,2" -- see toLocaleString() vs toFixed() -- which
  // routes through the min-rank-0/max-rank-2 semanticRank tie-break, not
  // the plain numeric side assignment this describe block means to
  // isolate).
  const CASES = {
    "current above both (reported scenario: flat day, current ticks past a stale day-max)": { min: 24.0, max: 24.1, current: 24.3, expect: "both-left" },
    "current below both (mirrored: stale day-min not yet caught up)": { min: 24.2, max: 24.3, current: 24.0, expect: "both-right" },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.current, TEMPERATURE_C),
        "sensor.range": mkStateObj("sensor.range", v.max - v.min, { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(
        page,
        { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
        states,
        "de"
      );
      const card = page.locator(`#${cardId}`);
      await setCardWidth(page, cardId, 420);
      const currentEl = card.locator(".rtc-range-scale-label-current").first();
      const minEl = card.locator(".rtc-range-scale-label-min").first();
      const maxEl = card.locator(".rtc-range-scale-label-max").first();
      const [currentBox, minBox, maxBox] = await Promise.all([currentEl.boundingBox(), minEl.boundingBox(), maxEl.boundingBox()]);

      if (v.expect === "both-left") {
        expect(minBox.x, `${caseName}: min must read left of max`).toBeLessThanOrEqual(maxBox.x);
        expect(maxBox.x, `${caseName}: max must read left of current -- both historical labels on current's actual (left) side`).toBeLessThanOrEqual(currentBox.x);
      } else {
        expect(currentBox.x, `${caseName}: current must read left of min -- both historical labels on current's actual (right) side`).toBeLessThanOrEqual(minBox.x);
        expect(minBox.x, `${caseName}: min must read left of max`).toBeLessThanOrEqual(maxBox.x);
      }

      // Fixed-pivot invariant: this reading order must come from min/max
      // drifting, never from current moving away from its own marker.
      const currentMarkerBox = await card.locator(".rtc-marker-avg").first().boundingBox();
      const labelCenter = currentBox.x + currentBox.width / 2;
      const markerCenter = currentMarkerBox.x + currentMarkerBox.width / 2;
      expect(
        Math.abs(labelCenter - markerCenter),
        `${caseName}: current's label must stay centered on its own marker, not drift toward min/max`
      ).toBeLessThanOrEqual(1.5);

      expect(boxesOverlap2d(currentBox, minBox), `${caseName}: current/min must not overlap`).toBe(false);
      expect(boxesOverlap2d(currentBox, maxBox), `${caseName}: current/max must not overlap`).toBe(false);
      expect(boxesOverlap2d(minBox, maxBox), `${caseName}: min/max must not overlap`).toBe(false);
    });
  }
});

test("rangeScale: a narrow side interval lifts only the colliding historical label(s) before ellipsis", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 20, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 9, { unit_of_measurement: "°C", minimum: 12, maximum: 21 }),
  };
  // German's "jetzt" remains one of the longest supported rangeScale
  // current-label translations (rangeScale.currentLabel; see
  // room-climate-card.js); combined
  // with a forced 240px host width (bar ~72px — verified via direct
  // measurement: the bar collapses to 0 below ~180px host width, which
  // would test nothing meaningful, and by ~250px these particular values
  // already fit without any fallback), this reliably exceeds the bar's
  // natural capacity.
  const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "de");
  await setCardWidth(page, cardId, 240);
  const card = page.locator(`#${cardId}`);
  const avgEl = card.locator(".rtc-range-scale-label-current").first();
  const minEl = card.locator(".rtc-range-scale-label-min").first();
  const maxEl = card.locator(".rtc-range-scale-label-max").first();
  const maxWidthValues = await Promise.all([avgEl, minEl, maxEl].map((el) => el.evaluate((node) => node.style.maxWidth)));
  expect(maxWidthValues, "the full min/max pair fits in the second line, so ellipsis must not be used").toEqual(["", "", ""]);
  await expect(card.locator(".rtc-range-scale-top-row")).toHaveClass(/rtc-range-scale-has-upper/);
  const upperCount = await card.locator(".rtc-range-scale-label-upper").count();
  expect(upperCount, "at least one historical label must use the upper line in this deliberately narrow case").toBeGreaterThanOrEqual(1);
  expect(upperCount, "current can never be lifted and there are only two historical labels").toBeLessThanOrEqual(2);
  await expect(avgEl).not.toHaveClass(/rtc-range-scale-label-upper/);
  for (const el of [minEl, maxEl]) {
    const dimensions = await el.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
    expect(dimensions.scrollWidth, `${await el.textContent()} must be fully readable`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
  const [avgBox, minBox, maxBox] = await Promise.all([avgEl.boundingBox(), minEl.boundingBox(), maxEl.boundingBox()]);
  expect(boxesOverlap2d(avgBox, minBox), "current/min must not overlap in two dimensions").toBe(false);
  expect(boxesOverlap2d(avgBox, maxBox), "current/max must not overlap in two dimensions").toBe(false);
  expect(boxesOverlap2d(minBox, maxBox), "min/max must not overlap in their shared upper line").toBe(false);
});

test("rangeScale screenshot regression: current === max lifts max only; min stays lower and the bar remains value-derived", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 26, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 11.1, {
      unit_of_measurement: "°C",
      minimum: 14.9,
      maximum: 26,
      minimum_zeitpunkt: "2026-07-24T06:02:00",
      maximum_zeitpunkt: "2026-07-24T15:02:00",
    }),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      auto_slide: false,
      views: [{ type: "range_scale", enabled: true }, { type: "scale" }],
    },
    states,
    "de"
  );
  await setCardWidth(page, cardId, 529);
  const card = page.locator(`#${cardId}`);
  const currentEl = card.locator(".rtc-range-scale-label-current");
  const maxEl = card.locator(".rtc-range-scale-label-max");
  const [currentBox, maxBox, currentMarkerBox, maxMarkerBox] = await Promise.all([
    currentEl.boundingBox(),
    maxEl.boundingBox(),
    card.locator(".rtc-range-scale-view .rtc-marker-avg").boundingBox(),
    card.locator(".rtc-range-scale-view .rtc-marker-warm").boundingBox(),
  ]);
  const dimensions = await maxEl.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      textOverflow: style.textOverflow,
    };
  });
  const center = (box) => box.x + box.width / 2;

  expect(await card.locator(".rtc-range-scale-view .rtc-scale-label-min").textContent(), "label layout must not feed back into the scale minimum").toBe("13°C");
  expect(await card.locator(".rtc-range-scale-view .rtc-scale-label-max").textContent(), "label layout must not feed back into the scale maximum").toBe("27°C");
  expect(await currentEl.textContent()).toBe("jetzt");
  expect(await maxEl.textContent()).toBe("max");
  expect(dimensions.scrollWidth, "max must be fully readable, not ellipsized to m…").toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect(
    { overflowX: dimensions.overflowX, overflowY: dimensions.overflowY, textOverflow: dimensions.textOverflow },
    "the lifted max label must not self-clip glyph ink outside its tight upper-line box"
  ).toEqual({ overflowX: "visible", overflowY: "visible", textOverflow: "clip" });
  expect(Math.abs(center(currentBox) - center(currentMarkerBox)), "jetzt must remain centered on the current marker").toBeLessThanOrEqual(1.5);
  expect(Math.abs(center(maxBox) - center(maxMarkerBox)), "the upper line should keep max centered on its coincident marker").toBeLessThanOrEqual(1.5);
  expect(boxesOverlap2d(currentBox, maxBox), "coincident current/max labels must separate vertically").toBe(false);
  await expect(card.locator(".rtc-range-scale-top-row")).toHaveClass(/rtc-range-scale-has-upper/);
  await expect(maxEl).toHaveClass(/rtc-range-scale-label-upper/);
  await expectUpperLabelPaintViewport(card, ".rtc-rotator");
  const minEl = card.locator(".rtc-range-scale-label-min");
  await expect(minEl).not.toHaveClass(/rtc-range-scale-label-upper/);
  const minBox = await minEl.boundingBox();
  expect(Math.abs(minBox.y - currentBox.y), "the non-colliding min label must remain on current's lower line").toBeLessThanOrEqual(1.5);
});

test("rangeScale mirrored edge regression: current === min lifts min only without clipping its i-dot; max remains lower", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 10, TEMPERATURE_C),
    "sensor.range": mkStateObj("sensor.range", 16, {
      unit_of_measurement: "°C",
      minimum: 10,
      maximum: 26,
    }),
  };
  const cardId = await createCard(
    page,
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale" }] },
    states,
    "de"
  );
  await setCardWidth(page, cardId, 529);
  const card = page.locator(`#${cardId}`);
  const minEl = card.locator(".rtc-range-scale-label-min");
  const maxEl = card.locator(".rtc-range-scale-label-max");
  const currentEl = card.locator(".rtc-range-scale-label-current");

  await expect(card.locator(".rtc-range-scale-top-row")).toHaveClass(/rtc-range-scale-has-upper/);
  await expect(minEl).toHaveClass(/rtc-range-scale-label-upper/);
  await expect(maxEl).not.toHaveClass(/rtc-range-scale-label-upper/);
  await expectUpperLabelPaintViewport(card, ".rtc-rotator-solo");
  const [minBox, maxBox, currentBox] = await Promise.all([minEl.boundingBox(), maxEl.boundingBox(), currentEl.boundingBox()]);
  expect(Math.abs(maxBox.y - currentBox.y), "the non-colliding max label must remain on current's lower line").toBeLessThanOrEqual(1.5);
  expect(boxesOverlap2d(minBox, currentBox), "min/current must be separated vertically").toBe(false);
  const metrics = await minEl.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight),
    overflowX: getComputedStyle(node).overflowX,
    overflowY: getComputedStyle(node).overflowY,
    textOverflow: getComputedStyle(node).textOverflow,
  }));
  expect(metrics.lineHeight, "the upper line needs a full glyph box so the i-dot is not clipped").toBeGreaterThanOrEqual(12);
  expect(metrics.scrollHeight, "the full 'min' glyphs must fit inside the label box").toBeLessThanOrEqual(metrics.clientHeight + 1);
  expect(
    { overflowX: metrics.overflowX, overflowY: metrics.overflowY, textOverflow: metrics.textOverflow },
    "the lifted min label must not self-clip glyph ink outside its tight upper-line box"
  ).toEqual({ overflowX: "visible", overflowY: "visible", textOverflow: "clip" });
});

test.describe("rangeScale: current label stays anchored to its own marker (fixed-pivot invariant)", () => {
  // Current is the fixed pivot: only min/max may move away from their anchors to
  // resolve a collision, otherwise "now" would describe a different axis position.
  const CASES = {
    "no collision (far apart)": { min: 12, avg: 20, max: 29 },
    // Current and min are close enough that only the historical label may move.
    "current close to min (close together)": { min: 20.8, avg: 21.0, max: 21.2 },
    "current essentially equal to min": { min: 21.0, avg: 21.02, max: 25.0 },
    "current essentially equal to max": { min: 15.0, avg: 24.98, max: 25.0 },
    "min === current === max": { min: 21, avg: 21, max: 21 },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.avg, TEMPERATURE_C),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      for (const width of [300, 420]) {
        await setCardWidth(page, cardId, width);
        const currentLabelBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
        const currentMarkerBox = await card.locator(".rtc-marker-avg").first().boundingBox();
        const labelCenter = currentLabelBox.x + currentLabelBox.width / 2;
        const markerCenter = currentMarkerBox.x + currentMarkerBox.width / 2;
        expect(
          Math.abs(labelCenter - markerCenter),
          `${caseName} at ${width}px: current label center (${labelCenter}) must stay within ~1.5px of its own marker center (${markerCenter}), never drift toward min/max`
        ).toBeLessThanOrEqual(1.5);

        const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
        const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
        expect(boxesOverlap2d(currentLabelBox, minBox), `${caseName} at ${width}px: current/min overlap`).toBe(false);
        expect(boxesOverlap2d(currentLabelBox, maxBox), `${caseName} at ${width}px: current/max overlap`).toBe(false);
        expect(boxesOverlap2d(minBox, maxBox), `${caseName} at ${width}px: min/max overlap`).toBe(false);
      }
    });
  }

  test("min === current === max: reads left-to-right as min | current | max", async ({ page }) => {
    await gotoHarness(page);
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 21, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 0, { unit_of_measurement: "°C", minimum: 21, maximum: 21 }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
    const card = page.locator(`#${cardId}`);
    await setCardWidth(page, cardId, 420);
    const currentBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
    const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
    const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
    expect(minBox.x, "min must read left of current").toBeLessThan(currentBox.x);
    expect(currentBox.x, "current must read left of max").toBeLessThan(maxBox.x);
  });

  test("current outside [min,max]: current stays at its own anchor, min/max are both packed on the correct single side in the correct relative order", async ({ page }) => {
    await gotoHarness(page);
    // current (30) is above both min (18) and max (23) -> both min and max
    // must be packed to the LEFT of the fixed current label, preserving
    // min < max order between themselves.
    const states = {
      "sensor.avg": mkStateObj("sensor.avg", 30, TEMPERATURE_C),
      "sensor.range": mkStateObj("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
    const card = page.locator(`#${cardId}`);
    await setCardWidth(page, cardId, 420);
    const currentLabelBox = await card.locator(".rtc-range-scale-label-current").first().boundingBox();
    const currentMarkerBox = await card.locator(".rtc-marker-avg").first().boundingBox();
    const labelCenter = currentLabelBox.x + currentLabelBox.width / 2;
    const markerCenter = currentMarkerBox.x + currentMarkerBox.width / 2;
    expect(Math.abs(labelCenter - markerCenter), "current must stay at its own anchor even when current is outside [min,max]").toBeLessThanOrEqual(1.5);

    const minBox = await card.locator(".rtc-range-scale-label-min").first().boundingBox();
    const maxBox = await card.locator(".rtc-range-scale-label-max").first().boundingBox();
    expect(minBox.x, "min must be left of max (their own relative order preserved)").toBeLessThan(maxBox.x);
    expect(maxBox.x + maxBox.width, "both min and max must be packed left of current, not straddling it").toBeLessThanOrEqual(currentLabelBox.x);
  });
});

test("hidden comfort/optimal bands also omit their labels while scale-edge labels stay pinned to the row edges", async ({ page }) => {
  await gotoHarness(page);
  const states = {
    "sensor.avg": mkStateObj("sensor.avg", 22, TEMPERATURE_C),
  };
  const cardId = await createCard(
    page,
    {
      entity: "sensor.avg",
      views: [{ type: "scale", options: { show_comfort_band: false, show_optimal_band: false } }],
    },
    states,
    "en"
  );
  await setCardWidth(page, cardId, 420);
  const card = page.locator(`#${cardId}`);

  await expect(card.locator(".rtc-comfort-band")).toHaveCount(0);
  await expect(card.locator(".rtc-scale-comfort-label")).toHaveCount(0);
  await expect(card.locator(".rtc-optimal-band")).toHaveCount(0);
  await expect(card.locator(".rtc-scale-label-center")).toHaveCount(0);

  const [rowBox, minBox, maxBox] = await Promise.all([
    card.locator(".rtc-scale-labels").boundingBox(),
    card.locator(".rtc-scale-label-min").boundingBox(),
    card.locator(".rtc-scale-label-max").boundingBox(),
  ]);
  expect(Math.abs(minBox.x - rowBox.x), "minimum label must remain pinned to the left edge").toBeLessThanOrEqual(1.5);
  expect(Math.abs(maxBox.x + maxBox.width - (rowBox.x + rowBox.width)), "maximum label must remain pinned to the right edge").toBeLessThanOrEqual(1.5);
});

// The comfort label sits above the bar, centred on the comfort band's own centre. Until
// this was pinned, nothing stopped it there: a band pushed towards one end of the axis
// carried its label past the view's edge, where a solo view clipped it against the
// rotator and a carousel painted it straight across the slide next door. All four
// metrics reach that state with ordinary readings — CO2 from about 1200 ppm, PM2.5 from
// about 24 µg/m³, and temperature at both ends (35 °C leaves on the left, 5 °C on the
// right).
//
// The container queries are what make the narrow widths meaningful here, and they need a
// block-level ha-card to apply to at all (see the same note in
// narrow-width-overflow.spec.js). Installed per test rather than in a beforeEach, so the
// rest of this file keeps measuring exactly what it measured before.
test.describe(".rtc-scale-comfort-label stays inside its own view", () => {
  async function gotoHarnessWithBlockCard(page) {
    await page.addInitScript(() => {
      if (!customElements.get("ha-card")) {
        customElements.define("ha-card", class extends HTMLElement {
          connectedCallback() {
            this.style.display = "block";
          }
        });
      }
    });
    await gotoHarness(page);
  }

  const OVERFLOW_CASES = [
    ["co2", "carbon_dioxide", "ppm", 2252, "left"],
    ["co2", "carbon_dioxide", "ppm", 5000, "left"],
    ["pm25", "pm25", "µg/m³", 118.4, "left"],
    ["temperature", "temperature", "°C", 35, "left"],
    ["temperature", "temperature", "°C", 5, "right"],
    ["humidity", "humidity", "%", 5, "right"],
    // The control: a comfort band in the middle of the axis, which never needed
    // clamping and must not be moved by it either.
    ["temperature", "temperature", "°C", 22, "neither"],
  ];

  function scaleOnlyCard(page, value, deviceClass, unit) {
    const attributes = { device_class: deviceClass, unit_of_measurement: unit };
    return createCard(
      page,
      { entity: "sensor.avg", auto_slide: false, views: [{ type: "scale" }] },
      { "sensor.avg": mkStateObj("sensor.avg", value, attributes) },
      // German has the longest comfort label of the languages sharing this layout, so
      // the assertion is made against the hardest realistic text.
      "de"
    );
  }

  // Measured against the comfort ROW, which is the label's own containing block and,
  // being a grid item of the same single-column .rtc-scale-view, exactly as wide as the
  // bar its percentage refers to.
  async function comfortLabelBox(page, cardId) {
    return page.evaluate((cardId) => {
      const view = document.getElementById(cardId).shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      const bar = view.querySelector(".rtc-scale-bar");
      const labelRect = label.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        hidden: label.hidden,
        overLeftEdge: rowRect.left - labelRect.left,
        overRightEdge: labelRect.right - rowRect.right,
        centre: labelRect.left + labelRect.width / 2 - rowRect.left,
        rowWidth: rowRect.width,
        barWidth: bar.getBoundingClientRect().width,
      };
    }, cardId);
  }

  for (const [mode, deviceClass, unit, value, escapes] of OVERFLOW_CASES) {
    test(`${mode} ${value} ${unit} keeps its comfort label inside the row (escapes ${escapes} today)`, async ({ page }) => {
      await gotoHarnessWithBlockCard(page);
      const cardId = await scaleOnlyCard(page, value, deviceClass, unit);
      for (const width of [320, 400, 520, 700]) {
        await setCardWidth(page, cardId, width);
        const measured = await comfortLabelBox(page, cardId);
        if (measured.hidden) continue;
        expect(
          measured.overLeftEdge,
          `${mode} ${value} ${unit} at ${width}px reaches ${measured.overLeftEdge.toFixed(1)}px past the left edge`
        ).toBeLessThanOrEqual(0.5);
        expect(
          measured.overRightEdge,
          `${mode} ${value} ${unit} at ${width}px reaches ${measured.overRightEdge.toFixed(1)}px past the right edge`
        ).toBeLessThanOrEqual(0.5);
      }
    });
  }

  // The clamp mixes two boxes: the percentage is a position on the AXIS, the containment
  // is against the ROW. They are the same width because both are items of the same
  // single-column grid — stated here so a future change to that grid fails loudly
  // instead of quietly displacing every comfort label by the difference.
  test("the comfort row and the scale bar are exactly as wide as each other", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    for (const width of [320, 520]) {
      await setCardWidth(page, cardId, width);
      const measured = await comfortLabelBox(page, cardId);
      expect(measured.rowWidth, `at ${width}px the label's containing block must match the bar`).toBeCloseTo(measured.barWidth, 1);
    }
  });

  // A clamp that also moved the labels which were never in trouble would be a regression
  // dressed as a fix.
  test("a comfort band in the middle of the axis keeps its label over the band's centre", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    for (const width of [400, 520, 700]) {
      await setCardWidth(page, cardId, width);
      const measured = await comfortLabelBox(page, cardId);
      const bandCentre = await page.evaluate((cardId) => {
        const view = document.getElementById(cardId).shadowRoot.querySelector(".rtc-scale-view");
        const band = view.querySelector(".rtc-comfort-band");
        const row = view.querySelector(".rtc-scale-comfort-row");
        const bandRect = band.getBoundingClientRect();
        return bandRect.left + bandRect.width / 2 - row.getBoundingClientRect().left;
      }, cardId);
      expect(measured.centre, `at ${width}px the label must stay centred on its band`).toBeCloseTo(bandCentre, 0);
    }
  });

  // Before the clamp and long before the ellipsis, the label may swap to its own short
  // form — the same intermediate step the optimal label takes, because a real word beats
  // a truncated one whenever a real word fits.
  //
  // Every one of the fifteen languages currently declares a short form identical to its
  // long one, so nothing in the shipped card exercises this. Substituting a genuinely
  // shorter pair on the live content model is therefore the only way to tell "the short
  // form is chosen when it has to be" apart from "the key is still never read".
  test("a comfort label that does not fit falls back to its short form before being clamped", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    await setCardWidth(page, cardId, 320);
    const measured = await page.evaluate((cardId) => {
      const card = document.getElementById(cardId);
      const view = card.shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      const model = card._renderController.lastViewModel;
      const content = model.views.byKey.scale;
      const read = () => {
        card._resolveViewLayouts(model);
        const labelRect = label.getBoundingClientRect();
        return {
          text: label.textContent,
          overLeftEdge: row.getBoundingClientRect().left - labelRect.left,
          clipped: label.scrollWidth > label.clientWidth + 0.5,
        };
      };
      // A long form far too wide for the row, and a short form that fits it comfortably.
      content.comfortLabel.long = "Ein sehr langer Komfortbereich der hier niemals hineinpasst";
      content.comfortLabel.short = "20–24°C Komf.";
      const shortened = read();
      // And the other direction: a long form that fits must not be shortened.
      content.comfortLabel.long = "20–24°C Komfort";
      const kept = read();
      return { shortened, kept };
    }, cardId);
    expect(measured.shortened.text, "the short form has to be chosen when the long one cannot fit").toBe("20–24°C Komf.");
    expect(measured.shortened.clipped, "and it must fit without being truncated on top of that").toBe(false);
    expect(measured.shortened.overLeftEdge, "the shortened label still has to be inside the row").toBeLessThanOrEqual(0.5);
    expect(measured.kept.text, "a long form that fits must not be shortened").toBe("20–24°C Komfort");
  });

  // The last resort, below which there is nothing left to move: a row narrower than the
  // label itself. Clipping with an ellipsis is the answer every other single-line label
  // on this card gives.
  test("a label wider than the whole row truncates instead of leaving it", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const cardId = await scaleOnlyCard(page, 22, "temperature", "°C");
    await setCardWidth(page, cardId, 320);
    const measured = await page.evaluate((cardId) => {
      const card = document.getElementById(cardId);
      const view = card.shadowRoot.querySelector(".rtc-scale-view");
      const label = view.querySelector(".rtc-scale-comfort-label");
      const row = view.querySelector(".rtc-scale-comfort-row");
      // Substituted on the content model rather than on the node: the layout pass owns
      // the text and would overwrite anything written straight into the DOM. BOTH forms
      // are overlong, so this is the case where there is nothing left to fall back to.
      const model = card._renderController.lastViewModel;
      const overlong = "Ein garantiert viel zu langer Komfortbereich der niemals in diese Zeile passt";
      model.views.byKey.scale.comfortLabel.long = overlong;
      model.views.byKey.scale.comfortLabel.short = overlong;
      // The layout pass runs on render, on resize and on fonts.ready; a change made from
      // a test is none of those, so it is invoked the way the card would invoke it.
      card._resolveViewLayouts(model);
      const labelRect = label.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const style = getComputedStyle(label);
      return {
        overLeftEdge: rowRect.left - labelRect.left,
        overRightEdge: labelRect.right - rowRect.right,
        clipped: label.scrollWidth > label.clientWidth + 0.5,
        overflow: style.overflowX,
        textOverflow: style.textOverflow,
      };
    }, cardId);
    expect(measured.overflow, "the label must clip its own overflow").toBe("hidden");
    expect(measured.textOverflow, "a clipped label must end in an ellipsis").toBe("ellipsis");
    expect(measured.clipped, "this text must genuinely be too long, or the test proves nothing").toBe(true);
    expect(measured.overLeftEdge, "even the truncated label must not leave the row").toBeLessThanOrEqual(0.5);
    expect(measured.overRightEdge).toBeLessThanOrEqual(0.5);
  });

  // The failure a user actually sees: nothing clips an individual carousel slide, so a
  // label that leaves its own view is painted over the one beside it.
  test("in a carousel the comfort label never reaches into the neighbouring view", async ({ page }) => {
    await gotoHarnessWithBlockCard(page);
    const attributes = CO2;
    const cardId = await createCard(
      page,
      {
        entity: "sensor.avg",
        range_entity: "sensor.range",
        auto_slide: false,
        views: [{ type: "range_scale", enabled: true }, { type: "scale" }],
      },
      {
        "sensor.avg": mkStateObj("sensor.avg", 2252, attributes),
        "sensor.range": mkStateObj("sensor.range", 900, { unit_of_measurement: "ppm", minimum: 1800, maximum: 2700 }),
      },
      "de"
    );
    for (const width of [320, 400, 520]) {
      await setCardWidth(page, cardId, width);
      const leftOfOwnView = await page.evaluate((cardId) => {
        const root = document.getElementById(cardId).shadowRoot;
        const scaleView = root.querySelector(".rtc-scale-view");
        const label = scaleView.querySelector(".rtc-scale-comfort-label").getBoundingClientRect();
        return scaleView.getBoundingClientRect().left - label.left;
      }, cardId);
      expect(
        leftOfOwnView,
        `at ${width}px the label reaches ${leftOfOwnView.toFixed(1)}px past its own view and into the slide beside it`
      ).toBeLessThanOrEqual(0.5);
    }
  });
});

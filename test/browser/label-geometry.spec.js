"use strict";

// UI-01 (v2.15.0 audit) with REAL layout — jsdom (test/unit/) can only test
// the label-placement algorithm against mocked getBoundingClientRect()
// widths; this exercises the actual browser text-measurement/CSS pipeline.
// Audit checklist ("Label-Geometrie"): 11 languages x 4 modes x bar widths,
// min=avg=max, close together, far apart, avg outside min/max, no overlap
// or an explicitly-tested ellipsis fallback.
//
// Coverage note (honestly scoped, not the full 5x4x23-width audit matrix):
// all 11 languages x all 4 modes at 5 representative widths (280/320/380/
//420/500px) for both the main scale's optimal-label-vs-min/max case and
// the rangeScale 3-label solver, plus one deliberately narrow two-line
// fallback case. A finer-grained width sweep would mostly be
// redundant with the deterministic solver already covered exactly in
// test/unit/ — this layer's job is confirming REAL text metrics don't
// break the algorithm's assumptions, not re-testing the algorithm itself.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");

const LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh", "nb", "sv", "lv"];
// Matches the audit's own stated range ("Balkenbreiten 280-500 px"). Widths
// below ~270px push some mode/language combinations (verified: co2 in
// en/de/nl) into the already-documented, pre-existing "extreme narrow bar +
// long text" limitation of _resolveOptimalLabelPosition() (see "Skala",
// "Bewusst nicht geloest" in the dev doc) — a known, accepted gap, not a
// regression, and out of scope to fix in a test-only round.
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
  // narrowest audited width (280px) — not a real, visually-perceptible
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

async function setHostWidth(page, cardId, widthPx) {
  await page.evaluate(
    ({ cardId, widthPx }) => {
      document.getElementById(cardId).style.width = `${widthPx}px`;
    },
    { cardId, widthPx }
  );
  // Let the CSS container-query/layout settle before measuring.
  await page.waitForTimeout(120); // let ResizeObserver/rAF-batched relayout settle before measuring
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
          await setHostWidth(page, cardId, width);
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
          "sensor.avg": mkStateObj("sensor.avg", v.avg, { device_class: "temperature", unit_of_measurement: "°C" }),
          "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
        };
        const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, lang);
        const card = page.locator(`#${cardId}`);
        for (const width of WIDTHS) {
          await setHostWidth(page, cardId, width);
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

test.describe("UI-01 regression (v2.16.0 audit): label reading order must match the displayed (rounded) numbers, not the raw anchor position", () => {
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
        "sensor.avg": mkStateObj("sensor.avg", v.current, { device_class: "temperature", unit_of_measurement: "°C" }),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      await setHostWidth(page, cardId, 420); // wide enough that no ellipsis-shrink path interferes with pure ordering
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

test.describe("UI-01 follow-up (AP-06, audit section 15): grouped/thousands-separated numbers must sort correctly", () => {
  // _resolveRangeScaleLabels() used to tie-break min/max sides via
  // Number(getNumberFormat("en-US", digits).format(value)) — for a
  // thousands-grouped number (e.g. co2 "1,200"), Number("1,200") is NaN,
  // and NaN !== NaN is always true while NaN < NaN is always false, so the
  // side assignment always fell through to "right" regardless of the
  // actual value. co2 (decimals: 0) is the metric where every value >=1000
  // triggers grouping, making this reproducible with realistic ppm values.
  const CASES = {
    "min below 1000, current and max grouped (>=1000)": { min: 800, current: 1200, max: 1600 },
    "all three grouped and close together (realistic co2 spike)": { min: 1150, current: 1200, max: 1300 },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.current, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "ppm", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      await setHostWidth(page, cardId, 420);
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
  // this intentionally (see room-climate-card.js and "Tagesbereich-Balken-
  // Ansicht" in the dev doc): min/max are assigned to whichever side of the
  // fixed current pivot they numerically belong on, so BOTH land on the
  // same side (packed in their own min-before-max order) instead of a
  // naive always-"min current max" text order that would misrepresent
  // which value is actually highest. This is a REGRESSION GUARD proving
  // that behavior, not a bug fix -- see this round's Umsetzungsnotiz.
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
        "sensor.avg": mkStateObj("sensor.avg", v.current, { device_class: "temperature", unit_of_measurement: "°C" }),
        "sensor.range": mkStateObj("sensor.range", v.max - v.min, { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(
        page,
        { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
        states,
        "de"
      );
      const card = page.locator(`#${cardId}`);
      await setHostWidth(page, cardId, 420);
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
    "sensor.avg": mkStateObj("sensor.avg", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
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
  await setHostWidth(page, cardId, 240);
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
    "sensor.avg": mkStateObj("sensor.avg", 26, { device_class: "temperature", unit_of_measurement: "°C" }),
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
  await setHostWidth(page, cardId, 529);
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
    "sensor.avg": mkStateObj("sensor.avg", 10, { device_class: "temperature", unit_of_measurement: "°C" }),
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
  await setHostWidth(page, cardId, 529);
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
  // Regression coverage for the reported bug: a collision between current
  // and a neighbor (typically min, when values are close together) used to
  // let the shared forward-/backward-pass declutter algorithm drag the
  // CURRENT label away from its own marker — visually detaching "jetzt"/
  // "now" from the current-value marker and leaving it to read as though it
  // belonged to a different marker (usually max). current must now be a
  // fixed pivot: only min/max are ever allowed to move away from their own
  // anchors to avoid a collision.
  const CASES = {
    "no collision (far apart)": { min: 12, avg: 20, max: 29 },
    // The exact reported scenario: current and min sit close enough
    // together that the old shared 3-label declutter pass would drag
    // current itself rightward to clear the collision.
    "current close to min (close together)": { min: 20.8, avg: 21.0, max: 21.2 },
    "current essentially equal to min": { min: 21.0, avg: 21.02, max: 25.0 },
    "current essentially equal to max": { min: 15.0, avg: 24.98, max: 25.0 },
    "min === current === max": { min: 21, avg: 21, max: 21 },
  };
  for (const [caseName, v] of Object.entries(CASES)) {
    test(caseName, async ({ page }) => {
      await gotoHarness(page);
      const states = {
        "sensor.avg": mkStateObj("sensor.avg", v.avg, { device_class: "temperature", unit_of_measurement: "°C" }),
        "sensor.range": mkStateObj("sensor.range", Math.abs(v.max - v.min), { unit_of_measurement: "°C", minimum: v.min, maximum: v.max }),
      };
      const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
      const card = page.locator(`#${cardId}`);
      for (const width of [300, 420]) {
        await setHostWidth(page, cardId, width);
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
      "sensor.avg": mkStateObj("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 0, { unit_of_measurement: "°C", minimum: 21, maximum: 21 }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
    const card = page.locator(`#${cardId}`);
    await setHostWidth(page, cardId, 420);
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
      "sensor.avg": mkStateObj("sensor.avg", 30, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkStateObj("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
    };
    const cardId = await createCard(page, { entity: "sensor.avg", range_entity: "sensor.range", auto_slide: false, views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] }, states, "en");
    const card = page.locator(`#${cardId}`);
    await setHostWidth(page, cardId, 420);
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
    "sensor.avg": mkStateObj("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
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
  await setHostWidth(page, cardId, 420);
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

"use strict";

// Deterministic randomized browser geometry: random widths / room counts / languages /
// modes / view configs, asserting real-layout invariants (no overlapping labels beyond the
// declared gap, no child wider than its container). Not screenshot-based — fixed baselines
// do not suit randomized inputs. Fixed seed for a reproducible CI run.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, createCard, mkStateObj, setCardWidth } = require("../../helpers/browser-helpers");
const { SeededRandom } = require("../../helpers/seeded-random.js");

const SEED = 0xc1a6e;
const ITERATIONS = 30;
// From the manifest — see test/manifests/product-surface.js.
const { LANGUAGES } = require("../../manifests/product-surface.js");
const { CO2, HUMIDITY, PM25, TEMPERATURE_C } = require("../../fixtures/attributes.js");
const MODES = {
  temperature: { attributes: TEMPERATURE_C, low: -20, high: 45 },
  humidity: { attributes: HUMIDITY, low: 0, high: 100 },
  co2: { attributes: CO2, low: 1, high: 3000 },
  pm25: { attributes: PM25, low: 0, high: 400 },
};

function genCase(rng) {
  const mode = rng.pick(Object.keys(MODES));
  const fx = MODES[mode];
  const width = rng.int(280, 700);
  const roomCount = rng.int(0, 20);
  const language = rng.pick(LANGUAGES);
  const hasRange = rng.bool(0.5);
  const rangeScale = hasRange && rng.bool(0.5);
  const disabledViews = rng.bool(0.3) ? [rng.pick(["range", "extremes", "range_scale"])] : undefined;
  const viewOrder = rng.bool(0.3) ? rng.pick([["scale", "extremes", "range"], ["extremes", "range", "scale"], ["scale"]]) : undefined;
  const darkMode = rng.bool(0.5);
  const reducedMotion = rng.bool(0.3);
  return { mode, fx, width, roomCount, language, hasRange, rangeScale, disabledViews, viewOrder, darkMode, reducedMotion };
}

// views: is fully authoritative once present, so the generator's ordering, disabling and
// range-scale choices are converted into one explicit views array per case.
function buildViewsList(c) {
  const naturalOrder = ["range", "range_scale", "scale", "extremes"];
  const requestedOrder = c.viewOrder || [];
  const seen = new Set(requestedOrder);
  const order = [...requestedOrder, ...naturalOrder.filter((type) => !seen.has(type))];
  const disabledSet = new Set(c.disabledViews || []);
  return order.map((type) => {
    if (disabledSet.has(type)) return { type, enabled: false };
    if (type === "range_scale") return { type, enabled: c.rangeScale === true };
    return { type, enabled: true };
  });
}

test.describe("randomized geometry invariants across width/roomCount/language/mode/view combinations", () => {
  const rng = new SeededRandom(SEED);
  const cases = Array.from({ length: ITERATIONS }, () => genCase(rng));

  cases.forEach((c, i) => {
    test(`case ${i}: ${c.mode}/${c.language} width=${c.width} rooms=${c.roomCount} range=${c.hasRange} rangeScale=${c.rangeScale}`, async ({ page }) => {
      if (c.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
      await page.emulateMedia({ colorScheme: c.darkMode ? "dark" : "light" });
      await gotoHarness(page);

      const states = { "sensor.avg": mkStateObj("sensor.avg", (c.fx.low + c.fx.high) / 2, c.fx.attributes) };
      const rooms = [];
      for (let r = 0; r < c.roomCount; r++) {
        const entity = `sensor.r${r}`;
        const value = c.fx.low + ((c.fx.high - c.fx.low) * r) / Math.max(1, c.roomCount - 1);
        states[entity] = mkStateObj(entity, value, c.fx.attributes);
        rooms.push({ entity, name: `Room ${r}` });
      }
      const config = { entity: "sensor.avg", rooms };
      if (c.hasRange) {
        // The range entity carries the metric's unit and its own min/max, but no device
        // class.
        states["sensor.range"] = mkStateObj("sensor.range", 3, {
          unit_of_measurement: c.fx.attributes.unit_of_measurement,
          minimum: c.fx.low,
          maximum: c.fx.high,
        });
        config.range_entity = "sensor.range";
      }
      if (c.disabledViews || c.viewOrder || c.rangeScale) config.views = buildViewsList(c);

      const errors = [];
      page.on("pageerror", (err) => errors.push(err));
      const cardId = await createCard(page, config, states, c.language);
      await setCardWidth(page, cardId, c.width);

      expect(errors, `case ${i}: unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);

      const card = page.locator(`#${cardId}`);
      const cardBox = await card.boundingBox();
      expect(cardBox, `case ${i}: card must render a bounding box`).toBeTruthy();

      // No classed structural element wider than the card's box — except inside .rtc-track,
      // which is views.length*100% wide and slid via transform, clipped by .rtc-rotator
      // (which must itself not overflow). Classless nodes and the *-value-unit spans are
      // skipped: an inline flex item's bounding rect reflects its unclipped natural width
      // even when a classed ancestor clips it via overflow:hidden.
      const overflowing = await page.evaluate((cardId) => {
        const el = document.getElementById(cardId);
        const cardRect = el.getBoundingClientRect();
        const all = el.shadowRoot.querySelectorAll("*");
        const bad = [];
        all.forEach((node) => {
          if (!node.className || node.closest(".rtc-track") || /-value-unit$/.test(node.className)) return;
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.right > cardRect.right + 1) {
            bad.push({ cls: node.className, right: r.right, cardRight: cardRect.right });
          }
        });
        return bad;
      }, cardId);
      expect(overflowing, `case ${i}: elements overflowing the card: ${JSON.stringify(overflowing)}`).toHaveLength(0);

      // Room-chip short labels (UI-02) must not overlap their own mark indicator.
      const chipOverlaps = await page.evaluate((cardId) => {
        const el = document.getElementById(cardId);
        const chips = Array.from(el.shadowRoot.querySelectorAll(".rtc-room-chip"));
        return chips
          .map((chip) => {
            const shortEl = chip.querySelector(".rtc-room-short");
            const markEl = chip.querySelector(".rtc-room-mark");
            if (!shortEl || !markEl) return null;
            const s = shortEl.getBoundingClientRect();
            const m = markEl.getBoundingClientRect();
            return s.right > m.left + 1 ? { shortRight: s.right, markLeft: m.left } : null;
          })
          .filter(Boolean);
      }, cardId);
      expect(chipOverlaps, `case ${i}: room-short label overlapping its mark indicator: ${JSON.stringify(chipOverlaps)}`).toHaveLength(0);
    });
  });
});

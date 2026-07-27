"use strict";

// Permanent randomized BROWSER geometry test (v2.16.0 audit, section 10.3):
// randomized widths/room counts/languages/modes/view configurations,
// asserting real-layout geometry invariants (no overlapping labels beyond
// the declared gap, no child wider than its container) — deliberately NOT
// screenshot-based (the audit explicitly calls fixed-baseline screenshots
// unsuitable for randomized inputs; only hand-picked, deliberately chosen
// cases belong in visual-golden.spec.js). Fixed seed for a reproducible CI
// run, same 0xC1A6E default as the jsdom property test.

const { test, expect } = require("@playwright/test");
const { gotoHarness, createCard, mkStateObj } = require("../helpers/browser-helpers");
const { SeededRandom } = require("../helpers/seeded-random.js");

const SEED = 0xc1a6e;
const ITERATIONS = 30;
const LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh"];
const MODES = {
  temperature: { device_class: "temperature", unit: "°C", low: -20, high: 45 },
  humidity: { device_class: "humidity", unit: "%", low: 0, high: 100 },
  co2: { device_class: "carbon_dioxide", unit: "ppm", low: 1, high: 3000 },
  pm25: { device_class: "pm25", unit: "µg/m³", low: 0, high: 400 },
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

// AP-04: views: is fully authoritative once present, unlike the old
// view_order (reordered but silently appended anything missing) and
// disabled_views (hid a view without touching order/availability). This
// helper re-derives the SAME observable behavior — natural registry order
// unless viewOrder reorders it (still appending any type it doesn't
// mention, exactly like the old view_order), disabledViews turning a type
// off, and range_scale requiring the explicit rangeScale flag on top of
// its own availability, just like the old range_scale_view — expressed as
// one explicit, fully-listed views: array per case.
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

      const states = { "sensor.avg": mkStateObj("sensor.avg", (c.fx.low + c.fx.high) / 2, { device_class: c.fx.device_class, unit_of_measurement: c.fx.unit }) };
      const rooms = [];
      for (let r = 0; r < c.roomCount; r++) {
        const entity = `sensor.r${r}`;
        const value = c.fx.low + ((c.fx.high - c.fx.low) * r) / Math.max(1, c.roomCount - 1);
        states[entity] = mkStateObj(entity, value, { device_class: c.fx.device_class, unit_of_measurement: c.fx.unit });
        rooms.push({ entity, name: `Room ${r}` });
      }
      const config = { entity: "sensor.avg", rooms };
      if (c.hasRange) {
        states["sensor.range"] = mkStateObj("sensor.range", 3, { unit_of_measurement: c.fx.unit, minimum: c.fx.low, maximum: c.fx.high });
        config.range_entity = "sensor.range";
      }
      if (c.disabledViews || c.viewOrder || c.rangeScale) config.views = buildViewsList(c);

      const errors = [];
      page.on("pageerror", (err) => errors.push(err));
      const cardId = await createCard(page, config, states, c.language);
      await page.evaluate(({ cardId, width }) => {
        document.getElementById(cardId).style.width = `${width}px`;
      }, { cardId, width: c.width });
      await page.waitForTimeout(150);

      expect(errors, `case ${i}: unexpected page errors: ${errors.map((e) => e.message).join(", ")}`).toHaveLength(0);

      const card = page.locator(`#${cardId}`);
      const cardBox = await card.boundingBox();
      expect(cardBox, `case ${i}: card must render a bounding box`).toBeTruthy();

      // No classed structural element wider than the card's own box (a
      // generic overflow guard covering UI-02 and any other structural
      // container the randomized width/room-count/language/mode
      // combination happens to stress) — EXCEPT inside .rtc-track, which is
      // deliberately views.length*100% wide and slid via transform, clipped
      // horizontally by .rtc-rotator's directional clip-path (see "Rendering und
      // Robustheit"/_viewWidthPct() in room-climate-card.js) —
      // .rtc-rotator itself must still not overflow. Anonymous/classless
      // nodes, plus the *-value-unit spans (AP-09, audit 18: the unit
      // suffix inside .rtc-avg-value/.rtc-room-value/.rtc-extreme-value —
      // an anonymous text node before AP-09 gave it a stable class for
      // keyed patching, same element either way) are skipped: an inline
      // flex item's own bounding rect reflects its unclipped natural
      // content width even when a classed ancestor visually clips it via
      // overflow:hidden (.rtc-room-chip at narrow widths, see there) —
      // checking those would flag normal clipping as a false positive, not
      // an actual layout defect (the classed container that actually needs
      // to stay in bounds is still checked).
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

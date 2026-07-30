"use strict";

// DATA-02/DATA-03 (v2.15.0 audit): a range/spread is physically Maximum -
// Minimum and can never be negative; a negative range_entity state must not
// activate the daily-range view, and a negative spread attribute must fall
// back to the locally-computed value instead of being displayed. Also
// covers rangeScale axis edge cases (Ø outside min/max, min=max, all three
// equal) from the audit's "Views und Live-Konfiguration" checklist.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { computeLegacyData } = require("../helpers/legacy-dto.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// ---- DATA-02: negative range_entity state ----

test("DATA-02: negative range_entity state does not activate hasRange", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", -5, { unit_of_measurement: "°C", minimum: 18, maximum: 13 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, false);
  assert.equal(el._views.length, 1);
  assert.equal(el._views[0], "scale");
  env.cleanup(el);
});

test("DATA-02 control: a positive range_entity state does activate hasRange", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  env.cleanup(el);
});

test("DATA-02: a zero range_entity state is valid (min === max, a physically possible constant day)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 0, { unit_of_measurement: "°C", minimum: 20, maximum: 20 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  assert.equal(data.rangeMin, 20);
  assert.equal(data.rangeMax, 20);
  env.cleanup(el);
});

// ---- AP-06 (audit section 16.2): rangeState must be exposed in the
// ViewModel, as the authoritative daily span — never recomputed from
// rangeMax - rangeMin, and 0 is a valid value, not treated as missing.

test("AP-06: data.rangeState is exposed and equals the converted range_entity state, not rangeMax - rangeMin", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    // State (5) deliberately differs from maximum-minimum (23-18=5 here
    // would coincide; use a state that would NOT match max-min to prove
    // the state itself is authoritative, not derived from the attributes.
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  assert.equal(data.rangeState, 3, "rangeState must be the range_entity's own converted state, not rangeMax - rangeMin (5)");
  env.cleanup(el);
});

test("AP-06: rangeState === 0 is valid and exposed as 0, not null/false", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 0, { unit_of_measurement: "°C", minimum: 20, maximum: 20 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  assert.equal(data.rangeState, 0);
  env.cleanup(el);
});

test("AP-06: a range_entity with no unit at all exposes rangeState as null (rangeProfile unresolvable), consistent with hasRange:false", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, false);
  assert.equal(data.rangeState, null);
  env.cleanup(el);
});

// ---- DATA-03: negative spread attribute ----

test("DATA-03: negative spread attribute is rejected, falls back to the locally-computed room spread", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: -3 }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.spread, 5, "must fall back to warmest(25) - coolest(20) = 5, not the negative attribute");
  env.cleanup(el);
});

test("DATA-03 control: a valid non-negative spread attribute is used as-is", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: 3.1 }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.spread, 3.1, "a valid attribute must win over the locally-computed value");
  env.cleanup(el);
});

test("DATA-03: a zero spread attribute is valid (all rooms report the same value)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: 0 }),
    "sensor.r1": mkState("sensor.r1", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.spread, 0);
  env.cleanup(el);
});

// ---- rangeScale axis edge cases (DATA-04 from the v2.14.0 audit: axis
// must include the avg marker, not just daily min/max) ----

function rangeScaleFixture(avg, rangeState, minimum, maximum) {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", avg, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", rangeState, { unit_of_measurement: "°C", minimum, maximum }),
  });
  return env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    hass
  );
}

test("rangeScale axis: avg outside [min,max] is not clamped to the 0/100% edge", () => {
  const el = rangeScaleFixture(30, 5, 18, 23); // avg way above the daily range
  const data = computeLegacyData(el);
  assert.ok(data.rangeCurrentPos > 0 && data.rangeCurrentPos < 100, `rangeCurrentPos=${data.rangeCurrentPos} must not be clamped to an edge`);
  env.cleanup(el);
});

test("rangeScale axis: avg inside [min,max] sits strictly between 0 and 100%", () => {
  const el = rangeScaleFixture(20, 5, 18, 23);
  const data = computeLegacyData(el);
  assert.ok(data.rangeCurrentPos > 0 && data.rangeCurrentPos < 100);
  env.cleanup(el);
});

test("rangeScale axis: min === max (a fully flat day) does not throw or divide by zero", () => {
  const el = rangeScaleFixture(20, 0, 20, 20);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  assert.equal(Number.isFinite(data.rangeCurrentPos), true);
  assert.equal(Number.isFinite(data.rangeMinPos), true);
  assert.equal(Number.isFinite(data.rangeMaxPos), true);
  env.cleanup(el);
});

test("rangeScale axis: avg === min === max (all three identical) does not throw", () => {
  const el = rangeScaleFixture(20, 0, 20, 20);
  const data = computeLegacyData(el);
  assert.equal(Number.isFinite(data.rangeCurrentPos), true);
  env.cleanup(el);
});

test("rangeScale: missing minimum_zeitpunkt/maximum_zeitpunkt attributes leave time fields null, not throwing", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 21 }), // no *_zeitpunkt
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, true);
  assert.equal(data.rangeMinTime, null);
  assert.equal(data.rangeMaxTime, null);
  env.cleanup(el);
});

// ---- AP-06 (audit section 16): RangeScale's own localized daily footer —
// must show span/min/max, never the room-comfort footer text, and must
// work without any rooms configured at all.

function rangeScaleFooterFixture(config, states, lang) {
  const hass = mkHass(states);
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }], language: lang, ...config },
    hass
  );
  return el;
}

test("AP-06: RangeScale footer without any rooms configured shows span/min/max, not the room-comfort footer", () => {
  const el = rangeScaleFooterFixture(
    {},
    {
      "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkState("sensor.range", 5, {
        unit_of_measurement: "°C",
        minimum: 18,
        maximum: 23,
        minimum_zeitpunkt: "2026-07-23T05:00:00+00:00",
        maximum_zeitpunkt: "2026-07-23T15:00:00+00:00",
      }),
    },
    "en"
  );
  const footerEl = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
  assert.ok(footerEl, "RangeScale footer must render even with zero rooms configured");
  const text = footerEl.textContent;
  assert.match(text, /span/i);
  assert.match(text, /18/);
  assert.match(text, /23/);
  assert.doesNotMatch(text, /comfort/i, "must never show the room-comfort footer text");
  env.cleanup(el);
});

test("AP-06: RangeScale footer falls back to '–' for a missing timestamp, without throwing", () => {
  const el = rangeScaleFooterFixture(
    {},
    {
      "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }), // no *_zeitpunkt
    },
    "en"
  );
  const footerEl = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
  assert.ok(footerEl);
  assert.match(footerEl.textContent, /–/, "missing timestamps must render as the established '–' fallback");
  env.cleanup(el);
});

test("AP-06: hide_footer suppresses the RangeScale footer entirely", () => {
  const el = rangeScaleFooterFixture(
    { hide_footer: true },
    {
      "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
      "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
    },
    "en"
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer"), null);
  env.cleanup(el);
});

test("AP-06: RangeScale footer text differs by language (localized, not hardcoded English)", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  };
  const en = rangeScaleFooterFixture({}, states, "en");
  const de = rangeScaleFooterFixture({}, states, "de");
  const enText = en.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer").textContent;
  const deText = de.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer").textContent;
  assert.ok(enText.length > 0);
  assert.ok(deText.length > 0);
  assert.notEqual(enText, deText, "en and de footer text must actually differ (not a hardcoded fallback string)");
  env.cleanup(en);
  env.cleanup(de);
});

test("I18N-02: RangeScale footer renders without throwing in all 11 supported languages", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  };
  for (const lang of ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh"]) {
    const el = rangeScaleFooterFixture({}, states, lang);
    const footerEl = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
    assert.ok(footerEl && footerEl.textContent.length > 0, `lang=${lang}: footer must render non-empty text`);
    env.cleanup(el);
  }
});

// ---- DATA-03 (v2.16.0 audit): main scale must include avg, same as the
// rangeScale axis already does (DATA-04, v2.15.0) — a weighted/independent
// average source falling outside [coolest, warmest] must not clamp the avg
// marker to the scale edge. ----

test("DATA-03: main scale expands to include avg when avg is above both coolest and warmest", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 30, { device_class: "temperature", unit_of_measurement: "°C" }), // independent source, well above both rooms
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.ok(data.avgPos < 100, `avgPos=${data.avgPos} must not be clamped to the right edge`);
  assert.ok(data.scaleMax >= data.avg, "scaleMax must cover avg");
  env.cleanup(el);
});

test("DATA-03: main scale expands to include avg when avg is below both coolest and warmest", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 5, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.ok(data.avgPos > 0, `avgPos=${data.avgPos} must not be clamped to the left edge`);
  assert.ok(data.scaleMin <= data.avg, "scaleMin must cover avg");
  env.cleanup(el);
});

test("DATA-03: main scale unaffected when avg already sits inside [coolest, warmest] (no regression)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = computeLegacyData(el);
  assert.ok(data.avgPos > 0 && data.avgPos < 100);
  env.cleanup(el);
});

// ---- Review fix (post-AP-01..03, P0): range_entity/trend_entity must be
// typed and unit-converted, not read raw. range_entity's own state is a
// DELTA (today's spread), min/max attributes are ABSOLUTE readings,
// trend_entity's state is a RATE (same conversion factor as delta, audit
// 9.5) — each projected through the range/trend entity's OWN
// unit_of_measurement into the card's canonical unit, then into the
// resolved display unit (_resolveAuxiliaryUnitProfile()), exactly like the
// pre-existing spread-attribute conversion a few tests above. ----

test("review fix: range_entity reporting in a DIFFERENT unit than the display unit is converted, not passed through raw", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    // range_entity's OWN unit is Fahrenheit while the card displays Celsius.
    "sensor.range": mkState("sensor.range", 9, { unit_of_measurement: "°F", minimum: 64.4, maximum: 73.4 }), // 9°F delta, 18°C..23°C as °F
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(el._unit(), "°C");
  assert.equal(data.hasRange, true);
  assert.ok(Math.abs(data.rangeMin - 18) < 1e-9, `rangeMin must convert 64.4°F -> 18°C, got ${data.rangeMin}`);
  assert.ok(Math.abs(data.rangeMax - 23) < 1e-9, `rangeMax must convert 73.4°F -> 23°C, got ${data.rangeMax}`);
  env.cleanup(el);
});

test("review fix: range_entity's own state is converted as a DELTA (not an absolute) — a negative-after-conversion delta still disables hasRange, proving the delta path (not a skipped/absolute one) actually runs", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    // -18°F as a DELTA converts to -10°C (deltaToCanonical has no +32/-32
    // offset); if the code wrongly treated this as an ABSOLUTE value
    // instead, toCanonical() would apply the offset and yield a very
    // different (still negative) number — either way hasRange must be
    // false, but only the delta path yields exactly -10.
    "sensor.range": mkState("sensor.range", -18, { unit_of_measurement: "°F", minimum: 60, maximum: 70 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, false, "a negative range_entity delta (even after correct unit conversion) must never activate the range view");
  env.cleanup(el);
});

test("review fix: range_entity with an explicit but UNRESOLVABLE unit is diagnosed as unusable, never silently treated as canonical", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "hPa", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, false, "an incompatible range_entity unit must disable the range view, never show an unconverted number");
  assert.equal(data.rangeMin, null);
  assert.equal(data.rangeMax, null);
  env.cleanup(el);
});

test("review fix (P0, post-2.21.1): range_entity with NO unit_of_measurement at all is unusable — no more canonical fallback, hasRange stays false", () => {
  // Inverted by the P0 review fix: a COMPLETELY MISSING unit on range_entity
  // is now treated exactly like an unresolvable one (see
  // _resolveAuxiliaryUnitProfile()'s missing-unit branch, and the identical
  // Primary/Räume contract at _buildEntityModel()) — never silently assumed
  // canonical. This test used to assert the opposite (a no-op Celsius
  // fallback); the reviewer explicitly and repeatedly rejected that
  // asymmetry, so the assertion is now inverted to match the corrected
  // contract.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 5, { minimum: 18, maximum: 23 }), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.hasRange, false, "a missing range_entity unit must disable the range view, never silently assume canonical");
  assert.equal(data.rangeMin, null);
  assert.equal(data.rangeMax, null);
  env.cleanup(el);
});

test("review fix: trend_entity reporting a different unit is converted as a RATE (same factor as a delta, no absolute offset)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.trend": mkState("sensor.trend", 1.8, { unit_of_measurement: "°F" }), // +1.8°F/h == +1°C/h
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = computeLegacyData(el);
  assert.ok(Math.abs(data.trendValue - 1) < 1e-9, `trendValue must convert 1.8°F/h -> 1°C/h, got ${data.trendValue}`);
  assert.equal(data.trendUnit, "°C/h", "trendUnit must match the DISPLAY unit the (now-converted) number is actually expressed in");
  env.cleanup(el);
});

test("review fix: trend_entity using the conventional '<unit>/h' suffix (e.g. HA's own derivative/statistics helpers) still resolves, not just the bare absolute unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.trend": mkState("sensor.trend", -15, { unit_of_measurement: "ppm/h" }),
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.trendValue, -15, "'ppm/h' must resolve via the stripped 'ppm' unitProfile (co2's only, an identity conversion), not be rejected as unresolvable");
  assert.equal(data.trendUnit, "ppm/h");
  env.cleanup(el);
});

test("review fix: trend_entity with an unresolvable unit is unusable (trendValue null), never shown as a raw mismatched number", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.trend": mkState("sensor.trend", 3, { unit_of_measurement: "hPa" }),
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = computeLegacyData(el);
  assert.equal(data.trendValue, null);
  env.cleanup(el);
});

"use strict";

// A range or spread is physically maximum minus
// Minimum and can never be negative; a negative range_entity state must not
// activate the daily-range view, and a negative spread attribute must fall
// back to the locally-computed value instead of being displayed. Also
// covers rangeScale axis edge cases (average outside min/max, min=max, all
// three equal).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { LANGUAGES } = require("../../contracts/product-surface.js");
const { CO2, TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// ---- Negative range_entity state ----

test("DATA-02: negative range_entity state does not activate hasRange", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", -5, { unit_of_measurement: "°C", minimum: 18, maximum: 13 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, false);
  assert.equal(el._views.length, 1);
  assert.equal(el._views[0], "scale");
  env.cleanup(el);
});

test("DATA-02 control: a positive range_entity state does activate hasRange", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  env.cleanup(el);
});

test("DATA-02: a zero range_entity state is valid (min === max, a physically possible constant day)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 0, { unit_of_measurement: "°C", minimum: 20, maximum: 20 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  assert.equal(data.range.min, 20);
  assert.equal(data.range.max, 20);
  env.cleanup(el);
});

// ---- rangeState is exposed in the
// ViewModel, as the authoritative daily span — never recomputed from
// rangeMax - rangeMin, and 0 is a valid value, not treated as missing.

test("data.range.state equals the converted range_entity state", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    // State (5) deliberately differs from maximum-minimum (23-18=5 here
    // would coincide; use a state that would NOT match max-min to prove
    // the state itself is authoritative, not derived from the attributes.
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  assert.equal(data.range.state, 3, "rangeState must be the range_entity's own converted state, not rangeMax - rangeMin (5)");
  env.cleanup(el);
});

test("rangeState zero is valid and exposed as zero", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 0, { unit_of_measurement: "°C", minimum: 20, maximum: 20 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  assert.equal(data.range.state, 0);
  env.cleanup(el);
});

test("a range_entity without a unit exposes null rangeState and hasRange false", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 5, { minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, false);
  assert.equal(data.range.state, null);
  env.cleanup(el);
});

// ---- Negative spread attribute ----

test("DATA-03: negative spread attribute is rejected, falls back to the locally-computed room spread", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: -3 }),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 25, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.spread, 5, "must fall back to warmest(25) - coolest(20) = 5, not the negative attribute");
  env.cleanup(el);
});

test("DATA-03 control: a valid non-negative spread attribute is used as-is", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: 3.1 }),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 25, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.spread, 3.1, "a valid attribute must win over the locally-computed value");
  env.cleanup(el);
});

test("DATA-03: a zero spread attribute is valid (all rooms report the same value)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C", spread: 0 }),
    "sensor.r1": mkState("sensor.r1", 22, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 22, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.spread, 0);
  env.cleanup(el);
});

// ---- rangeScale axis includes the average marker, not just daily min/max ----

function rangeScaleFixture(avg, rangeState, minimum, maximum) {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", avg, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", rangeState, { unit_of_measurement: "°C", minimum, maximum }),
  });
  return env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }] },
    hass
  );
}

test("rangeScale axis: avg outside [min,max] is not clamped to the 0/100% edge", () => {
  const el = rangeScaleFixture(30, 5, 18, 23); // avg way above the daily range
  const data = el._computeViewModel();
  assert.ok((data.rangeScale?.markerPositions.current ?? 0) > 0 && (data.rangeScale?.markerPositions.current ?? 0) < 100, `rangeCurrentPos=${(data.rangeScale?.markerPositions.current ?? 0)} must not be clamped to an edge`);
  env.cleanup(el);
});

test("rangeScale axis: avg inside [min,max] sits strictly between 0 and 100%", () => {
  const el = rangeScaleFixture(20, 5, 18, 23);
  const data = el._computeViewModel();
  assert.ok((data.rangeScale?.markerPositions.current ?? 0) > 0 && (data.rangeScale?.markerPositions.current ?? 0) < 100);
  env.cleanup(el);
});

test("rangeScale axis: min === max (a fully flat day) does not throw or divide by zero", () => {
  const el = rangeScaleFixture(20, 0, 20, 20);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  assert.equal(Number.isFinite((data.rangeScale?.markerPositions.current ?? 0)), true);
  assert.equal(Number.isFinite((data.rangeScale?.markerPositions.min ?? 0)), true);
  assert.equal(Number.isFinite((data.rangeScale?.markerPositions.max ?? 0)), true);
  env.cleanup(el);
});

test("rangeScale axis: avg === min === max (all three identical) does not throw", () => {
  const el = rangeScaleFixture(20, 0, 20, 20);
  const data = el._computeViewModel();
  assert.equal(Number.isFinite((data.rangeScale?.markerPositions.current ?? 0)), true);
  env.cleanup(el);
});

test("rangeScale: missing minimum_zeitpunkt/maximum_zeitpunkt attributes leave time fields null, not throwing", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 21 }), // no *_zeitpunkt
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, true);
  assert.equal(data.range.minTime, null);
  assert.equal(data.range.maxTime, null);
  env.cleanup(el);
});

// ---- RangeScale's localized daily footer
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

test("RangeScale footer without rooms shows span/min/max", () => {
  const el = rangeScaleFooterFixture(
    {},
    {
      "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
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

// A range entity is complete with just its minimum and maximum; the timestamps are extra.
// Where they are absent the sentence simply does not mention a time — an empty bracket or
// a dash reads as a fault, and there is none.
test("a missing timestamp leaves no bracket behind in the RangeScale footer", () => {
  const el = rangeScaleFooterFixture(
    {},
    {
      "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
      "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
    },
    "en"
  );
  const footerEl = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
  assert.ok(footerEl);
  assert.doesNotMatch(footerEl.textContent, /[–(]/, footerEl.textContent);
  assert.match(footerEl.textContent, /Min 18\.0 °C · Max 23\.0 °C/);
  env.cleanup(el);
});

// Both spellings of the attribute are accepted, English first — the German one is what
// the card was first built against and stays supported.
test("the timestamp attributes are read in either spelling, English first", () => {
  const footerOf = (attributes) => {
    const el = rangeScaleFooterFixture(
      {},
      {
        "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
        "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23, ...attributes }),
      },
      "en"
    );
    const text = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer").textContent;
    env.cleanup(el);
    return text;
  };
  const german = footerOf({ minimum_zeitpunkt: "2026-08-23T07:12:00", maximum_zeitpunkt: "2026-08-23T17:41:00" });
  const english = footerOf({ minimum_timestamp: "2026-08-23T07:12:00", maximum_timestamp: "2026-08-23T17:41:00" });
  assert.equal(english, german, "the two spellings must produce the same sentence");
  assert.match(english, /\(07:12\).*\(17:41\)/);

  const both = footerOf({ minimum_timestamp: "2026-08-23T06:00:00", minimum_zeitpunkt: "2026-08-23T07:12:00" });
  assert.match(both, /\(06:00\)/, "English wins when both are present");
});

// Only one of the two is a perfectly ordinary state, and it must produce exactly one
// bracket rather than one bracket and one apology.
test("one timestamp present gives one bracket", () => {
  const el = rangeScaleFooterFixture(
    {},
    {
      "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
      "sensor.range": mkState("sensor.range", 5, {
        unit_of_measurement: "°C",
        minimum: 18,
        maximum: 23,
        minimum_timestamp: "2026-08-23T07:12:00",
      }),
    },
    "en"
  );
  const text = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer").textContent;
  assert.equal((text.match(/\(/g) || []).length, 1, text);
  assert.match(text, /Min 18\.0 °C \(07:12\) · Max 23\.0 °C/);
  env.cleanup(el);
});

test("hide_footer suppresses the RangeScale footer", () => {
  const el = rangeScaleFooterFixture(
    { hide_footer: true },
    {
      "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
      "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
    },
    "en"
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer"), null);
  env.cleanup(el);
});

test("RangeScale footer text is localized", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
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

test("I18N-02: RangeScale footer renders without throwing in every supported language", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "°C", minimum: 18, maximum: 23 }),
  };
  // The language list comes from the manifest. It used to be written out here, and it
  // stopped at eleven: Ukrainian, Norwegian, Swedish and Latvian shipped without this
  // test ever rendering a footer in them, while the test name still said "all".
  for (const lang of LANGUAGES) {
    const el = rangeScaleFooterFixture({}, states, lang);
    const footerEl = el.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
    assert.ok(footerEl && footerEl.textContent.length > 0, `lang=${lang}: footer must render non-empty text`);
    env.cleanup(el);
  }
});

// ---- The main scale must include the average. A weighted or independent
// average source falling outside [coolest, warmest] must not clamp the avg
// marker to the scale edge. ----

test("DATA-03: main scale expands to include avg when avg is above both coolest and warmest", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 30, TEMPERATURE_C), // independent source, well above both rooms
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 22, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(data.average.position < 100, `avgPos=${data.average.position} must not be clamped to the right edge`);
  assert.ok(data.scale.scaleMax >= data.average.value, "scaleMax must cover avg");
  env.cleanup(el);
});

test("DATA-03: main scale expands to include avg when avg is below both coolest and warmest", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 5, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 22, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(data.average.position > 0, `avgPos=${data.average.position} must not be clamped to the left edge`);
  assert.ok(data.scale.scaleMin <= data.average.value, "scaleMin must cover avg");
  env.cleanup(el);
});

test("DATA-03: main scale unaffected when avg already sits inside [coolest, warmest] (no regression)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 21, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 19, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
  const data = el._computeViewModel();
  assert.ok(data.average.position > 0 && data.average.position < 100);
  env.cleanup(el);
});

// ---- range_entity and trend_entity are
// typed and unit-converted, not read raw. range_entity's own state is a
// DELTA (today's spread), min/max attributes are ABSOLUTE readings,
// trend_entity's state is a rate with the same conversion factor as delta.
// Each is projected through the range/trend entity's own
// unit_of_measurement into the card's canonical unit, then into the
// resolved display unit (_resolveAuxiliaryUnitProfile()), exactly like the
// pre-existing spread-attribute conversion a few tests above. ----

test("range_entity in a different unit is converted to the display unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    // range_entity's OWN unit is Fahrenheit while the card displays Celsius.
    "sensor.range": mkState("sensor.range", 9, { unit_of_measurement: "°F", minimum: 64.4, maximum: 73.4 }), // 9°F delta, 18°C..23°C as °F
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(el._unit(), "°C");
  assert.equal(data.range.hasRange, true);
  assert.ok(Math.abs(data.range.min - 18) < 1e-9, `rangeMin must convert 64.4°F -> 18°C, got ${data.range.min}`);
  assert.ok(Math.abs(data.range.max - 23) < 1e-9, `rangeMax must convert 73.4°F -> 23°C, got ${data.range.max}`);
  env.cleanup(el);
});

test("range_entity state converts as a delta and a negative result disables hasRange", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    // -18°F as a DELTA converts to -10°C (deltaToCanonical has no +32/-32
    // offset); if the code wrongly treated this as an ABSOLUTE value
    // instead, toCanonical() would apply the offset and yield a very
    // different (still negative) number — either way hasRange must be
    // false, but only the delta path yields exactly -10.
    "sensor.range": mkState("sensor.range", -18, { unit_of_measurement: "°F", minimum: 60, maximum: 70 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, false, "a negative range_entity delta (even after correct unit conversion) must never activate the range view");
  env.cleanup(el);
});

test("range_entity with an unresolvable unit is diagnosed as unusable", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 5, { unit_of_measurement: "hPa", minimum: 18, maximum: 23 }),
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, false, "an incompatible range_entity unit must disable the range view, never show an unconverted number");
  assert.equal(data.range.min, null);
  assert.equal(data.range.max, null);
  env.cleanup(el);
});

test("range_entity without unit_of_measurement is unusable and hasRange stays false", () => {
  // A missing unit on range_entity is treated exactly like an unresolvable one (see
  // _resolveAuxiliaryUnitProfile()'s missing-unit branch, and the identical
  // Primary/Räume contract at _buildEntityModel()) — never silently assumed
  // canonical.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 5, { minimum: 18, maximum: 23 }), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg", range_entity: "sensor.range" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.range.hasRange, false, "a missing range_entity unit must disable the range view, never silently assume canonical");
  assert.equal(data.range.min, null);
  assert.equal(data.range.max, null);
  env.cleanup(el);
});

test("trend_entity in a different unit converts as a rate without an absolute offset", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.trend": mkState("sensor.trend", 1.8, { unit_of_measurement: "°F" }), // +1.8°F/h == +1°C/h
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = el._computeViewModel();
  assert.ok(Math.abs(data.trend.value - 1) < 1e-9, `trendValue must convert 1.8°F/h -> 1°C/h, got ${data.trend.value}`);
  assert.equal(data.trend.unit, "°C/h", "trendUnit must match the DISPLAY unit the (now-converted) number is actually expressed in");
  env.cleanup(el);
});

test("trend_entity using a conventional per-hour suffix resolves", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 700, CO2),
    "sensor.trend": mkState("sensor.trend", -15, { unit_of_measurement: "ppm/h" }),
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.trend.value, -15, "'ppm/h' must resolve via the stripped 'ppm' unitProfile (co2's only, an identity conversion), not be rejected as unresolvable");
  assert.equal(data.trend.unit, "ppm/h");
  env.cleanup(el);
});

test("trend_entity with an unresolvable unit is unusable", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.trend": mkState("sensor.trend", 3, { unit_of_measurement: "hPa" }),
  });
  const el = env.createCard({ entity: "sensor.avg", trend_entity: "sensor.trend" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.trend.value, null);
  env.cleanup(el);
});

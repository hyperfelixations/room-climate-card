"use strict";

// View-specific options use the shared optionsSchema/resolveViewOptions()
// contract: scale.footer, scale.markers, range_scale.footer, range.
// show_time, extremes.show_value. Same pattern as
// scale-band-visibility.test.js: schema whitelist/validation, resolved
// data.views.options, rendered HTML presence/absence, and an explicit
// non-interaction check (classification/geometry/footer TEXT unaffected).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

// Direct imports make the owner of each view-option contract explicit.
let numbers;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  numbers = await import("../../../src/core/numbers.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function twoRoomStates(overrides) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    ...overrides,
  });
}

function threeRoomStates(overrides) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 19, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 22.5, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r3": mkState("sensor.r3", 25, { device_class: "temperature", unit_of_measurement: "°C" }),
    ...overrides,
  });
}

function baseConfig(extra) {
  return { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], ...extra };
}

function threeRoomConfig(extra) {
  return {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r1", name: "Room 1" }, { entity: "sensor.r2", name: "Room 2" }, { entity: "sensor.r3", name: "Room 3" }],
    ...extra,
  };
}

function rangeStates() {
  return mkHass({
    ...twoRoomStates().states,
    "sensor.range": mkState("sensor.range", 3, {
      unit_of_measurement: "°C",
      minimum: 18,
      maximum: 24,
      minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
      maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
    }),
  });
}

// ==== optionsSchema whitelist + value validation ====

test("optionsSchema: all 5 new keys pass the whitelist; an invalid value on each is diagnosed and falls back to its default", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  el.setConfig(
    baseConfig({
      range_entity: "sensor.range",
      views: [
        { type: "range", options: { show_time: "nope" } },
        { type: "range_scale", enabled: true, options: { footer: "bogus" } },
        { type: "scale", options: { footer: "bogus", markers: "bogus" } },
        { type: "extremes", options: { show_value: "nope" } },
      ],
    })
  );
  const data = el._computeViewModel();
  assert.equal(data.views.options.range.show_time, true, "invalid show_time falls back to default (true)");
  assert.equal(data.views.options.range_scale.footer, "detailed", "invalid footer falls back to default (detailed)");
  assert.equal(data.views.options.scale.footer, true, "invalid scale footer falls back to default (true)");
  assert.equal(data.views.options.scale.markers, "extremes", "invalid markers falls back to default (extremes)");
  assert.equal(data.views.options.extremes.show_value, true, "invalid show_value falls back to default (true)");
  for (const key of ["show_time", "footer", "markers", "show_value"]) {
    assert.ok(warnings.some((w) => w.includes(key) && w.includes("falling back")), `${key}: invalid value must be diagnosed`);
  }

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("optionsSchema: valid values for all 5 keys are honored, including footer:false", () => {
  const el = env.createCard(
    baseConfig({
      range_entity: "sensor.range",
      views: [
        { type: "range", options: { show_time: false } },
        { type: "range_scale", enabled: true, options: { footer: false } },
        { type: "scale", options: { footer: false, markers: "average" } },
        { type: "extremes", options: { show_value: false } },
      ],
    }),
    rangeStates()
  );
  const data = el._computeViewModel();
  assert.equal(data.views.options.range.show_time, false);
  assert.equal(data.views.options.range_scale.footer, false);
  assert.equal(data.views.options.scale.footer, false);
  assert.equal(data.views.options.scale.markers, "average");
  assert.equal(data.views.options.extremes.show_value, false);
  env.cleanup(el);
});

// ==== scale.markers ====

test("scale.markers: 'extremes' (default) renders coldest/warmest markers alongside avg (regression)", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  assert.equal(el._computeViewModel().views.options.scale.markers, "extremes");
  const html = internals.viewMarkup(el, "scale");
  assert.ok(html.includes("rtc-marker-cold"));
  assert.ok(html.includes("rtc-marker-warm"));
  assert.ok(html.includes("rtc-marker-avg"));
  env.cleanup(el);
});

test("scale.markers: 'average' omits coldest/warmest markers, avg marker stays", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { markers: "average" } }] }), twoRoomStates());
  const html = internals.viewMarkup(el, "scale");
  assert.ok(!html.includes("rtc-marker-cold"));
  assert.ok(!html.includes("rtc-marker-warm"));
  assert.ok(html.includes("rtc-marker-avg"));
  env.cleanup(el);
});

test("scale.markers: 'all' renders one small marker per valid configured room plus one emphasized average marker", () => {
  const el = env.createCard(
    threeRoomConfig({ views: [{ type: "scale", options: { markers: "all" } }] }),
    threeRoomStates()
  );
  const data = el._computeViewModel();
  const html = internals.viewMarkup(el, "scale");
  assert.equal(data.roomMarkers.length, 3);
  assert.equal((html.match(/rtc-marker-room/g) || []).length, 3);
  assert.ok(!html.includes("rtc-marker-cold"), "all must not keep the separate extrema pair");
  assert.ok(!html.includes("rtc-marker-warm"), "all must not keep the separate extrema pair");
  assert.ok(html.includes("rtc-marker-avg rtc-marker-emphasized"));
  for (const room of ["Room 1", "Room 2", "Room 3"]) {
    assert.ok(html.includes(room), `${room} must remain identifiable in its marker tooltip`);
  }
  env.cleanup(el);
});

test("scale.markers: 'all' excludes unavailable rooms and keeps marker positions derived from the shared scale model", () => {
  const el = env.createCard(
    threeRoomConfig({ views: [{ type: "scale", options: { markers: "all" } }] }),
    threeRoomStates({
      "sensor.r2": mkState("sensor.r2", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }),
    })
  );
  const data = el._computeViewModel();
  assert.equal(data.roomMarkers.length, 2);
  for (const marker of data.roomMarkers) {
    assert.equal(marker.position, numbers.percentInRange(marker.value, data.scale.scaleMin, data.scale.scaleMax));
  }
  env.cleanup(el);
});

test("scale.markers: 'all' patches the keyed marker set when room availability changes without rebuilding the view", () => {
  const el = env.createCard(
    threeRoomConfig({ views: [{ type: "scale", options: { markers: "all" } }] }),
    threeRoomStates()
  );
  const scaleView = el.shadowRoot.querySelector(".rtc-scale-view");
  assert.equal(scaleView.querySelectorAll(".rtc-marker-room").length, 3);

  el.hass = threeRoomStates({
    "sensor.r2": mkState("sensor.r2", "unavailable", { device_class: "temperature", unit_of_measurement: "°C" }),
  });

  assert.equal(el.shadowRoot.querySelector(".rtc-scale-view"), scaleView, "the mounted scale view must be patched in place");
  assert.equal(scaleView.querySelectorAll(".rtc-marker-room").length, 2);
  assert.equal(scaleView.querySelector('[data-room-marker-index="1"]'), null, "the unavailable room's keyed marker must be removed");
  env.cleanup(el);
});

test("scale.markers does not affect coolest/warmest room selection, comfort count, or marker colors in data", () => {
  const elAll = env.createCard(baseConfig(), twoRoomStates());
  const elAvg = env.createCard(baseConfig({ views: [{ type: "scale", options: { markers: "average" } }] }), twoRoomStates());
  const a = elAll._computeViewModel();
  const b = elAvg._computeViewModel();
  assert.equal(a.extremes.coolest.name, b.extremes.coolest.name);
  assert.equal(a.extremes.warmest.name, b.extremes.warmest.name);
  assert.equal((a.extremes?.coolestColor ?? null), (b.extremes?.coolestColor ?? null));
  assert.equal((a.extremes?.warmestColor ?? null), (b.extremes?.warmestColor ?? null));
  assert.equal(a.comfort.inComfort, b.comfort.inComfort);
  env.cleanup(elAll);
  env.cleanup(elAvg);
});

// ==== scale.footer / range_scale.footer ====

test("scale.footer:false suppresses the comfort-count footer text, ANDed with the global hide_footer", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { footer: false } }] }), twoRoomStates());
  const html = internals.viewMarkup(el, "scale");
  assert.ok(!html.includes("rtc-scale-footer"));
  env.cleanup(el);
});

test("scale.footer:true (default) keeps the footer, unrelated to markers", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  const html = internals.viewMarkup(el, "scale");
  assert.ok(html.includes("rtc-scale-footer"));
  env.cleanup(el);
});

test("range_scale.footer: detailed (default) includes min/max timestamps, compact omits them, false omits the footer entirely", () => {
  const elDetailed = env.createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] }), rangeStates());
  const elCompact = env.createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true, options: { footer: "compact" } }] }), rangeStates());
  const elFalse = env.createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true, options: { footer: false } }] }), rangeStates());

  const detailedHtml = internals.viewMarkup(elDetailed, "range_scale");
  const compactHtml = internals.viewMarkup(elCompact, "range_scale");
  const falseHtml = internals.viewMarkup(elFalse, "range_scale");

  assert.ok(detailedHtml.includes("rtc-scale-footer"));
  assert.ok(compactHtml.includes("rtc-scale-footer"));
  assert.ok(!falseHtml.includes("rtc-scale-footer"));

  const detailedText = internals.footerText(elDetailed, "range_scale");
  const compactText = internals.footerText(elCompact, "range_scale");
  assert.notEqual(detailedText, compactText, "compact must be a genuinely different (shorter) string than detailed");
  assert.ok(!compactText.includes("(") , "compact must drop the timestamp parentheticals entirely");

  env.cleanup(elDetailed);
  env.cleanup(elCompact);
  env.cleanup(elFalse);
});

test("range_scale.footer does not affect the comfort/optimal band geometry or label positions", () => {
  const a = env.createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true }] }), rangeStates())._computeViewModel();
  const b = env
    .createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range_scale", enabled: true, options: { footer: false } }] }), rangeStates())
    ._computeViewModel();
  assert.equal(a.rangeScale.comfortMin, b.rangeScale.comfortMin);
  assert.equal(a.rangeScale.optimalMin, b.rangeScale.optimalMin);
  assert.equal((a.rangeScale?.markerPositions.current ?? 0), (b.rangeScale?.markerPositions.current ?? 0));
});

// ==== range.show_time ====

test("range.show_time:true (default) shows the min/max timestamp on the range cards (regression)", () => {
  const el = env.createCard(baseConfig({ range_entity: "sensor.range" }), rangeStates());
  const data = el._computeViewModel();
  const html = internals.metricCardsMarkup(el, "range", data);
  assert.ok(typeof data.range.minTime === "string" && data.range.minTime.length > 0, "sanity: fixture must actually produce a timestamp");
  assert.ok(html.includes(data.range.minTime), "min timestamp text must appear in the rendered card");
  env.cleanup(el);
});

test("range.show_time:false omits the timestamp text from both range cards without touching the numeric value", () => {
  const el = env.createCard(baseConfig({ range_entity: "sensor.range", views: [{ type: "range", options: { show_time: false } }] }), rangeStates());
  const data = el._computeViewModel();
  const html = internals.metricCardsMarkup(el, "range", data);
  assert.ok(!html.includes('class="rtc-extreme-name">' + data.range.minTime), "min timestamp text must not appear");
  assert.ok(html.includes(String(Math.trunc(data.range.min))) || html.includes(el._fmt(data.range.min)), "the numeric value must still render");
  env.cleanup(el);
});

// ==== extremes.show_value ====

test("extremes.show_value:true (default) shows the numeric value on both extrema cards (regression)", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  const data = el._computeViewModel();
  const html = internals.metricCardsMarkup(el, "extremes", data);
  assert.ok(html.includes(el._fmt(data.extremes.coolest.value)));
  env.cleanup(el);
});

test("extremes.show_value:false hides the numeric value but keeps the room name and label", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "extremes", options: { show_value: false } }] }), twoRoomStates());
  const data = el._computeViewModel();
  const html = internals.metricCardsMarkup(el, "extremes", data);
  assert.ok(!html.includes(`>${el._fmt(data.extremes.coolest.value)}<`), "the numeric value text must not appear");
  assert.ok(html.includes(data.extremes.coolest.name), "the room name must still appear");
  env.cleanup(el);
});

test("extremes.show_value does not affect which room is coldest/warmest or their colors", () => {
  const a = env.createCard(baseConfig(), twoRoomStates())._computeViewModel();
  const b = env.createCard(baseConfig({ views: [{ type: "extremes", options: { show_value: false } }] }), twoRoomStates())._computeViewModel();
  assert.equal(a.extremes.coolest.name, b.extremes.coolest.name);
  assert.equal(a.extremes.warmest.name, b.extremes.warmest.name);
});

// ==== setConfig() options-only change forces _renderAll() (regression of the already-generic structuralConfigSignature mechanism) ====

test("setConfig() changing only scale.markers (same active views) forces a full rebuild, actually removing the extrema markers from the DOM", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { markers: "extremes" } }] }), twoRoomStates());
  assert.ok(el.shadowRoot.querySelector(".rtc-marker-cold"), "precondition: cold marker must be rendered");

  el.setConfig(baseConfig({ views: [{ type: "scale", options: { markers: "average" } }] }));

  assert.equal(el.shadowRoot.querySelector(".rtc-marker-cold"), null, "cold marker must be gone after the options-only config change");
  env.cleanup(el);
});

"use strict";

// The generic view-options mechanism allows the
// comfort-band/optimal-band background coloring inside the scale bar can
// be toggled independently, per view (scale, range_scale), via
// views:[i].options.show_comfort_band / show_optimal_band. Strictly
// visual: these options are read ONLY where the two band <div>s and their
// descriptive labels are assembled, never inside any classification/
// geometry/footer computation — several tests below verify that
// non-interaction directly.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function twoRoomStates(overrides) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    ...overrides,
  });
}

function baseConfig(extra) {
  return { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], ...extra };
}

// ==== optionsSchema whitelist + validation (regression + new) ====

test("optionsSchema: show_comfort_band/show_optimal_band pass the whitelist for scale and range_scale, unrelated keys are still stripped and diagnosed", () => {
  // _warnAboutViewConfigOnce() deduplicates identical repeated configs, so
  // the warn spy must be attached before the config
  // carrying "bogus" is first applied, or the (correct) dedup would
  // silently suppress the very warning this test is checking for.
  const el = env.createCard(baseConfig(), twoRoomStates());
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));
  el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: false, bogus: true } }] }));

  assert.deepEqual(normalize(el._config.views[0].options), { show_comfort_band: false });
  assert.ok(warnings.some((w) => w.includes("unknown") && w.includes("bogus")), "unrelated unknown key must still be diagnosed");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("optionsSchema: an invalid (non-boolean) show_comfort_band value is diagnosed and falls back to the schema default", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  for (const invalid of ["yes", 1, null]) {
    warnings.length = 0;
    el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: invalid } }] }));
    assert.ok(
      warnings.some((w) => w.includes("show_comfort_band") && w.includes("falling back")),
      `invalid value ${JSON.stringify(invalid)} must be diagnosed`
    );
    assert.equal(el._computeViewModel().views.options.scale.show_comfort_band, true, `invalid value ${JSON.stringify(invalid)} must fall back to the default (true)`);
  }

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

// ==== data.views.options resolution ====

// The assertions below include footer and marker defaults (footer:true/
// markers:"extremes" for scale, footer:"detailed" for range_scale) alongside the
// band flags this file itself is about, since data.views.options.<view> is a
// single fully-resolved object returned by resolveViewOptions().

test("data.views.options: defaults to {show_comfort_band:true, show_optimal_band:true} for both scale and range_scale with no views: configured", () => {
  const el = env.createCard(baseConfig(), twoRoomStates());
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.options.scale), { show_comfort_band: true, show_optimal_band: true, footer: true, markers: "extremes" });
  assert.deepEqual(normalize(data.views.options.range_scale), { show_comfort_band: true, show_optimal_band: true, footer: "detailed" });
  env.cleanup(el);
});

const COMBINATIONS = [
  { show_comfort_band: true, show_optimal_band: true },
  { show_comfort_band: true, show_optimal_band: false },
  { show_comfort_band: false, show_optimal_band: true },
  { show_comfort_band: false, show_optimal_band: false },
];

for (const combo of COMBINATIONS) {
  test(`data.views.options: scale resolves explicit options ${JSON.stringify(combo)}`, () => {
    const el = env.createCard(baseConfig({ views: [{ type: "scale", options: combo }] }), twoRoomStates());
    assert.deepEqual(normalize(el._computeViewModel().views.options.scale), { ...combo, footer: true, markers: "extremes" });
    env.cleanup(el);
  });
}

test("data.views.options: scale and range_scale resolve independently in the same card", () => {
  const el = env.createCard(
    baseConfig({
      range_entity: "sensor.range",
      views: [
        { type: "scale", options: { show_comfort_band: false, show_optimal_band: true } },
        { type: "range_scale", enabled: true, options: { show_comfort_band: true, show_optimal_band: false } },
      ],
    }),
    mkHass({
      ...twoRoomStates().states,
      "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    })
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.options.scale), { show_comfort_band: false, show_optimal_band: true, footer: true, markers: "extremes" });
  assert.deepEqual(normalize(data.views.options.range_scale), { show_comfort_band: true, show_optimal_band: false, footer: "detailed" });
  env.cleanup(el);
});

// ==== Strictly visual: no interaction with classification/geometry/footer ====

test("show_comfort_band/show_optimal_band do not affect comfort/optimal geometry, in-comfort count, footer text, or marker/room colors", () => {
  const elBothVisible = env.createCard(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: true, show_optimal_band: true } }] }), twoRoomStates());
  const elBothHidden = env.createCard(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: false, show_optimal_band: false } }] }), twoRoomStates());

  const a = elBothVisible._computeViewModel();
  const b = elBothHidden._computeViewModel();

  assert.equal(a.comfort.min, b.comfort.min);
  assert.equal(a.comfort.max, b.comfort.max);
  assert.equal(a.scale.optimalMin, b.scale.optimalMin);
  assert.equal(a.scale.optimalMax, b.scale.optimalMax);
  assert.equal(a.comfort.inComfort, b.comfort.inComfort);
  assert.equal(a.average.color, b.average.color);
  assert.equal((a.extremes?.coolestColor ?? null), (b.extremes?.coolestColor ?? null));
  assert.equal((a.extremes?.warmestColor ?? null), (b.extremes?.warmestColor ?? null));
  assert.equal(internals.footerText(elBothVisible, "scale"), internals.footerText(elBothHidden, "scale"));

  env.cleanup(elBothVisible);
  env.cleanup(elBothHidden);
});

// ==== Rendered HTML: each band and its descriptive label share visibility ====

for (const combo of COMBINATIONS) {
  test(`_renderScaleView(): bands and their labels match ${JSON.stringify(combo)}`, () => {
    const el = env.createCard(baseConfig({ views: [{ type: "scale", options: combo }] }), twoRoomStates());
    const html = internals.viewMarkup(el, "scale");
    assert.equal(html.includes('class="rtc-comfort-band"'), combo.show_comfort_band);
    assert.equal(html.includes('class="rtc-scale-comfort-label"'), combo.show_comfort_band);
    assert.equal(html.includes('class="rtc-optimal-band"'), combo.show_optimal_band);
    assert.equal(html.includes('class="rtc-scale-label-center"'), combo.show_optimal_band);
    assert.ok(html.includes('class="rtc-scale-label-min"'), "scale minimum must remain visible independently of either band");
    assert.ok(html.includes('class="rtc-scale-label-max rtc-scale-max"'), "scale maximum must remain visible independently of either band");
    env.cleanup(el);
  });
}

for (const combo of COMBINATIONS) {
  test(`_renderRangeScaleView(): bands and the optimal label match ${JSON.stringify(combo)}`, () => {
    const el = env.createCard(
      baseConfig({
        range_entity: "sensor.range",
        views: [{ type: "range_scale", enabled: true, options: combo }],
      }),
      mkHass({
        ...twoRoomStates().states,
        "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
      })
    );
    const html = internals.viewMarkup(el, "range_scale");
    assert.equal(html.includes('class="rtc-comfort-band"'), combo.show_comfort_band);
    assert.equal(html.includes('class="rtc-optimal-band"'), combo.show_optimal_band);
    assert.equal(html.includes('class="rtc-scale-label-center"'), combo.show_optimal_band);
    assert.ok(!html.includes('class="rtc-scale-comfort-label"'), "range_scale has no comfort label independent of the band option");
    assert.ok(html.includes('class="rtc-scale-label-min"'), "range-scale minimum must remain visible independently of either band");
    assert.ok(html.includes('class="rtc-scale-label-max rtc-scale-max"'), "range-scale maximum must remain visible independently of either band");
    env.cleanup(el);
  });
}

// ==== structuralConfigSignature: an options-only setConfig() change forces a full rebuild ====

test("setConfig() changing only show_comfort_band (same active views) forces _renderAll(), actually removing the band from the DOM", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: true } }] }), twoRoomStates());
  assert.ok(el.shadowRoot.querySelector(".rtc-comfort-band"), "precondition: comfort band must be rendered");
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), "precondition: comfort label must be rendered");

  el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: false } }] }));

  assert.equal(el.shadowRoot.querySelector(".rtc-comfort-band"), null, "comfort band must be gone from the DOM after the options-only config change");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), null, "comfort label must be gone with its band");
  env.cleanup(el);
});

test("setConfig() re-enabling show_comfort_band (same active views) forces _renderAll(), actually re-adding the band to the DOM", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: false } }] }), twoRoomStates());
  assert.equal(el.shadowRoot.querySelector(".rtc-comfort-band"), null, "precondition: comfort band must be absent");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), null, "precondition: comfort label must be absent");

  el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_comfort_band: true } }] }));

  assert.ok(el.shadowRoot.querySelector(".rtc-comfort-band"), "comfort band must now be rendered");
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), "comfort label must now be rendered with its band");
  env.cleanup(el);
});

test("setConfig() changing only show_optimal_band removes and re-adds both the band and its label", () => {
  const el = env.createCard(baseConfig({ views: [{ type: "scale", options: { show_optimal_band: true } }] }), twoRoomStates());
  assert.ok(el.shadowRoot.querySelector(".rtc-optimal-band"), "precondition: optimal band must be rendered");
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-label-center"), "precondition: optimal label must be rendered");

  el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_optimal_band: false } }] }));
  assert.equal(el.shadowRoot.querySelector(".rtc-optimal-band"), null, "optimal band must be gone");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-label-center"), null, "optimal label must be gone with its band");

  el.setConfig(baseConfig({ views: [{ type: "scale", options: { show_optimal_band: true } }] }));
  assert.ok(el.shadowRoot.querySelector(".rtc-optimal-band"), "optimal band must be rendered again");
  assert.ok(el.shadowRoot.querySelector(".rtc-scale-label-center"), "optimal label must be rendered again with its band");
  env.cleanup(el);
});

test("a subsequent value-only hass update with both bands hidden neither throws nor resurrects them (_updateScaleBarCommon()'s existing guards no-op correctly)", () => {
  const el = env.createCard(
    baseConfig({ views: [{ type: "scale", options: { show_comfort_band: false, show_optimal_band: false } }] }),
    twoRoomStates()
  );
  assert.equal(el.shadowRoot.querySelector(".rtc-comfort-band"), null, "precondition: comfort band absent");
  assert.equal(el.shadowRoot.querySelector(".rtc-optimal-band"), null, "precondition: optimal band absent");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), null, "precondition: comfort label absent");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-label-center"), null, "precondition: optimal label absent");

  assert.doesNotThrow(() => {
    el.hass = twoRoomStates({ "sensor.r1": mkState("sensor.r1", 25, { device_class: "temperature", unit_of_measurement: "°C" }) });
  });

  assert.equal(el.shadowRoot.querySelector(".rtc-comfort-band"), null, "comfort band must still be absent after a pure value update");
  assert.equal(el.shadowRoot.querySelector(".rtc-optimal-band"), null, "optimal band must still be absent after a pure value update");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-comfort-label"), null, "comfort label must still be absent after a pure value update");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-label-center"), null, "optimal label must still be absent after a pure value update");
  env.cleanup(el);
});

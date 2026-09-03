"use strict";

// resolveActiveViews() layers config.views (string/object requests, enabled:true|false|
// "auto") on top of VIEW_REGISTRY's condition()/defaultEnabled() availability, and is
// authoritative for view requests and availability. A module-scope function, not exported,
// so it's exercised through the view model's views.keys and the console.warn diagnostics
// setConfig() emits once per config change via _warnAboutViewConfigOnce().

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function fourViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
}

test("no views: configured -> registry order unchanged, range_scale still never auto-shown (1:1 today's default behavior)", () => {
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["range", "scale", "extremes"], "range_scale's own defaultEnabled() is false, so 'auto' leaves it off exactly like the old range_scale_view default");
  env.cleanup(el);
});

test("views: [string, string] reorders the views that are present, in the requested order (string shorthand = enabled:true)", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["extremes", "scale"] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes", "scale"]);
  env.cleanup(el);
});

test("views: is fully authoritative — a type it doesn't mention never appears, even though it's available (no more 'append what's missing')", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "extremes", enabled: true }] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes"], "scale must NOT be silently appended just because views: omitted it — a deliberate behavior change from the old view_order");
  env.cleanup(el);
});

test("views: object form with enabled:false hides a view even though its condition() would otherwise show it", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "scale", enabled: true }, { type: "extremes", enabled: false }],
    },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale"]);
  env.cleanup(el);
});

test("views: 'scale' can be omitted entirely — the former 'mandatory' protection is gone", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "extremes", enabled: true }] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.ok(!data.views.keys.includes("scale"), "scale must be genuinely absent, not force-reinstated");
  env.cleanup(el);
});

test("views: range_scale with enabled:true shows when available", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      views: [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }, { type: "extremes" }],
    },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["range", "range_scale", "scale", "extremes"], "the exact audit counterexample configuration, expressed in the new schema");
  env.cleanup(el);
});

test("views: object form without enabled is an explicit request, exactly like the string shorthand", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      views: [{ type: "range" }, { type: "range_scale" }, { type: "scale" }],
    },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views.map(({ type, enabled }) => ({ type, enabled }))), [
    { type: "range", enabled: true },
    { type: "range_scale", enabled: true },
    { type: "scale", enabled: true },
  ]);
  assert.deepEqual(normalize(el._computeViewModel().views.keys), ["range", "range_scale", "scale"]);
  env.cleanup(el);
});

test("views: range_scale with explicitly enabled:'auto' stays off even when available — its own defaultEnabled() is false", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      views: [{ type: "range" }, { type: "range_scale", enabled: "auto" }, { type: "scale" }],
    },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["range", "scale"], "only an explicitly written 'auto' delegates to range_scale's off-by-default policy");
  env.cleanup(el);
});

test("views: range_scale requested but NOT available (no valid range_entity) does not show, even with enabled:true", () => {
  const el = env.createCard(
    { entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }, { type: "scale" }] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale"], "requested && available must both hold; range_scale has no range_entity here");
  env.cleanup(el);
});

test("views: an unknown type is diagnosed and simply skipped, the rest of the list still resolves", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["bogus", "extremes", "scale"] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes", "scale"]);
  env.cleanup(el);
});

test("views: a duplicate type is diagnosed — only the first occurrence is honored", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["extremes", "extremes", "scale"] },
    fourViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes", "scale"]);
  env.cleanup(el);
});

test("views: an explicit empty list resolves to zero active views (authoritative even when empty, not treated as 'not configured')", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [] }, fourViewHass());
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), []);
  env.cleanup(el);
});

test("setConfig() warns exactly once for a bad views: config, and does not repeat the same warning on an unrelated hass update", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["bogus", "extremes", "extremes"] },
    fourViewHass()
  );
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  // A plain hass update must not re-emit diagnostics: only _warnAboutViewConfigOnce() in setConfig() warns.
  el.hass = fourViewHass();
  assert.equal(warnings.length, 0, "a hass update alone must not emit view-config warnings");

  // Re-applying the SAME (still invalid) config must not re-warn either (dedup).
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["bogus", "extremes", "extremes"] });
  assert.equal(warnings.length, 0, "identical repeated config must not re-emit the same warnings");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("the warning dedup key resets on a valid intermediate config", () => {
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, fourViewHass());
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  const invalidConfig = { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["bogus", "extremes"] };
  el.setConfig(invalidConfig);
  assert.equal(warnings.length, 1, "the first invalid config must warn");

  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["extremes", "scale"] });
  assert.equal(warnings.length, 1, "a valid intermediate config must not itself warn");

  el.setConfig({ ...invalidConfig });
  assert.equal(warnings.length, 2, "the SAME invalid config re-applied after a valid one must warn again — the dedup key must reset on the valid step, not just skip updating while empty");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("setConfig() warns when it's actually called with a newly-invalid views: config", () => {
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, fourViewHass());
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["not_a_real_view", "scale", "scale"] });
  assert.ok(warnings.some((w) => w.includes("views:") && w.includes("unknown") && w.includes("not_a_real_view")), "unknown views: type must be warned about");
  assert.ok(warnings.some((w) => w.includes("views:") && w.includes("duplicate") && w.includes("scale")), "duplicate views: type must be warned about");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("start_view: a valid start_view is stored on config and used by _renderAll()'s active-view fallback (see lifecycle-and-rendering.test.js)", () => {
  const el = env.createCard({ entity: "sensor.avg", start_view: "range", range_entity: "sensor.range" }, fourViewHass());
  assert.equal(el._config.start_view, "range");
  env.cleanup(el);
});

// ==== View configuration validation: a non-array views:, invalid list entries and invalid
// enabled: values must be diagnosed (not silently defaulted), and options filtered through
// a registry whitelist. See _normalizeViewsConfig()/_normalizeViewRequest()/_normalizeViewOptions(). ====

test("a non-array views value is diagnosed and falls back to registry defaults", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: "not-an-array" },
    fourViewHass()
  );
  assert.equal(el._config.views, null, "an invalid views: value must normalize to the same null sentinel as 'not configured'");
  assert.ok(
    el._config._configDiagnostics.some((d) => d.includes("views:") && d.includes("array")),
    "the non-array value must be diagnosed"
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale", "extremes"], "falls back to the registry-order default resolution, exactly like views: omitted");
  env.cleanup(el);
});

test("unparseable views entries are diagnosed and skipped while valid entries resolve", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [42, null, {}, { type: 123 }, "extremes"] },
    fourViewHass()
  );
  assert.equal(el._config.views.length, 1, "only the one genuinely parseable entry ('extremes') survives normalization");
  assert.equal(el._config.views[0].type, "extremes");
  assert.equal(el._config._configDiagnostics.length, 4, "each of the 4 unparseable entries gets its own diagnostic");
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes"]);
  env.cleanup(el);
});

test("an invalid enabled value is diagnosed and falls back to auto", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", enabled: "yes" }] },
    fourViewHass()
  );
  assert.equal(el._config.views.length, 1, "the entry itself must survive despite the bad enabled: value");
  assert.equal(el._config.views[0].enabled, "auto", "an unrecognized enabled: value falls back to 'auto', not true/false");
  assert.ok(
    el._config._configDiagnostics.some((d) => d.includes("enabled") && d.includes("scale")),
    "the invalid enabled: value must be diagnosed"
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale"], "'auto' resolves via scale's own defaultEnabled(), which is unconditionally true");
  env.cleanup(el);
});

test("options are filtered through each view's optionsSchema", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { bogus: true, another: 1 } }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "no view currently declares any optionsSchema field, so every raw option key must be stripped");
  env.cleanup(el);
});

// ==== _normalizeViewOptions() diagnoses unknown keys and non-object values through the
// _viewsDiagnostics pipeline, non-destructively (the entry and its filtered options are kept). ====

test("an unknown options key is diagnosed once and stripped", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { bogus: true } }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "the unknown key must still be stripped, exactly as before");
  assert.ok(
    el._config._configDiagnostics.some((d) => d.includes("options") && d.includes("bogus") && d.includes("scale")),
    "the unknown options key must now be diagnosed"
  );
  env.cleanup(el);
});

test("a non-object options value is diagnosed and normalizes to an empty object", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: "not-an-object" }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "an invalid options: value must still normalize to {}, not drop the whole entry");
  assert.ok(
    el._config._configDiagnostics.some((d) => d.includes("options") && d.includes("scale")),
    "the invalid options: value must be diagnosed"
  );
  env.cleanup(el);
});

test("an omitted options field is not diagnosed", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale" }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {});
  assert.equal(el._config._configDiagnostics.length, 0, "omitting options: entirely must not itself produce a diagnostic");
  env.cleanup(el);
});

// ==== Generic 0/1/N-view rendering. The view descriptor (VIEW_REGISTRY via
// resolveActiveViews()) is the sole render-dispatch source — no hardcoded Scale-solo path —
// and each view works standalone. Covers: per-view solo-render DOM, timer-freedom at 0/1
// views, the collapse-vs-hint null-view policy, and start_view on the first render. ====

function soloViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, {
      unit_of_measurement: "°C",
      minimum: 20,
      maximum: 23,
      minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
      maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
    }),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
}

const SOLO_CASES = {
  range: { extraConfig: { range_entity: "sensor.range" }, viewClass: "rtc-range-view" },
  range_scale: { extraConfig: { range_entity: "sensor.range" }, viewClass: "rtc-range-scale-view" },
  scale: { extraConfig: {}, viewClass: "rtc-scale-view" },
  extremes: { extraConfig: { rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, viewClass: "rtc-extremes-view" },
};

for (const [type, { extraConfig, viewClass }] of Object.entries(SOLO_CASES)) {
  test(`solo views:[${type}] renders exactly the ${viewClass} markup`, () => {
    const el = env.createCard(
      { entity: "sensor.avg", ...extraConfig, views: [{ type, enabled: true }] },
      soloViewHass()
    );
    const data = el._computeViewModel();
    assert.deepEqual(normalize(data.views.keys), [type]);
    const solo = el.shadowRoot.querySelector(".rtc-rotator-solo");
    assert.ok(solo, "a single active view must use the solo wrapper, not the carousel");
    assert.ok(solo.querySelector(`.${viewClass}`), `the solo wrapper must contain .${viewClass}`);
    for (const other of Object.values(SOLO_CASES)) {
      if (other.viewClass === viewClass) continue;
      assert.equal(solo.querySelector(`.${other.viewClass}`), null, `must not also render .${other.viewClass}`);
    }
    assert.equal(el.shadowRoot.querySelector(".rtc-rotator"), null, "no carousel wrapper for a single view");
    env.cleanup(el);
  });
}

test("zero active views has neither a carousel track nor auto-slide timers", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-track"), null);
  assert.equal(el._carousel.hasAutoSlide(), false);
  assert.equal(el._carousel.resumeTimerHandle, null);
  assert.equal(el._carousel.accessibilityTimerHandle, null);
  env.cleanup(el);
});

test("one active view has neither a carousel track nor auto-slide timers", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "scale", enabled: true }] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-track"), null);
  assert.equal(el._carousel.hasAutoSlide(), false);
  assert.equal(el._carousel.resumeTimerHandle, null);
  assert.equal(el._carousel.accessibilityTimerHandle, null);
  env.cleanup(el);
});

test("an empty views config collapses the view area without hint markup", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  const data = el._computeViewModel();
  assert.equal(data.views.collapsed, true);
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null, "a deliberately empty config must not show the 'no view' hint");
  assert.equal(el.shadowRoot.querySelector(".rtc-rotator-solo"), null);
  // The header/average/room chips stay visible regardless — only the view area itself collapses.
  assert.ok(el.shadowRoot.querySelector(".rtc-card"));
  env.cleanup(el);
});

test("explicitly disabling every view collapses the view area", () => {
  const el = env.createCard(
    {
      entity: "sensor.avg",
      views: [{ type: "scale", enabled: false }, { type: "extremes", enabled: false }],
    },
    soloViewHass()
  );
  const data = el._computeViewModel();
  assert.equal(data.views.collapsed, true);
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null);
  env.cleanup(el);
});

test("a requested unavailable view shows a localized hint instead of collapsing", () => {
  // range_scale requested with enabled:true, but no range_entity configured at all -> unavailable.
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }, soloViewHass());
  const data = el._computeViewModel();
  assert.equal(data.views.collapsed, false);
  const hint = el.shadowRoot.querySelector(".rtc-no-views");
  assert.ok(hint, "a requested-but-unavailable view must show the localized hint");
  assert.match(hint.textContent, /No view available/);
  env.cleanup(el);
});

test("setConfig from collapsed views to an unavailable request shows the hint", () => {
  // Both states resolve views.keys to []; the transition must still trigger _renderAll(), not stay stuck on the collapsed state.
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null);

  el.setConfig({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }); // no range_entity -> requested but unavailable
  const hint = el.shadowRoot.querySelector(".rtc-no-views");
  assert.ok(hint, "collapse -> requested-but-unavailable must actually render the .rtc-no-views hint, not stay stuck on the collapsed state");
  env.cleanup(el);
});

test("setConfig from an unavailable request to collapsed views removes the hint", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }, soloViewHass());
  assert.ok(el.shadowRoot.querySelector(".rtc-no-views"));

  el.setConfig({ entity: "sensor.avg", views: [] });
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null, "requested-but-unavailable -> collapse must actually remove the .rtc-no-views hint, not leave it stuck in the DOM");
  env.cleanup(el);
});

test("start_view is honored on the first render", () => {
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], start_view: "extremes" },
    soloViewHass()
  );
  assert.equal(el._views[el._activeView], "extremes", "the initial _activeView must already point at start_view on construction, not index 0");
  env.cleanup(el);
});

test("views: [extremes] renders the Extremes view without an implicit Scale", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "extremes", enabled: true }] },
    soloViewHass()
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes"]);
  assert.ok(el.shadowRoot.querySelector(".rtc-extremes-view"), "the Extremes view must actually be in the DOM");
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-view"), null, "Scale must never render implicitly when views: omits it");
  env.cleanup(el);
});

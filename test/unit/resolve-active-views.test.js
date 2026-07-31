"use strict";

// AP-04 (views:-Schema, audit sections 11, 12, 14.3-14.5): resolveActiveViews()
// layers config.views (string/object requests, enabled:true|false|"auto")
// on top of VIEW_REGISTRY's condition()/defaultEnabled()-based availability,
// replacing the legacy range_scale_view/view_order/disabled_views/
// default_view/mandatory fields entirely. It's a plain module-scope function
// (not a method — see room-climate-card.js), not exposed on window by design
// (the card stays a dependency-free browser IIFE with no exports for HACS),
// so it's exercised the same way a real user would ever observe it: through
// the view model's views.keys (the resolved view list) and through the
// console.warn diagnostics setConfig() emits once per config change via
// _warnAboutViewConfigOnce().

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function fourViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 20, maximum: 23 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
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

test("views: range_scale with enabled:true actually shows when available, replacing the legacy range_scale_view:true flag", () => {
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

  // A plain hass update (no setConfig()) must not re-emit the diagnostics —
  // _computeViewModel() itself never warns, only _warnAboutViewConfigOnce()
  // inside setConfig() does (see room-climate-card.js).
  el.hass = fourViewHass();
  assert.equal(warnings.length, 0, "a hass update alone must not emit view-config warnings");

  // Re-applying the SAME (still invalid) config must not re-warn either (dedup).
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: ["bogus", "extremes", "extremes"] });
  assert.equal(warnings.length, 0, "identical repeated config must not re-emit the same warnings");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("review fix (P1): the warning dedup key resets on a valid intermediate config, so an identical invalid config re-warns the third time (invalid -> valid -> same invalid)", () => {
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

// ==== Review fix (P1, post-2.21.1): AP-04 validation completeness — a
// non-array views:, invalid list entries, and invalid enabled: values must
// be diagnosed (not silently defaulted with no trace), and options must be
// filtered through a registry whitelist rather than passed through
// unchecked (audit 14.4). See room-climate-card.js's _normalizeViewsConfig()/
// _normalizeViewRequest()/_normalizeViewOptions(). ====

test("review fix (P1): a non-array views: value is diagnosed and the card falls back to the default (one-auto-entry-per-registry-key) resolution", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: "not-an-array" },
    fourViewHass()
  );
  assert.equal(el._config.views, null, "an invalid views: value must normalize to the same null sentinel as 'not configured'");
  assert.ok(
    el._config._viewsDiagnostics.some((d) => d.includes("views:") && d.includes("array")),
    "the non-array value must be diagnosed"
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale", "extremes"], "falls back to the registry-order default resolution, exactly like views: omitted");
  env.cleanup(el);
});

test("review fix (P1): every unparseable views: list entry (wrong type, empty object, non-string type) is individually diagnosed and skipped, valid entries still resolve", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [42, null, {}, { type: 123 }, "extremes"] },
    fourViewHass()
  );
  assert.equal(el._config.views.length, 1, "only the one genuinely parseable entry ('extremes') survives normalization");
  assert.equal(el._config.views[0].type, "extremes");
  assert.equal(el._config._viewsDiagnostics.length, 4, "each of the 4 unparseable entries gets its own diagnostic");
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["extremes"]);
  env.cleanup(el);
});

test("review fix (P1): an invalid enabled: value is diagnosed but non-destructively falls back to 'auto' rather than dropping the whole entry", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", enabled: "yes" }] },
    fourViewHass()
  );
  assert.equal(el._config.views.length, 1, "the entry itself must survive despite the bad enabled: value");
  assert.equal(el._config.views[0].enabled, "auto", "an unrecognized enabled: value falls back to 'auto', not true/false");
  assert.ok(
    el._config._viewsDiagnostics.some((d) => d.includes("enabled") && d.includes("scale")),
    "the invalid enabled: value must be diagnosed"
  );
  const data = el._computeViewModel();
  assert.deepEqual(normalize(data.views.keys), ["scale"], "'auto' resolves via scale's own defaultEnabled(), which is unconditionally true");
  env.cleanup(el);
});

test("review fix (P1): options: is filtered through the view's registry optionsSchema whitelist — currently empty for every view, so any options object normalizes to {}", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { bogus: true, another: 1 } }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "no view currently declares any optionsSchema field, so every raw option key must be stripped");
  env.cleanup(el);
});

// ==== P1 fix (post-2.22.1, audit 14.4 follow-up): _normalizeViewOptions()
// used to strip unknown options keys AND normalize any non-object options
// value silently, with no diagnostic — unlike every other malformed views:
// field in this file. Both are now diagnosed through the same
// _viewsDiagnostics pipeline, non-destructively (the entry itself, and its
// filtered options, are kept exactly as before). ====

test("P1 fix: an options: value with an unknown key is diagnosed once, and the unknown key is still stripped", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: { bogus: true } }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "the unknown key must still be stripped, exactly as before");
  assert.ok(
    el._config._viewsDiagnostics.some((d) => d.includes("options") && d.includes("bogus") && d.includes("scale")),
    "the unknown options key must now be diagnosed"
  );
  env.cleanup(el);
});

test("P1 fix: a non-object options: value is diagnosed, and still non-destructively normalizes to {}", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale", options: "not-an-object" }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {}, "an invalid options: value must still normalize to {}, not drop the whole entry");
  assert.ok(
    el._config._viewsDiagnostics.some((d) => d.includes("options") && d.includes("scale")),
    "the invalid options: value must be diagnosed"
  );
  env.cleanup(el);
});

test("P1 fix: an omitted options: field is NOT diagnosed — 'not provided' is the normal case, consistent with views: itself being omitted", () => {
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], views: [{ type: "scale" }] },
    fourViewHass()
  );
  assert.deepEqual(normalize(el._config.views[0].options), {});
  assert.equal(el._config._viewsDiagnostics.length, 0, "omitting options: entirely must not itself produce a diagnostic");
  env.cleanup(el);
});

// ==== AP-05 (audit sections 13, 14.1): generic 0/1/N-view rendering. The
// view descriptor (VIEW_REGISTRY via resolveActiveViews()) is the sole
// render-dispatch source — no hardcoded Scale-solo path — and each of the
// four views must work standalone. Covers: solo-render DOM assertions per
// view (previously only "extremes" had any views:-solo test, and it only
// asserted data.views.keys, not the DOM), timer-freedom at 0/1 views, the
// collapse-vs-hint null-view policy, and start_view on the very first
// render. See the view model's views.collapsed (presentation/view-model/view-state.js)
// and _renderContent(). ====

function soloViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, {
      unit_of_measurement: "°C",
      minimum: 20,
      maximum: 23,
      minimum_zeitpunkt: "2026-07-21T05:00:00+00:00",
      maximum_zeitpunkt: "2026-07-21T15:00:00+00:00",
    }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
}

const SOLO_CASES = {
  range: { extraConfig: { range_entity: "sensor.range" }, viewClass: "rtc-range-view" },
  range_scale: { extraConfig: { range_entity: "sensor.range" }, viewClass: "rtc-range-scale-view" },
  scale: { extraConfig: {}, viewClass: "rtc-scale-view" },
  extremes: { extraConfig: { rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, viewClass: "rtc-extremes-view" },
};

for (const [type, { extraConfig, viewClass }] of Object.entries(SOLO_CASES)) {
  test(`AP-05 solo-render: views:[${type}] renders exactly the ${viewClass} markup, never implicit Scale`, () => {
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

test("AP-05: 0 active views (deliberately empty config) has neither a .rtc-track carousel nor auto-slide timers", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-track"), null);
  assert.equal(el._carousel.hasAutoSlide(), false);
  assert.equal(el._carousel.resumeTimerHandle, null);
  assert.equal(el._carousel.accessibilityTimerHandle, null);
  env.cleanup(el);
});

test("AP-05: 1 active view has neither a .rtc-track carousel nor auto-slide timers", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "scale", enabled: true }] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-track"), null);
  assert.equal(el._carousel.hasAutoSlide(), false);
  assert.equal(el._carousel.resumeTimerHandle, null);
  assert.equal(el._carousel.accessibilityTimerHandle, null);
  env.cleanup(el);
});

test("AP-05 null-view policy: a deliberately empty views: config collapses the view area entirely (no .rtc-no-views markup)", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  const data = el._computeViewModel();
  assert.equal(data.views.collapsed, true);
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null, "a deliberately empty config must not show the 'no view' hint");
  assert.equal(el.shadowRoot.querySelector(".rtc-rotator-solo"), null);
  // The header/average/room chips stay visible regardless — only the view area itself collapses.
  assert.ok(el.shadowRoot.querySelector(".rtc-card"));
  env.cleanup(el);
});

test("AP-05 null-view policy: every view entry explicitly disabled ALSO collapses (same 'deliberately empty' policy as an empty array)", () => {
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

test("AP-05 null-view policy: a view requested but systemically unavailable shows the localized hint, not a collapse", () => {
  // range_scale requested with enabled:true, but no range_entity configured at all -> unavailable.
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }, soloViewHass());
  const data = el._computeViewModel();
  assert.equal(data.views.collapsed, false);
  const hint = el.shadowRoot.querySelector(".rtc-no-views");
  assert.ok(hint, "a requested-but-unavailable view must show the localized hint");
  assert.match(hint.textContent, /No view available/);
  env.cleanup(el);
});

test("P1 fix: setConfig() from a collapsed (deliberately empty) views: to a requested-but-unavailable views: must actually swap in the .rtc-no-views hint", () => {
  // Both states resolve data.views.keys to [] — before the fix, _render()'s
  // viewsChanged check only compared data.views.keys against this._views (both
  // [] in both cases), so this transition never triggered _renderAll() and
  // the DOM stayed stuck on the collapsed (no markup) state.
  const el = env.createCard({ entity: "sensor.avg", views: [] }, soloViewHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null);

  el.setConfig({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }); // no range_entity -> requested but unavailable
  const hint = el.shadowRoot.querySelector(".rtc-no-views");
  assert.ok(hint, "collapse -> requested-but-unavailable must actually render the .rtc-no-views hint, not stay stuck on the collapsed state");
  env.cleanup(el);
});

test("P1 fix: setConfig() from a requested-but-unavailable views: back to a collapsed (deliberately empty) views: must actually remove the .rtc-no-views hint", () => {
  const el = env.createCard({ entity: "sensor.avg", views: [{ type: "range_scale", enabled: true }] }, soloViewHass());
  assert.ok(el.shadowRoot.querySelector(".rtc-no-views"));

  el.setConfig({ entity: "sensor.avg", views: [] });
  assert.equal(el.shadowRoot.querySelector(".rtc-no-views"), null, "requested-but-unavailable -> collapse must actually remove the .rtc-no-views hint, not leave it stuck in the DOM");
  env.cleanup(el);
});

test("AP-05: start_view is honored on the very FIRST render, not just after a later setConfig() structural change", () => {
  const el = env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], start_view: "extremes" },
    soloViewHass()
  );
  assert.equal(el._views[el._activeView], "extremes", "the initial _activeView must already point at start_view on construction, not index 0");
  env.cleanup(el);
});

test("AP-05 acceptance: views: [extremes] renders the actual Extremes view (DOM-verified), never implicitly Scale", () => {
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

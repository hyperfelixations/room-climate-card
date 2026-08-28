"use strict";

// Direct unit tests for the card domain model and semantic view state.
//
// Where the card decides what the WHOLE ROOM SET amounts to, and what the carousel should
// therefore show: which rooms participate, which classification colour each one gets, what
// the summary sentence says, and which views are active given the configuration and the
// availability. Every one of those is a pure function and is exercised as one.
//
// The boundary to application-entity-context.test.js next door: that file settles what a
// SINGLE entity is — its kind, its unit, whether it is a measurement at all — and this one
// starts from the point where those answers already exist. A test that would fail because
// one entity was parsed wrongly belongs there; a test that would fail because the set was
// summarised wrongly belongs here. measurement-context.js is imported by both, deliberately:
// it is the seam, and each file asks it a different question.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stableStringify } = require("../../helpers/baseline-serialization.js");
const { HUMIDITY, TEMPERATURE_C } = require("../../fixtures/attributes.js");

let measurementContext;
let cardDomainModel;
let viewState;

const C = TEMPERATURE_C;
const RH = HUMIDITY;

const AUTO_POLICY = { source: "auto", profile: null, custom: null };
function st(state, attributes) {
  return { state: String(state), attributes: attributes || {} };
}

// A normalized-config stand-in: only the fields the pipeline reads, so a test does
// not have to run the whole normalizer to exercise one decision.
function cfg(overrides = {}) {
  return {
    entity: "sensor.avg",
    rooms: [],
    range_entity: null,
    trend_entity: null,
    classification: AUTO_POLICY,
    room_columns: null,
    room_rows: null,
    room_sort: "value_asc",
    room_label: "auto",
    show_rooms: "auto",
    views: null,
    title: null,
    entity_label: null,
    icon: null,
    decimals: null,
    ...overrides,
  };
}

function room(entity, name = entity, short = name) {
  return { entity, name, short, tap_action: null, hold_action: null };
}

test.before(async () => {
  measurementContext = await import("../../../src/application/model/measurement-context.js");
  cardDomainModel = await import("../../../src/application/model/card-domain-model.js");
  viewState = await import("../../../src/presentation/view-model/view-state.js");
});

// -------------------------------------------------------- CardDomainModel --

function domainFor(config, states, language = "en") {
  const context = measurementContext.resolveMeasurementContext(states, config);
  return cardDomainModel.buildCardDomainModel({ states, config, context, language });
}

test("the empty model keeps its minimal shape and names the configuration state", () => {
  const model = domainFor(
    cfg({ rooms: [room("sensor.r1"), room("sensor.missing")] }),
    { "sensor.avg": st("unavailable", C), "sensor.r1": st("unknown", C) }
  );
  assert.equal(model.empty, true);
  assert.equal(model.metric.kind, "temperature");
  assert.equal(model.missingRooms, 1, "only the entity absent from states counts as missing");
  assert.equal(model.configurationState, null, "nothing usable is not a mixed-kind state");

  const mixed = domainFor(
    cfg({ rooms: [room("sensor.r1"), room("sensor.h")] }),
    { "sensor.avg": st("unavailable", C), "sensor.r1": st(21, C), "sensor.h": st(55, RH) }
  );
  assert.equal(mixed.configurationState, "mixed_metric_kinds");
});

test("a grid cap limits nothing but the chip count", () => {
  const rooms = [19.2, 20.8, 21.6, 22.3, 23.1, 24.4, 25.7].map((v, i) => ({ value: v, entity: `sensor.r${i}` }));
  const states = { "sensor.avg": st(22.4, { ...C, spread: 6.5 }) };
  for (const r of rooms) states[r.entity] = st(r.value, C);
  const config = cfg({ rooms: rooms.map((r) => room(r.entity, `Room ${r.entity}`)) });

  const uncapped = domainFor(config, states);
  const capped = domainFor({ ...config, room_columns: 3, room_rows: 2 }, states);

  assert.equal(uncapped.rooms.count, 7);
  assert.equal(capped.rooms.count, 7, "the model still knows every room");
  assert.equal(capped.average.value, uncapped.average.value);
  assert.equal(capped.spread, uncapped.spread);
  assert.deepEqual(capped.comfort, uncapped.comfort);
  assert.equal(capped.extremes.coolest.value, uncapped.extremes.coolest.value);
  assert.equal(capped.extremes.warmest.value, uncapped.extremes.warmest.value);
  assert.deepEqual(Object.keys(capped.roomColors), Object.keys(uncapped.roomColors));
});

test("the domain model carries no rendering geometry at all", () => {
  // The layer boundary: an axis, a band rectangle, a marker
  // percentage and a pixel nudge are all statements about a RENDERED bar, not about
  // the measurement. Only the axis POLICY belongs here.
  const states = {
    "sensor.avg": st(22, C),
    "sensor.r1": st(20, C),
    "sensor.r2": st(24, C),
    "sensor.range": st(4, { ...C, minimum: 18, maximum: 22 }),
  };
  const model = domainFor(
    cfg({ range_entity: "sensor.range", rooms: [room("sensor.r1"), room("sensor.r2")], views: [{ type: "range_scale", enabled: true, options: {} }] }),
    states
  );

  for (const forbidden of ["scale", "rangeScale", "roomMarkers"]) {
    assert.equal(model[forbidden], undefined, `${forbidden} is rendering geometry and must not be on the domain model`);
  }
  assert.deepEqual(Object.keys(model.extremes).sort(), ["coolest", "coolestColor", "warmest", "warmestColor"], "no positions, no shifts");
  // What remains is the raw input the presentation layer turns into geometry.
  assert.equal(typeof model.scaleConfig, "object");
  assert.deepEqual(Object.keys(model.optimal).sort(), ["max", "min"]);

  // And no marker position or pixel offset hides anywhere else in the tree either.
  const serialized = stableStringify(model);
  for (const forbidden of ["markerPositions", "coolestShift", "warmestShift", "comfortLeft", "optimalCenter", "displayStep", "boundaryLabels"]) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} must not appear anywhere in the domain model`);
  }
  // Nor a CSS-ready colour. A validated hex from a profile or an entity attribute is
  // a semantic classification value and IS allowed; an rgba() derivation is not.
  assert.ok(!serialized.includes("rgba("), "no CSS-ready colour in the domain model");
  assert.match(model.extremes.coolestColor, /^#[0-9a-f]{3,8}$/i, "the semantic classification colour stays");
});

test("every participating room gets exactly one classification colour, keyed by its YAML index", () => {
  const model = domainFor(
    cfg({ rooms: [room("sensor.r1"), room("sensor.r2"), room("sensor.r3")] }),
    { "sensor.avg": st(22, C), "sensor.r1": st(18, C), "sensor.r2": st(22, C), "sensor.r3": st(28, C) }
  );
  assert.deepEqual(Object.keys(model.roomColors).sort(), ["0", "1", "2"]);
  // The extremes read the SAME entry, so a room can never appear in two colours.
  assert.equal(model.extremes.coolestColor, model.roomColors[0]);
  assert.equal(model.extremes.warmestColor, model.roomColors[2]);
});

test("the domain room model carries no label and no colour", () => {
  const model = domainFor(
    cfg({ rooms: [room("sensor.r1", "Kitchen", "KI"), room("sensor.r2", "Bath", "BA")] }),
    { "sensor.avg": st(22, C), "sensor.r1": st(21, C), "sensor.r2": st(23, C) }
  );
  assert.deepEqual(Object.keys(model.rooms.declared[0]).sort(), [
    "entity", "hold_action", "index", "name", "short", "tap_action", "value",
  ]);
});

test("all four classification sources reach the domain model", () => {
  const base = { "sensor.avg": st(26, { ...C, value_color: "#3fa7d6", value_level: "Server level", value_score: 7, value_zone: "comfort" }) };

  const auto = domainFor(cfg(), base).classification.average;
  assert.equal(auto.source, "entity", "a complete entity pair wins in automatic mode");
  assert.equal(auto.level, "Server level");

  const entityOnly = domainFor(cfg({ classification: { source: "entity", profile: null, custom: null } }), base).classification.average;
  assert.equal(entityOnly.source, "entity");
  assert.equal(entityOnly.score, 7);

  const builtin = domainFor(cfg(), { "sensor.avg": st(26, C) }).classification.average;
  assert.equal(builtin.source, "builtin");
  assert.equal(builtin.profileId, "indoor");
  assert.equal(builtin.level, null, "a built-in tier carries a key, not text");
  assert.equal(typeof builtin.levelKey, "string");

  const profile = domainFor(cfg({ classification: { source: "profile", profile: "outdoor", custom: null } }), { "sensor.avg": st(26, C) }).classification.average;
  assert.equal(profile.profileId, "outdoor");

  const custom = domainFor(
    cfg({
      classification: {
        source: "custom",
        profile: null,
        custom: {
          id: "custom", metricKind: "temperature", comparison: ">=",
          tiers: [{ min: 24, score: 2, level: "Custom warm", color: "#cc4444", zone: "outside" }, { min: -Infinity, score: 1, level: "Custom cold", color: "#4488cc", zone: "outside" }],
          comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 }, scale: { min: 16, max: 28 }, step: 2,
          invalidWhen: null, validRange: null,
          invalidClassification: { score: null, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
          iconTiers: [{ min: 30, icon: "mdi:fire-alert" }, { min: -Infinity, icon: "mdi:snowflake" }],
        },
      },
    }),
    { "sensor.avg": st(26, C) }
  ).classification.average;
  assert.equal(custom.source, "custom");
  assert.equal(custom.profileId, "custom");
  assert.equal(custom.level, "Custom warm", "a custom level stays verbatim");
});

test("the profile icon is a token, with null meaning 'use the metric default'", () => {
  const temperature = domainFor(cfg(), { "sensor.avg": st(30, C) });
  assert.equal(temperature.classification.profileIcon, "mdi:fire-alert");
  const humidity = domainFor(cfg(), { "sensor.avg": st(80, RH) });
  assert.equal(humidity.classification.profileIcon, "mdi:water-percent-alert");
});

// --------------------------------------------------------------- views ----

test("without a views: config every view resolves from its own default", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: null },
  });
  assert.deepEqual(state.keys, ["range", "scale", "extremes"], "range_scale stays off by default");
  assert.equal(state.hasRangeScale, false);
  assert.equal(state.collapsed, false);
});

test("availability alone can remove a view", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: false, roomsComparable: false, rangeScaleAvailable: false },
    config: { views: null },
  });
  assert.deepEqual(state.keys, ["scale"], "scale is the only unconditional view");
});

test("an explicit views: list is authoritative in content and order", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [{ type: "extremes", enabled: true, options: {} }, { type: "range", enabled: true, options: {} }] },
  });
  assert.deepEqual(state.keys, ["extremes", "range"], "listed order wins, and scale is genuinely omitted");
});

test("an explicitly requested range_scale appears", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [{ type: "range_scale", enabled: true, options: {} }] },
  });
  assert.deepEqual(state.keys, ["range_scale"]);
  assert.equal(state.hasRangeScale, true);
});

test("an empty views: list collapses the view area", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [] },
  });
  assert.deepEqual(state.keys, []);
  assert.equal(state.collapsed, true, "asking for nothing is not a misconfiguration");
});

test("a requested-but-unavailable view is NOT a collapse", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: false, roomsComparable: false, rangeScaleAvailable: false },
    config: { views: [{ type: "range_scale", enabled: true, options: {} }] },
  });
  assert.deepEqual(state.keys, []);
  assert.equal(state.collapsed, false, "the user asked for something that cannot show — that needs a hint");
  assert.deepEqual(state.entries.map((e) => [e.requested, e.available]), [[true, false]]);
});

test("an explicitly disabled view is neither active nor a reason for a hint", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [{ type: "range", enabled: false, options: {} }] },
  });
  assert.deepEqual(state.keys, []);
  assert.equal(state.collapsed, true);
});

test("unknown and duplicate view types are diagnosed, not thrown", () => {
  const { keys, diagnostics } = viewState.resolveActiveViews(
    viewState.VIEW_DEFINITIONS,
    { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    { views: [{ type: "bogus", enabled: true, options: {} }, { type: "scale", enabled: true, options: {} }, { type: "scale", enabled: true, options: {} }] }
  );
  assert.deepEqual(keys, ["scale"]);
  assert.deepEqual(diagnostics, ['views: unknown view type "bogus"', 'views: duplicate view type "scale"']);
});

test("every view's options are resolved, active or not", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: false, roomsComparable: false, rangeScaleAvailable: false },
    config: { views: null },
  });
  assert.deepEqual(Object.keys(state.options).sort(), ["extremes", "range", "range_scale", "scale"]);
  assert.deepEqual(state.options.range, { show_time: true });
  assert.deepEqual(state.options.scale, {
    show_comfort_band: true,
    show_optimal_band: true,
    show_footer: true,
    footer: true,
    markers: "extremes",
  });
  assert.deepEqual(state.options.range_scale, {
    show_comfort_band: true,
    show_optimal_band: true,
    show_footer: true,
    footer: "detailed",
  });
  assert.deepEqual(state.options.extremes, { show_value: true });
});

test("a configured option overrides its default and the rest keep theirs", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [{ type: "scale", enabled: true, options: { markers: "all", show_footer: false } }] },
  });
  assert.deepEqual(state.options.scale, {
    show_comfort_band: true,
    show_optimal_band: true,
    show_footer: false,
    footer: true,
    markers: "all",
  });
});

test("the older footer:false folds onto show_footer, and the newer key wins when both are written", () => {
  // The one legacy fold in this layer, and the reason it is here rather than in
  // config/views.js: that module is schema-driven and deliberately knows nothing about what
  // an option MEANS. The definitions do, and they are in this file's subject.
  const resolve = (key, options) =>
    viewState.resolveViewOptions(
      viewState.VIEW_DEFINITIONS.find((definition) => definition.key === key),
      options
    );

  const folded = resolve("range_scale", { footer: false });
  assert.equal(folded.show_footer, false, "the older word still turns the footer off");
  assert.equal(folded.footer, "detailed", "and stops being read as a form");

  const explicit = resolve("range_scale", { show_footer: true, footer: false });
  assert.equal(explicit.show_footer, true, "the newer key decides when both are written");
  assert.equal(explicit.footer, "detailed");

  const form = resolve("range_scale", { footer: "compact" });
  assert.equal(form.show_footer, true, "a form alone says nothing about whether");
  assert.equal(form.footer, "compact");

  // The view with no footer at all is untouched by any of this.
  assert.deepEqual(resolve("extremes", { footer: false }), { show_value: true });
});

test("the view definitions carry no render or update callback", () => {
  // The whole point of the split: these are semantic definitions, and the
  // composition root binds the renderers separately.
  for (const definition of viewState.VIEW_DEFINITIONS) {
    assert.deepEqual(
      Object.keys(definition).sort(),
      ["condition", "defaultEnabled", "key", "optionsSchema"],
      `view "${definition.key}"`
    );
  }
});

test("the definition order is the on-screen order", () => {
  assert.deepEqual(viewState.VIEW_DEFINITIONS.map((d) => d.key), ["range", "range_scale", "scale", "extremes"]);
});

"use strict";

// Direct unit tests for src/application/model/* — the pipeline that turns Home
// Assistant states into a language-independent model of the reading.
//
// This is where the card decides what a number MEANS: which entity is allowed to
// determine the metric kind, which rooms may be averaged, whether a reading is a
// measurement at all, and what the resulting sentence should say. Tests exercise
// those decisions at their pure-function owners.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stableStringify } = require("../helpers/characterization.js");

let entityModel;
let measurementContext;
let auxiliary;
let aggregates;
let cardDomainModel;
let viewState;

const C = { device_class: "temperature", unit_of_measurement: "°C" };
const F = { device_class: "temperature", unit_of_measurement: "°F" };
const K = { device_class: "temperature", unit_of_measurement: "K" };
const RH = { device_class: "humidity", unit_of_measurement: "%" };
const CO2 = { device_class: "carbon_dioxide", unit_of_measurement: "ppm" };

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
  entityModel = await import("../../src/application/model/entity-model.js");
  measurementContext = await import("../../src/application/model/measurement-context.js");
  auxiliary = await import("../../src/application/model/auxiliary-models.js");
  aggregates = await import("../../src/application/model/aggregates.js");
  cardDomainModel = await import("../../src/application/model/card-domain-model.js");
  viewState = await import("../../src/presentation/view-model/view-state.js");
});

// ------------------------------------------------------------ EntityModel --

test("a fully valid entity resolves kind, unit and canonical value together", () => {
  const states = { "sensor.a": st(21.5, C) };
  const model = entityModel.buildEntityModel(states, cfg(), "sensor.a", "primary");
  assert.equal(model.metricKind, "temperature");
  assert.equal(model.unitProfile, "celsius");
  assert.equal(model.rawValue, 21.5);
  assert.equal(model.canonicalValue, 21.5);
  assert.equal(model.validNumeric, true);
  assert.equal(model.validUnit, true);
  assert.equal(model.validPhysical, true);
  assert.equal(model.sourceRole, "primary");
});

test("a Fahrenheit reading is canonicalized, not passed through", () => {
  const model = entityModel.buildEntityModel({ "sensor.a": st(72.5, F) }, cfg(), "sensor.a", "primary");
  assert.equal(model.unitProfile, "fahrenheit");
  assert.equal(model.rawValue, 72.5);
  assert.ok(Math.abs(model.canonicalValue - 22.5) < 1e-9, `got ${model.canonicalValue}`);
});

test("a MISSING unit is as unusable as an unknown one — never assumed canonical", () => {
  // The asymmetry this replaced (missing -> canonical, wrong -> rejected) was the
  // single most dangerous shortcut in the old pipeline.
  const missing = entityModel.buildEntityModel({ "sensor.a": st(21.5, { device_class: "temperature" }) }, cfg(), "sensor.a", "primary");
  assert.equal(missing.metricKind, "temperature", "the kind is still resolved, for title and icon");
  assert.equal(missing.validUnit, false);
  assert.equal(missing.unitProfile, null);
  assert.equal(missing.canonicalValue, 21.5, "left as the raw value, but flagged unusable");

  const unknown = entityModel.buildEntityModel({ "sensor.a": st(1013, { device_class: "temperature", unit_of_measurement: "hPa" }) }, cfg(), "sensor.a", "primary");
  assert.equal(unknown.validUnit, false);
  assert.equal(unknown.unitProfile, null);
});

test("non-numeric and sentinel states are not measurements", () => {
  for (const raw of ["unavailable", "unknown", "none", "", "25 °C", "abc"]) {
    const model = entityModel.buildEntityModel({ "sensor.a": st(raw, C) }, cfg(), "sensor.a", "primary");
    assert.equal(model.validNumeric, false, JSON.stringify(raw));
    assert.equal(model.validPhysical, false, `${JSON.stringify(raw)}: an invalid number cannot be physically valid`);
  }
});

test("EntityModel assigns every availability status at the raw-state boundary", () => {
  const config = cfg();
  assert.equal(entityModel.buildEntityModel({}, config, "sensor.a", "primary").availability, "missing");
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st("unavailable", C) }, config, "sensor.a", "primary").availability, "unavailable");
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st("garbage", C) }, config, "sensor.a", "primary").availability, "invalid_value");
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(-5, RH) }, config, "sensor.a", "primary").availability, "invalid_value");
  assert.equal(
    entityModel.buildEntityModel({ "sensor.a": st(21, { device_class: "temperature" }) }, config, "sensor.a", "primary").availability,
    "incompatible_unit"
  );
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(21, {}) }, config, "sensor.a", "primary").availability, "incompatible_kind");
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(21, C) }, config, "sensor.a", "primary").availability, "usable");
});

test("a missing entity yields an all-null model rather than throwing", () => {
  const model = entityModel.buildEntityModel({}, cfg(), "sensor.absent", "room");
  assert.equal(model.stateObject, null);
  assert.equal(model.rawValue, null);
  assert.equal(model.metricKind, null);
  assert.equal(model.validNumeric, false);
  assert.deepEqual(model.errors, []);
});

test("physical validity runs after canonicalization, not before", () => {
  // 0 ppm is a stuck sensor, not a clean room.
  const zero = entityModel.buildEntityModel({ "sensor.a": st(0, CO2) }, cfg(), "sensor.a", "primary");
  assert.equal(zero.validNumeric, true);
  assert.equal(zero.validPhysical, false);
  // A negative humidity is impossible.
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(-5, RH) }, cfg(), "sensor.a", "primary").validPhysical, false);
  // 120 °F is 48.9 °C — perfectly possible, and would have been rejected if the
  // check had run against the raw value with Celsius limits.
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(120, F) }, cfg(), "sensor.a", "primary").validPhysical, true);
});

test("validity is checked leniently, so a foreign-kind probe cannot throw", () => {
  // An outdoor temperature profile is configured; an incidental humidity room is
  // still probed for its own kind before the kind filter runs.
  const config = cfg({ classification: { source: "profile", profile: "outdoor", custom: null } });
  assert.doesNotThrow(() => entityModel.buildEntityModel({ "sensor.h": st(55, RH) }, config, "sensor.h", "room"));
});

test("device_class wins over unit, and unit is the fallback", () => {
  const states = {
    "sensor.byClass": st(21, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.byUnit": st(21, { unit_of_measurement: "%" }),
    "sensor.neither": st(21, {}),
  };
  assert.equal(entityModel.metricKindForEntity(states, "sensor.byClass"), "co2");
  assert.equal(entityModel.metricKindForEntity(states, "sensor.byUnit"), "humidity");
  assert.equal(entityModel.metricKindForEntity(states, "sensor.neither"), null);
});

test("auxiliary unit resolution strips a rate suffix but stays strict otherwise", () => {
  const states = {
    "sensor.rate": st(0.4, { unit_of_measurement: "°C/h" }),
    "sensor.bare": st(0.4, { unit_of_measurement: "°C" }),
    "sensor.spaced": st(0.4, { unit_of_measurement: "°C / h" }),
    "sensor.foreign": st(0.4, { unit_of_measurement: "hPa/h" }),
    "sensor.nounit": st(0.4, {}),
  };
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.rate", "temperature", { rateSuffix: true }), "celsius");
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.bare", "temperature", { rateSuffix: true }), "celsius");
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.spaced", "temperature", { rateSuffix: true }), "celsius");
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.foreign", "temperature", { rateSuffix: true }), null);
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.nounit", "temperature", { rateSuffix: true }), null);
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, null, "temperature"), null);
  // Without the suffix flag a rate unit does not resolve.
  assert.equal(entityModel.resolveAuxiliaryUnitProfileKey(states, "sensor.rate", "temperature"), null);
});

// ------------------------------------------------------ MeasurementContext --

test("a usable primary alone decides the metric kind and is the average source", () => {
  const states = { "sensor.avg": st(22, C), "sensor.r1": st(21, C), "sensor.r2": st(23, C) };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.r1"), room("sensor.r2")] }));
  assert.equal(context.metricKind, "temperature");
  assert.equal(context.sourceKind, "primary");
  assert.equal(context.averageSource.kind, "primary");
  assert.equal(context.averageSource.canonicalValue, 22);
  assert.equal(context.participatingRooms.length, 2);
  assert.deepEqual(context.diagnostics, []);
  assert.equal(context.consistent, true);
});

test("a foreign-kind room is excluded and diagnosed, never averaged in", () => {
  const states = { "sensor.avg": st(22, C), "sensor.r1": st(21, C), "sensor.h": st(55, RH) };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.r1"), room("sensor.h")] }));
  assert.deepEqual(context.participatingRooms.map((r) => r.entityId), ["sensor.r1"]);
  assert.deepEqual(context.excludedRoomIds, ["sensor.h"]);
  assert.deepEqual(context.diagnostics, [{ code: "excluded_foreign_metric_kind", entityId: "sensor.h", metricKind: "humidity" }]);
});

test("a same-kind room with an unusable unit is excluded and diagnosed", () => {
  const states = {
    "sensor.avg": st(22, C),
    "sensor.r1": st(21, C),
    "sensor.bad": st(21, { device_class: "temperature", unit_of_measurement: "hPa" }),
  };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.r1"), room("sensor.bad")] }));
  assert.deepEqual(context.participatingRooms.map((r) => r.entityId), ["sensor.r1"]);
  assert.deepEqual(context.diagnostics, [{ code: "unusable_unit", entityId: "sensor.bad", metricKind: "temperature" }]);
});

test("diagnostics keep their order: exclusions in room declaration order", () => {
  const states = {
    "sensor.avg": st(22, C),
    "sensor.h": st(55, RH),
    "sensor.bad": st(21, { device_class: "temperature", unit_of_measurement: "hPa" }),
    "sensor.c": st(21, CO2),
  };
  const context = measurementContext.resolveMeasurementContext(
    states,
    cfg({ rooms: [room("sensor.h"), room("sensor.bad"), room("sensor.c")] })
  );
  assert.deepEqual(context.diagnostics.map((d) => [d.code, d.entityId]), [
    ["excluded_foreign_metric_kind", "sensor.h"],
    ["unusable_unit", "sensor.bad"],
    ["excluded_foreign_metric_kind", "sensor.c"],
  ]);
});

test("an unusable primary hands over to room consensus", () => {
  const states = { "sensor.avg": st("unavailable", C), "sensor.r1": st(20, C), "sensor.r2": st(24, C) };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.r1"), room("sensor.r2")] }));
  assert.equal(context.sourceKind, "roomConsensus");
  assert.equal(context.averageSource.kind, "roomConsensus");
  assert.equal(context.averageSource.canonicalValue, 22);
  assert.deepEqual(context.averageSource.entityIds, ["sensor.r1", "sensor.r2"]);
  assert.equal(context.averageSource.unitProfile, null);
});

test("an unavailable room can never out-vote an available one", () => {
  const states = {
    "sensor.avg": st("unavailable", C),
    "sensor.r1": st(20, C),
    "sensor.r2": st("unavailable", RH),
    "sensor.r3": st("unknown", RH),
  };
  const context = measurementContext.resolveMeasurementContext(
    states,
    cfg({ rooms: [room("sensor.r1"), room("sensor.r2"), room("sensor.r3")] })
  );
  assert.equal(context.metricKind, "temperature", "two unavailable humidity rooms do not make this a humidity card");
  assert.equal(context.sourceKind, "roomConsensus");
});

test("mixed metric kinds produce a defined state, not a majority winner", () => {
  const states = {
    "sensor.avg": st("unavailable", C),
    "sensor.r1": st(21, C),
    "sensor.r2": st(55, RH),
    "sensor.r3": st(56, RH),
  };
  const context = measurementContext.resolveMeasurementContext(
    states,
    cfg({ rooms: [room("sensor.r1"), room("sensor.r2"), room("sensor.r3")] })
  );
  assert.equal(context.metricKind, null, "humidity outnumbers temperature 2:1 and still does not win");
  assert.equal(context.averageSource, null);
  assert.equal(context.consistent, false);
  assert.equal(context.sourceKind, "mixed");
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  assert.deepEqual(context.diagnostics[0].metricKinds, ["temperature", "humidity"]);
});

test("the mixed diagnosis comes first, before any unusable-unit entries", () => {
  const states = {
    "sensor.avg": st("unavailable", C),
    "sensor.bad": st(21, { device_class: "temperature", unit_of_measurement: "hPa" }),
    "sensor.r1": st(21, C),
    "sensor.r2": st(55, RH),
  };
  const context = measurementContext.resolveMeasurementContext(
    states,
    cfg({ rooms: [room("sensor.bad"), room("sensor.r1"), room("sensor.r2")] })
  );
  assert.deepEqual(context.diagnostics.map((d) => d.code), ["mixed_metric_kinds", "unusable_unit"]);
});

test("compatible mixed units are averaged canonically", () => {
  // 70 °F is 21.111 °C; the mean with 22 °C is 21.556 °C, not the mean of 70 and 22.
  const states = { "sensor.avg": st("unavailable", C), "sensor.f": st(70, F), "sensor.c": st(22, C) };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.f"), room("sensor.c")] }));
  const expected = (((70 - 32) * 5) / 9 + 22) / 2;
  assert.ok(Math.abs(context.averageSource.canonicalValue - expected) < 1e-9, `got ${context.averageSource.canonicalValue}`);
});

test("a room consensus spanning disagreeing units displays canonically", () => {
  const mixed = measurementContext.resolveMeasurementContext(
    { "sensor.avg": st("unavailable", C), "sensor.f": st(70, F), "sensor.c": st(22, C) },
    cfg({ rooms: [room("sensor.f"), room("sensor.c")] })
  );
  assert.equal(mixed.displayUnitProfile.key, "celsius", "no room's unit may be preferred arbitrarily");
  assert.equal(mixed.unit, "°C");

  const agreeing = measurementContext.resolveMeasurementContext(
    { "sensor.avg": st("unavailable", C), "sensor.f1": st(70, F), "sensor.f2": st(74, F) },
    cfg({ rooms: [room("sensor.f1"), room("sensor.f2")] })
  );
  assert.equal(agreeing.displayUnitProfile.key, "fahrenheit", "a unanimous room unit does become the display unit");
  assert.equal(agreeing.unit, "°F");
});

test("the display unit follows a usable primary", () => {
  const context = measurementContext.resolveMeasurementContext(
    { "sensor.avg": st(295.15, K), "sensor.r1": st(22, C) },
    cfg({ rooms: [room("sensor.r1")] })
  );
  assert.equal(context.displayUnitProfile.key, "kelvin");
  assert.equal(context.unit, "K");
});

test("an unavailable source preserves its kind while absent metadata preserves null", () => {
  const fromPrimary = measurementContext.resolveMeasurementContext({ "sensor.avg": st("unavailable", RH) }, cfg());
  assert.equal(fromPrimary.metricKind, "humidity", "an unavailable primary still names the kind");
  assert.equal(fromPrimary.averageSource, null);
  assert.equal(fromPrimary.sourceKind, "primary");

  const fromNothing = measurementContext.resolveMeasurementContext({}, cfg());
  assert.equal(fromNothing.metricKind, null, "no source metadata means no invented display kind");
  assert.equal(fromNothing.identityMetricKind, null);
  assert.equal(fromNothing.sourceKind, "primary");
  assert.equal(fromNothing.unit, "");
});

test("effectiveMetricKind() substitutes the default for the mixed state", () => {
  assert.equal(measurementContext.effectiveMetricKind({ metricType: null }), "temperature");
  assert.equal(measurementContext.effectiveMetricKind({ metricType: "co2" }), "co2");
});

// ------------------------------------------------------ auxiliary models --

test("the range state is a DELTA and its min/max are ABSOLUTE", () => {
  const states = {
    "sensor.range": st(8.1, { ...F, minimum: 64.4, maximum: 77.9 }),
  };
  const identity = (v) => v;
  const range = auxiliary.buildRangeModel({
    states,
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: identity,
    toDisplayDelta: identity,
  });
  // 8.1 °F width is 4.5 °C — a delta, so no +32 offset.
  assert.ok(Math.abs(range.state - (8.1 * 5) / 9) < 1e-9, `state ${range.state}`);
  // 64.4 °F is 18 °C — an absolute, so the offset applies.
  assert.ok(Math.abs(range.min - 18) < 1e-9, `min ${range.min}`);
  assert.ok(Math.abs(range.max - 25.5) < 1e-9, `max ${range.max}`);
  assert.equal(range.hasRange, true);
  assert.equal(range.rangeScaleAvailable, true);
});

test("a negative range width is invalid, and takes min/max down with it", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(-1, { ...C, minimum: 18, maximum: 25 }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.hasRange, false);
  assert.equal(range.min, null);
  assert.equal(range.max, null);
  assert.equal(range.rangeScaleAvailable, false);
});

test("an inverted min/max pair blocks the range-scale view but not the range view", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 25, maximum: 18 }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.hasRange, true);
  assert.equal(range.rangeScaleAvailable, false);
});

test("a range entity with an unusable unit contributes nothing", () => {
  for (const attributes of [{ minimum: 18, maximum: 25 }, { unit_of_measurement: "hPa", minimum: 18, maximum: 25 }]) {
    const range = auxiliary.buildRangeModel({
      states: { "sensor.range": st(5, attributes) },
      config: cfg({ range_entity: "sensor.range" }),
      policy: AUTO_POLICY,
      metricKind: "temperature",
      displayUnitProfile: null,
      toDisplay: (v) => v,
      toDisplayDelta: (v) => v,
    });
    assert.equal(range.hasRange, false, JSON.stringify(attributes));
    assert.equal(range.state, null);
  }
});

test("range timestamps are returned raw, not formatted", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 18, maximum: 25, minimum_zeitpunkt: "2026-07-24T06:12:00Z" }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.minTimestamp, "2026-07-24T06:12:00Z");
  assert.equal(range.maxTimestamp, null, "a missing timestamp is null, not undefined");
});

test("historical range extremes classify numerically, never from the entity's colour", () => {
  // range_entity carries a live value_color; min/max must ignore it.
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 18, maximum: 25, value_color: "#ff0000", value_level: "Live" }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.notEqual(range.minColor, "#ff0000");
  assert.notEqual(range.maxColor, "#ff0000");
  assert.notEqual(range.minColor, range.maxColor, "18 °C and 25 °C are different tiers");
});

test("the trend is a RATE and keeps its own deadband", () => {
  const identity = (v) => v;
  const build = (value, attributes) =>
    auxiliary.buildTrendContext({
      states: { "sensor.trend": st(value, attributes) },
      config: cfg({ trend_entity: "sensor.trend" }),
      metricKind: "temperature",
      unit: "°C",
      toDisplayDelta: identity,
    });
  assert.equal(build(0.4, { unit_of_measurement: "°C/h" }).model.direction, "rising");
  assert.equal(build(-0.4, { unit_of_measurement: "°C/h" }).model.direction, "falling");
  assert.equal(build(0.05, { unit_of_measurement: "°C/h" }).model.direction, "stable");
  // 1.8 °F/h is exactly 1 °C/h — a rate, so no offset.
  const fahrenheit = build(1.8, { unit_of_measurement: "°F/h" });
  assert.ok(Math.abs(fahrenheit.model.canonicalValue - 1) < 1e-9, `got ${fahrenheit.model.canonicalValue}`);
  assert.equal(fahrenheit.unit, "°C/h", "labelled in the display unit the number was converted to");
});

test("a trend entity that reports nothing usable yields a null model", () => {
  const identity = (v) => v;
  const none = auxiliary.buildTrendContext({ states: {}, config: cfg(), metricKind: "temperature", unit: "°C", toDisplayDelta: identity });
  assert.equal(none.model, null);
  assert.equal(none.value, null);
  assert.equal(none.unit, null, "no configured entity means no unit label either");

  const unusable = auxiliary.buildTrendContext({
    states: { "sensor.trend": st(0.4, { unit_of_measurement: "hPa/h" }) },
    config: cfg({ trend_entity: "sensor.trend" }),
    metricKind: "temperature",
    unit: "°C",
    toDisplayDelta: identity,
  });
  assert.equal(unusable.model, null);
  assert.equal(unusable.unit, "°C/h", "the label exists because the entity is configured");
});

test("buildTrendModel() rejects a non-finite value and a missing unit", () => {
  assert.equal(auxiliary.buildTrendModel("temperature", 0.5, NaN, "°C/h"), null);
  assert.equal(auxiliary.buildTrendModel("temperature", 0.5, 0.5, null), null);
  assert.equal(auxiliary.buildTrendModel("pressure", 0.5, 0.5, "hPa/h"), null, "an unregistered kind has no policy");
});

test("negative zero is carried through as a stable trend", () => {
  const model = auxiliary.buildTrendModel("temperature", -0, -0, "°C/h");
  assert.equal(model.direction, "stable");
  assert.ok(Object.is(model.value, -0), "the value keeps its sign; only the rendered text normalizes it");
});

// -------------------------------------------------------------- aggregates --

test("comfort counting splits rooms into inside, too warm and too cool", () => {
  const rooms = [{ value: 18 }, { value: 20 }, { value: 22 }, { value: 24 }, { value: 26 }];
  assert.deepEqual(aggregates.computeComfortCounts(rooms, { min: 20, max: 24 }, true), {
    inComfort: 3,
    tooWarm: 1,
    tooCool: 1,
  });
  assert.deepEqual(aggregates.computeComfortCounts(rooms, { min: 20, max: 24 }, false), {
    inComfort: 0,
    tooWarm: 0,
    tooCool: 0,
  });
});

test("the spread prefers a valid sensor attribute and falls back otherwise", () => {
  const coolest = { value: 19 };
  const warmest = { value: 25 };
  assert.equal(aggregates.computeSpread({ attributeValue: 6.5, roomsComparable: true, coolest, warmest }), 6.5);
  assert.equal(aggregates.computeSpread({ attributeValue: null, roomsComparable: true, coolest, warmest }), 6);
  assert.equal(aggregates.computeSpread({ attributeValue: -1, roomsComparable: true, coolest, warmest }), 6, "a negative spread is impossible");
  assert.equal(aggregates.computeSpread({ attributeValue: 0, roomsComparable: true, coolest, warmest }), 0, "zero is a valid spread");
  assert.equal(aggregates.computeSpread({ attributeValue: null, roomsComparable: false, coolest: null, warmest: null }), 0);
});

test("the value sort breaks ties by name, deterministically", () => {
  const rooms = [
    { name: "Zimmer", value: 21 },
    { name: "Arbeit", value: 21 },
    { name: "Bad", value: 19 },
  ];
  assert.deepEqual(aggregates.sortRoomsByValue(rooms, "de").map((r) => r.name), ["Bad", "Arbeit", "Zimmer"]);
  assert.deepEqual(aggregates.sortRoomsByValue(rooms, "de"), aggregates.sortRoomsByValue(rooms, "de"));
});

test("every subtitle branch is reachable and carries its own numbers", () => {
  const comfort = { min: 20, max: 24 };
  const coolest = { name: "Bad", value: 18 };
  const warmest = { name: "Küche", value: 26 };
  const counts = { inComfort: 1, tooWarm: 1, tooCool: 1 };

  const above = aggregates.buildSubtitleModel({ avg: 25, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(above.kind, "aboveComfort");
  assert.equal(above.diff, 1);
  assert.equal(above.count, 1);
  assert.equal(above.total, 3);
  assert.equal(above.adjective, "above");

  const aboveNoRooms = aggregates.buildSubtitleModel({ avg: 25, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(aboveNoRooms.kind, "aboveComfortNoRooms");
  assert.equal(aboveNoRooms.diff, 1);

  const below = aggregates.buildSubtitleModel({ avg: 19, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(below.kind, "belowComfort");
  assert.equal(below.diff, 1);
  assert.equal(below.adjective, "below");

  const belowNoRooms = aggregates.buildSubtitleModel({ avg: 19, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(belowNoRooms.kind, "belowComfortNoRooms");

  const issue = aggregates.buildSubtitleModel({ avg: 22, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(issue.kind, "inComfortIssue");
  assert.equal(issue.name, "Küche", "26 is 4 away from 22, 18 is 4 away — the warmest wins the tie");

  const allGood = aggregates.buildSubtitleModel({
    avg: 22, comfort, roomsComparable: true,
    counts: { inComfort: 3, tooWarm: 0, tooCool: 0 },
    roomCount: 3, coolest: { name: "A", value: 21 }, warmest: { name: "B", value: 23 }, missingRooms: 0,
  });
  assert.equal(allGood.kind, "inComfortAllGood");

  const plain = aggregates.buildSubtitleModel({ avg: 22, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(plain.kind, "inComfort");
});

test("the out-of-comfort room furthest from the average is the one named", () => {
  const comfort = { min: 20, max: 24 };
  const counts = { inComfort: 1, tooWarm: 1, tooCool: 1 };
  const base = { avg: 22, comfort, roomsComparable: true, counts, roomCount: 3, missingRooms: 0 };
  // Only the warmest is out.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 21 }, warmest: { name: "Warm", value: 30 } }).name,
    "Warm"
  );
  // Only the coolest is out.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 10 }, warmest: { name: "Warm", value: 23 } }).name,
    "Cool"
  );
  // Both are out; the further one wins.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 5 }, warmest: { name: "Warm", value: 25 } }).name,
    "Cool"
  );
});

test("missing rooms are reported alongside whichever sentence applies", () => {
  const model = aggregates.buildSubtitleModel({
    avg: 22, comfort: { min: 20, max: 24 }, roomsComparable: false,
    counts: { inComfort: 0, tooWarm: 0, tooCool: 0 }, roomCount: 0, coolest: null, warmest: null, missingRooms: 3,
  });
  assert.equal(model.kind, "inComfort");
  assert.equal(model.missingRooms, 3);
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
          iconThresholds: { fire: 30, high: 26, normal: 19, low: 15 },
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
  assert.deepEqual(state.options.scale, { show_comfort_band: true, show_optimal_band: true, footer: true, markers: "extremes" });
  assert.deepEqual(state.options.range_scale, { show_comfort_band: true, show_optimal_band: true, footer: "detailed" });
  assert.deepEqual(state.options.extremes, { show_value: true });
});

test("a configured option overrides its default and the rest keep theirs", () => {
  const state = viewState.buildViewState({
    availability: { hasRange: true, roomsComparable: true, rangeScaleAvailable: true },
    config: { views: [{ type: "scale", enabled: true, options: { markers: "all", footer: false } }] },
  });
  assert.deepEqual(state.options.scale, { show_comfort_band: true, show_optimal_band: true, footer: false, markers: "all" });
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

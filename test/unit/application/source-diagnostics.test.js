"use strict";

// Direct unit tests for application/model/source-diagnostics.js: what the data sources get
// wrong that the configuration alone cannot show. A fault that stays until the configuration or
// the sensor is fixed is a warning naming the entity; a source that is only momentarily out is a
// hint, and only while the card still has a value. Boundary: which sources take part and why one
// is unusable is measurement-context.js's to decide and its tests' to pin; how a diagnostic reads
// is notices.js's (unit/presentation/notices.test.js). This file owns only the step between the
// two. See internal dev doc §4 "Diagnosevertrag".

const test = require("node:test");
const assert = require("node:assert/strict");

let sources;
let core;
let R;

test.before(async () => {
  sources = await import("../../../src/application/model/source-diagnostics.js");
  core = await import("../../../src/core/diagnostics.js");
  ({ UNUSABLE_REASON: R } = await import("../../../src/application/model/entity-model.js"));
});

// A source as the measurement context hands it over: only what the step reads.
const source = (entityId, unusableReason = R.NONE, facts = {}) => ({ entityId, unusableReason, deviceClass: null, rawUnit: null, metricKind: null, ...facts });
const MIXED = { code: "mixed_metric_kinds", metricKinds: ["temperature", "humidity"] };

function collect({ primary = source(null), rooms = [], diagnostics = [], averageSource = { kind: "primary" }, metricType = "temperature", config = {}, states = {}, range = null, trend = null } = {}) {
  return sources.collectSourceDiagnostics({
    context: { primary, rooms, diagnostics, averageSource, metricType },
    config: { range_entity: null, trend_entity: null, ...config },
    states,
    range,
    trend,
  });
}

const auxiliary = (status) => ({ source: { status } });
const warning = (code, entity, params = null) => core.createDiagnostic(code, { entity, params });

test("rooms that measure different things are one warning, and no room is named as the odd one", () => {
  const rooms = [source("sensor.t", R.KIND_MISMATCH), source("sensor.h", R.KIND_MISMATCH)];
  assert.deepEqual(collect({ rooms, diagnostics: [MIXED, { code: "unusable_unit", entityId: "sensor.x" }], averageSource: null }), {
    warnings: [core.createDiagnostic("sources.mixed")],
    hints: [],
  });
});

test("every fault that stays until something is fixed is a warning naming its entity and its cause", () => {
  const { warnings, hints } = collect({
    primary: source("sensor.gone", R.MISSING),
    rooms: [
      source("sensor.air", R.UNIT_AMBIGUOUS, { rawUnit: "ppm" }),
      source("sensor.typo", R.UNKNOWN_DEVICE_CLASS, { deviceClass: "co2", rawUnit: "ppm" }),
      source("sensor.mute", R.UNIDENTIFIED),
      source("sensor.lux", R.UNIT_UNKNOWN, { rawUnit: "lx" }),
      source("sensor.bare", R.UNIT_MISSING, { deviceClass: "temperature", metricKind: "temperature" }),
      source("sensor.odd", R.UNIT_UNREADABLE, { deviceClass: "temperature", rawUnit: "furlongs", metricKind: "temperature" }),
      source("sensor.humid", R.KIND_MISMATCH, { deviceClass: "humidity", rawUnit: "%", metricKind: "humidity" }),
      source("sensor.ok"),
    ],
    averageSource: { kind: "roomConsensus" },
  });
  assert.deepEqual(warnings, [
    warning("entity.not_found", "sensor.gone"),
    warning("entity.unit_ambiguous", "sensor.air", { unit: "ppm" }),
    warning("entity.unknown_device_class", "sensor.typo", { deviceClass: "co2" }),
    warning("entity.unidentified", "sensor.mute"),
    warning("entity.unit_unknown", "sensor.lux", { unit: "lx" }),
    warning("entity.unit_missing", "sensor.bare", { measurement: "temperature" }),
    warning("entity.unit_unreadable", "sensor.odd", { unit: "furlongs", measurement: "temperature" }),
    warning("entity.other_measurement", "sensor.humid", { measurement: "humidity", cardMeasurement: "temperature" }),
  ]);
  assert.deepEqual(hints, [], "a missing main sensor is a configuration fault, not a momentary outage");
});

// Every reason is either a fault someone has to fix or an outage that passes, never both and
// never neither; the no-data line has a sentence for each outage and for nothing else.
test("each way of being unusable is lasting or momentary, exactly once", async () => {
  const { REASON_TEXTS } = await import("../../../src/presentation/view-model/card-view-model.js");
  const lasting = Object.keys(sources.LASTING);
  const momentary = [...sources.MOMENTARY];
  const reasons = Object.values(R).filter((reason) => reason !== R.NONE);
  assert.deepEqual([...lasting, ...momentary].sort(), [...reasons].sort());
  assert.deepEqual(Object.keys(REASON_TEXTS).sort(), [...momentary].sort());
  assert.ok(Object.isFrozen(sources.LASTING) && Object.isFrozen(sources.MOMENTARY));
});

// A battery among disagreeing rooms is its own fault, not one side of their disagreement.
test("a sensor declaring a foreign measurement is named, even beside a mixed state", () => {
  const battery = source("sensor.battery", R.FOREIGN_MEASUREMENT, { deviceClass: "battery", rawUnit: "%" });
  const rooms = [source("sensor.t", R.KIND_MISMATCH), source("sensor.h", R.KIND_MISMATCH), battery];
  assert.deepEqual(collect({ rooms, diagnostics: [MIXED], averageSource: null, metricType: null }), {
    warnings: [core.createDiagnostic("sources.mixed"), warning("entity.foreign_measurement", "sensor.battery", { deviceClass: "battery" })],
    hints: [],
  });
  const { warnings, hints } = collect({ primary: battery, rooms: [source("sensor.a")], averageSource: { kind: "roomConsensus" } });
  assert.deepEqual(warnings, [warning("entity.foreign_measurement", "sensor.battery", { deviceClass: "battery" })]);
  assert.deepEqual(hints, [], "a foreign main sensor is lasting, never a momentary outage");
});

test("a sensor written as main sensor and as a room is named once", () => {
  const { warnings } = collect({ primary: source("sensor.a", R.MISSING), rooms: [source("sensor.a", R.MISSING)], averageSource: null });
  assert.deepEqual(warnings, [warning("entity.not_found", "sensor.a")]);
});

test("without a value, an auxiliary sensor is checked for existence only", () => {
  const { warnings, hints } = collect({
    primary: source("sensor.avg", R.UNAVAILABLE),
    averageSource: null,
    config: { range_entity: "sensor.range", trend_entity: "sensor.trend" },
    states: { "sensor.trend": { state: "unavailable", attributes: {} } },
  });
  assert.deepEqual(warnings, [warning("entity.not_found", "sensor.range")]);
  assert.deepEqual(hints, [], "a card without a value says why in its subtitle, not in hints");
});

test("with a value, an auxiliary sensor is judged by what its model found", () => {
  const config = { range_entity: "sensor.range", trend_entity: "sensor.trend" };
  const states = { "sensor.trend": { state: "1", attributes: { unit_of_measurement: " furlongs/h " } } };
  assert.deepEqual(collect({ config, states, range: auxiliary("missing"), trend: auxiliary("unreadable") }), {
    warnings: [warning("entity.not_found", "sensor.range"), warning("entity.unit_unreadable", "sensor.trend", { unit: "furlongs/h", measurement: "temperature" })],
    hints: [],
  });
  assert.deepEqual(collect({ config, metricType: "humidity", range: auxiliary("unit_missing"), trend: auxiliary("usable") }), {
    warnings: [warning("entity.unit_missing", "sensor.range", { measurement: "humidity" })],
    hints: [],
  });
  assert.deepEqual(collect({ config, range: auxiliary("transient"), trend: auxiliary("transient") }), {
    warnings: [],
    hints: [core.createDiagnostic("hint.range_unavailable", { entity: "sensor.range" }), core.createDiagnostic("hint.trend_unavailable", { entity: "sensor.trend" })],
  });
  assert.deepEqual(collect({ config, range: auxiliary("usable"), trend: auxiliary("usable") }), { warnings: [], hints: [] });
  assert.deepEqual(collect({ range: auxiliary("none"), trend: auxiliary("none") }), { warnings: [], hints: [] });
});

test("rooms that are momentarily out are counted into one hint, while the card has a value", () => {
  const rooms = [source("sensor.a", R.UNAVAILABLE), source("sensor.b", R.NOT_NUMERIC), source("sensor.c", R.OUT_OF_RANGE), source("sensor.d")];
  assert.deepEqual(collect({ rooms }).hints, [core.createDiagnostic("hint.rooms_unavailable", { params: { count: 3 } })]);
  assert.deepEqual(collect({ rooms, averageSource: null }).hints, []);
});

test("a main sensor that is momentarily out while the rooms carry the value is a hint", () => {
  const primary = source("sensor.avg", R.UNAVAILABLE);
  assert.deepEqual(collect({ primary, rooms: [source("sensor.a")], averageSource: { kind: "roomConsensus" } }).hints, [
    core.createDiagnostic("hint.primary_unavailable", { entity: "sensor.avg" }),
  ]);
  assert.deepEqual(collect({ primary, averageSource: null }).hints, [], "without a value the subtitle says it");
});

test("warnings and hints come in one order: mixed state, main sensor, rooms as written, range, trend", () => {
  const { warnings, hints } = collect({
    primary: source("sensor.avg", R.UNAVAILABLE),
    rooms: [source("sensor.b", R.MISSING), source("sensor.a", R.UNAVAILABLE)],
    averageSource: { kind: "roomConsensus" },
    config: { range_entity: "sensor.range", trend_entity: "sensor.trend" },
    range: auxiliary("unreadable"),
    trend: auxiliary("transient"),
  });
  assert.deepEqual(warnings.map((d) => d.entity), ["sensor.b", "sensor.range"]);
  assert.deepEqual(hints.map((d) => d.code), ["hint.primary_unavailable", "hint.rooms_unavailable", "hint.trend_unavailable"]);
});

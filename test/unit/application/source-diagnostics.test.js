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
const source = (entityId, unusableReason = R.NONE) => ({ entityId, unusableReason });
const MIXED = { code: "mixed_metric_kinds", metricKinds: ["temperature", "humidity"] };

function collect({ primary = source(null), rooms = [], diagnostics = [], averageSource = { kind: "primary" }, config = {}, states = {}, range = null, trend = null } = {}) {
  return sources.collectSourceDiagnostics({
    context: { primary, rooms, diagnostics, averageSource },
    config: { range_entity: null, trend_entity: null, ...config },
    states,
    range,
    trend,
  });
}

const auxiliary = (status) => ({ source: { status } });
const warning = (code, entity) => core.createDiagnostic(code, { entity });

test("rooms that measure different things are one warning, and no room is named as the odd one", () => {
  const rooms = [source("sensor.t", R.KIND_MISMATCH), source("sensor.h", R.KIND_MISMATCH)];
  assert.deepEqual(collect({ rooms, diagnostics: [MIXED, { code: "unusable_unit", entityId: "sensor.x" }], averageSource: null }), {
    warnings: [core.createDiagnostic("sources.mixed")],
    hints: [],
  });
});

test("every fault that stays until something is fixed is a warning naming its entity", () => {
  const { warnings, hints } = collect({
    primary: source("sensor.gone", R.MISSING),
    rooms: [
      source("sensor.air", R.UNIT_AMBIGUOUS),
      source("sensor.mute", R.UNIDENTIFIED),
      source("sensor.odd", R.UNIT_UNREADABLE),
      source("sensor.humid", R.KIND_MISMATCH),
      source("sensor.ok"),
    ],
    averageSource: { kind: "roomConsensus" },
  });
  assert.deepEqual(warnings, [
    warning("entity.not_found", "sensor.gone"),
    warning("entity.unit_ambiguous", "sensor.air"),
    warning("entity.unidentified", "sensor.mute"),
    warning("entity.unit_unreadable", "sensor.odd"),
    warning("entity.other_measurement", "sensor.humid"),
  ]);
  assert.deepEqual(hints, [], "a missing main sensor is a configuration fault, not a momentary outage");
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
  assert.deepEqual(collect({ config, range: auxiliary("missing"), trend: auxiliary("unreadable") }), {
    warnings: [warning("entity.not_found", "sensor.range"), warning("entity.unit_unreadable", "sensor.trend")],
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

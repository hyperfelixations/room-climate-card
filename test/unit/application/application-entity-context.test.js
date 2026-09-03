"use strict";

// Direct unit tests for entity parsing and measurement-context resolution: which device
// class or unit names a number's metric kind, its canonical value, whether it is physically
// possible and a measurement at all, and then which of several such answers arbitrates the
// card's kind and which rooms may be averaged in.
// Boundary: this file stops when the participating set is settled; what that set means
// (colours, summary, active views) is application-domain-view.test.js.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { CO2, HUMIDITY, TEMPERATURE, TEMPERATURE_C, TEMPERATURE_F, TEMPERATURE_K } = require("../../fixtures/attributes.js");

let entityModel;
let measurementContext;

const C = TEMPERATURE_C;
const F = TEMPERATURE_F;
const K = TEMPERATURE_K;
const RH = HUMIDITY;

const AUTO_POLICY = { source: "auto", profile: null, custom: null };
function st(state, attributes) {
  return { state: String(state), attributes: attributes || {} };
}

// A normalized-config stand-in: only the fields the pipeline reads.
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
  entityModel = await import("../../../src/application/model/entity-model.js");
  measurementContext = await import("../../../src/application/model/measurement-context.js");
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
  const missing = entityModel.buildEntityModel({ "sensor.a": st(21.5, TEMPERATURE) }, cfg(), "sensor.a", "primary");
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
    entityModel.buildEntityModel({ "sensor.a": st(21, TEMPERATURE) }, config, "sensor.a", "primary").availability,
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
  // A negative concentration is impossible.
  const negative = entityModel.buildEntityModel({ "sensor.a": st(-20, CO2) }, cfg(), "sensor.a", "primary");
  assert.equal(negative.validNumeric, true);
  assert.equal(negative.validPhysical, false);
  // A negative humidity is impossible.
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(-5, RH) }, cfg(), "sensor.a", "primary").validPhysical, false);
  // 120 °F is 48.9 °C — possible; rejected only if the check ran against the raw value.
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(120, F) }, cfg(), "sensor.a", "primary").validPhysical, true);
  // -400 °F is -240 °C, above absolute zero: the limit is converted too.
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(-400, F) }, cfg(), "sensor.a", "primary").validPhysical, true);
  assert.equal(entityModel.buildEntityModel({ "sensor.a": st(-500, F) }, cfg(), "sensor.a", "primary").validPhysical, false);
});

test("validity is checked leniently, so a foreign-kind probe cannot throw", () => {
  // An incidental humidity room is probed for its own kind before the kind filter runs.
  const config = cfg({ classification: { source: "profile", profile: "outdoor", custom: null } });
  assert.doesNotThrow(() => entityModel.buildEntityModel({ "sensor.h": st(55, RH) }, config, "sensor.h", "room"));
});

test("device_class wins over unit, and unit is the fallback", () => {
  const states = {
    "sensor.byClass": st(21, CO2),
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
  // The primary declares nothing (no device_class, no unit), so nobody settles the
  // disagreement — a mixed state, not an arbitrated one.
  const states = {
    "sensor.avg": st("unavailable", {}),
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
    "sensor.avg": st("unavailable", {}),
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

test("an unreadable primary that DECLARES a kind settles a disagreement its rooms cannot", () => {
  // Two thermometers, one hygrometer, and a primary whose state cannot be read. Its
  // `device_class` outlives the outage and says what the card is about; the rooms of that
  // kind carry the value.
  const states = {
    "sensor.avg": st("unavailable", C),
    "sensor.r1": st(21, C),
    "sensor.r2": st(23, C),
    "sensor.h": st(55, RH),
  };
  for (const unusable of ["unavailable", "unknown", "not a number"]) {
    const context = measurementContext.resolveMeasurementContext(
      { ...states, "sensor.avg": st(unusable, C) },
      cfg({ rooms: [room("sensor.r1"), room("sensor.h"), room("sensor.r2")] })
    );
    assert.equal(context.metricKind, "temperature", unusable);
    assert.equal(context.consistent, true, `${unusable}: settled, so nothing is mixed`);
    assert.equal(context.sourceKind, "roomConsensus", unusable);
    assert.equal(context.averageSource.canonicalValue, 22, unusable);
    assert.deepEqual(context.participatingRooms.map((r) => r.entityId), ["sensor.r1", "sensor.r2"], unusable);
    // The foreign room is excluded by name in configuration order, not swept into a
    // card-wide "mixed" verdict.
    assert.deepEqual(context.diagnostics, [
      { code: "excluded_foreign_metric_kind", entityId: "sensor.h", metricKind: "humidity" },
    ], unusable);
  }
});

test("a declaration with no room of its own kind leaves the card its kind and no value", () => {
  // The rooms are usable and simply not what this card measures — the same answer a readable
  // primary gives. Only the value depends on availability.
  const context = measurementContext.resolveMeasurementContext(
    { "sensor.avg": st("unavailable", C), "sensor.h": st(55, RH) },
    cfg({ rooms: [room("sensor.h")] })
  );
  assert.equal(context.metricKind, "temperature");
  assert.equal(context.averageSource, null);
  assert.equal(context.consistent, true);
  assert.equal(context.sourceKind, "primary");
  assert.equal(context.rooms[0].availability, "incompatible_kind");
});

test("an entity Home Assistant does not know declares nothing, so the rooms still decide", () => {
  // An id absent from hass.states is a property of the configuration, with nothing there to
  // arbitrate with — unlike an outage.
  const context = measurementContext.resolveMeasurementContext(
    { "sensor.r1": st(21, C), "sensor.h": st(55, RH) },
    cfg({ entity: "sensor.nowhere", rooms: [room("sensor.r1"), room("sensor.h")] })
  );
  assert.equal(context.metricKind, null);
  assert.equal(context.consistent, false);
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
});

test("compatible mixed units are averaged canonically", () => {
  // 70 °F is 21.111 °C; the mean with 22 °C is 21.556 °C, not the mean of 70 and 22.
  const states = { "sensor.avg": st("unavailable", C), "sensor.f": st(70, F), "sensor.c": st(22, C) };
  const context = measurementContext.resolveMeasurementContext(states, cfg({ rooms: [room("sensor.f"), room("sensor.c")] }));
  const expected = (((70 - 32) * 5) / 9 + 22) / 2;
  assert.ok(Math.abs(context.averageSource.canonicalValue - expected) < 1e-9, `got ${context.averageSource.canonicalValue}`);
});

test("the consensus is the mean, whether or not its inputs can be added first", () => {
  // Two roads to one answer: the ordinary road sums and divides and must keep producing the
  // exact double it always did; the other exists because the sum can overflow while the mean
  // stays finite.
  const meanOf = (rooms) => {
    const states = Object.fromEntries(rooms.map((value, index) => [`sensor.r${index}`, st(value, C)]));
    const config = cfg({ entity: null, rooms: rooms.map((_, index) => room(`sensor.r${index}`)) });
    return measurementContext.resolveMeasurementContext(states, config).averageSource.canonicalValue;
  };

  // Bit-for-bit what summing gives, on values chosen because their mean is not exact.
  for (const rooms of [[21, 23], [19.2, 20.8, 21.6, 22.3], [0.1, 0.2]]) {
    const summed = rooms.reduce((total, value) => total + value, 0) / rooms.length;
    assert.equal(meanOf(rooms), summed, rooms.join("/"));
  }

  // And where the sum overflows to Infinity or to NaN, the mean is still the mean.
  assert.equal(meanOf([1e308, 1e308]), 1e308);
  assert.equal(meanOf([1e308, 1e308, 1e308]), 1e308);
  assert.equal(meanOf([1e308, -273.15]), (1e308 + -273.15) / 2);
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


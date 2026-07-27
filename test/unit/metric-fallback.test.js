"use strict";

// DATA-04 (v2.15.0 audit): if the primary average entity is missing/unknown
// (no device_class, no unit_of_measurement), _metricType() must fall back to
// a configured room that DOES carry a recognizable device_class/unit instead
// of defaulting straight to temperature — otherwise mode/unit/comfort bounds
// would silently be wrong even though a valid room-fallback average is
// computed.
//
// DATA-01 (v2.16.0 audit): metricType and unit must always come from the
// SAME entity (_resolveMetricContext(), see room-climate-card.js) — a
// primary entity with no device_class but a stray unit_of_measurement could
// previously leave _unit() reading that stray unit even after _metricType()
// fell back to a room's device_class, e.g. "50.0 hPa" with humidity comfort
// bounds.
//
// AP-02 (v2.17.0 consolidated audit, sections 4.1-4.3/5-8): _resolveMetricContext()
// was rebuilt around EntityModel/MeasurementContext (see room-climate-card.js).
// The previous MAJORITY-VOTE heuristic across room device_classes has been
// REMOVED entirely — a genuine disagreement between rooms' own metric kinds
// (with no usable primary to arbitrate) now produces a "mixed_metric_kinds"
// diagnostic and an empty/error state, never a "winning" type chosen by
// count. This directly fixes DATA-01..DATA-04 from the new audit, whose
// shared root cause was exactly this kind of silent/independent resolution
// (see the DATA-01..04 reproduction tests below). Physical validity
// (_isPhysicallyValid()) and numeric availability (validNumeric) are now
// checked BEFORE a primary or room may participate in metric-kind
// resolution or averaging at all — an unavailable room or a physically
// implausible primary (e.g. 0 ppm CO2) can no longer "win" a decision it
// has no valid data for.

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

test("missing primary entity + valid humidity rooms -> metricType/comfort bounds resolve to humidity, not temperature", () => {
  const hass = mkHass({
    "sensor.hum1": mkState("sensor.hum1", 55, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.hum2": mkState("sensor.hum2", 60, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.does_not_exist", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const data = el._computeData();
  assert.equal(data.metricType, "humidity");
  assert.equal(data.comfortMin, 40);
  assert.equal(data.comfortMax, 60);
  env.cleanup(el);
});

test("primary entity exists but carries neither device_class nor unit -> falls back to a room", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}), // exists, but no device_class/unit at all
    "sensor.co2a": mkState("sensor.co2a", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.co2b": mkState("sensor.co2b", 720, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.co2b" }] }, hass);
  const data = el._computeData();
  assert.equal(data.metricType, "co2");
  env.cleanup(el);
});

test("primary entity's own device_class always wins over any room fallback", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }),
    "sensor.hum1": mkState("sensor.hum1", 55, { device_class: "humidity" }),
    "sensor.hum2": mkState("sensor.hum2", 60, { device_class: "humidity" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const data = el._computeData();
  assert.equal(data.metricType, "temperature", "primary entity's device_class must not be overridden by rooms");
  env.cleanup(el);
});

test("no metric type resolvable anywhere -> falls back to temperature as the final default", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeData();
  assert.equal(data.metricType, "temperature");
  env.cleanup(el);
});

test("primary entity falls back via unit_of_measurement when device_class is absent", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 55, { unit_of_measurement: "%" }), // no device_class
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeData();
  assert.equal(data.metricType, "humidity");
  env.cleanup(el);
});

test("Fahrenheit unit without device_class resolves to temperature (unit fallback table); internally canonicalized to Celsius (AP-02), displayed natively in °F (AP-03)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 72, { unit_of_measurement: "°F" }),
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.averageSource.unitProfile, "fahrenheit");
  assert.ok(
    Math.abs(context.averageSource.canonicalValue - 200 / 9) < 1e-9,
    "72°F must canonicalize to (72-32)*5/9 ≈ 22.22°C internally, not pass through raw"
  );
  // AP-03 (native Fahrenheit display, see test/unit/native-fahrenheit.test.js
  // for the full suite): _computeData() projects the canonical value back
  // into the resolved display unit — °F here, since the usable primary
  // itself reports °F — so data.avg reads 72 again, not the canonical
  // 22.22, and comfort bounds are the generated integer Fahrenheit ones
  // (68-75), not Celsius (20-24). This is the correctness fix for audit
  // 9.1: a raw 72 misclassified against a 20-24 "Celsius" comfort band no
  // longer happens, because the comparison now happens entirely in °F.
  const data = el._computeData();
  assert.equal(data.metricType, "temperature");
  assert.equal(el._unit(), "°F");
  assert.ok(Math.abs(data.avg - 72) < 1e-9, "data.avg must display natively as 72°F, not the internal canonical 22.22");
  assert.equal(data.comfortMin, 68);
  assert.equal(data.comfortMax, 75);
  assert.ok(data.avg >= data.comfortMin && data.avg <= data.comfortMax, "72°F correctly falls inside the 68-75°F comfort band");
  env.cleanup(el);
});

test("mixed room device_classes (1 vs 1 tie): no primary, no majority winner -> mixed_metric_kinds, never a chosen type", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.hum1": mkState("sensor.hum1", 55, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, null, "AP-02: no majority selection between genuinely disagreeing rooms");
  assert.equal(context.consistent, false);
  assert.equal(context.averageSource, null);
  assert.equal(context.diagnostics.length, 1);
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  assert.deepEqual(new Set(context.diagnostics[0].metricKinds), new Set(["co2", "humidity"]));
  const data = el._computeData();
  assert.equal(data.empty, true, "no coherent single average can be computed across incompatible metric kinds");
  assert.equal(data.configurationState, "mixed_metric_kinds");
  env.cleanup(el);
});

test("mixed room device_classes (one kind outnumbers the other): still no majority winner -> mixed_metric_kinds", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.hum1": mkState("sensor.hum1", 40, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.t1": mkState("sensor.t1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t3": mkState("sensor.t3", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  // AP-02: 3 temperature rooms outnumbering 1 humidity room must NOT decide
  // a winner by count — averaging temperature and humidity together (or
  // silently dropping the humidity room without saying so) is exactly the
  // DATA-03 bug this policy removes.
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.t3" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, null, "AP-02: room count must never decide between disagreeing metric kinds");
  assert.equal(context.consistent, false);
  assert.equal(context.averageSource, null);
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  assert.deepEqual(new Set(context.diagnostics[0].metricKinds), new Set(["humidity", "temperature"]));
  const data = el._computeData();
  assert.equal(data.empty, true);
  assert.equal(data.configurationState, "mixed_metric_kinds");
  env.cleanup(el);
});

test("consistent room device_classes: consistent:true, no disagreement flagged", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.consistent, true);
  env.cleanup(el);
});

test("v2.16.0 DATA-01: metricType and unit are read from the SAME entity, never mixed — primary entity with a stray unit falls back entirely to the room's unit once metricType falls back to that room", () => {
  const hass = mkHass({
    // Primary entity has no device_class and a stray/irrelevant unit
    // (simulating a misconfigured or leftover entity) but no numeric value.
    "sensor.avg": mkState("sensor.avg", "unavailable", { unit_of_measurement: "hPa" }),
    "sensor.hum1": mkState("sensor.hum1", 55, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.hum2": mkState("sensor.hum2", 60, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity");
  assert.equal(context.unit, "%", "unit must follow the room source, never the stray primary-entity unit once metricType itself fell back to a room");
  assert.equal(context.sourceKind, "roomConsensus");
  const data = el._computeData();
  assert.equal(data.comfortMin, 40, "comfort bounds must be humidity's, not derived from the stray hPa unit");
  env.cleanup(el);
});

// ==== AP-02: DATA-01..04 (v2.17.0 consolidated audit) reproduction cases ====
// Each of these is the audit's own counterexample, verbatim. All four share
// one root cause (three independently-resolving code paths in the old
// _computeData()/_resolveMetricContext(); see room-climate-card.js) and are
// fixed together by the atomic MeasurementContext pipeline, not as four
// isolated hotfixes — per the acceptance criterion, none of them may ever
// again produce a value like "55 ppm" or "1013 °C".

test("DATA-01: a physically invalid primary (0 ppm CO2) must not be usable — falls back to the valid humidity rooms, never displays a humidity average with a co2/ppm label", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 0, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }), // 0 ppm: invalidWhen(value <= 0)
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.hum2": mkState("sensor.hum2", 60, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity", "a physically invalid primary reading must not be usable, regardless of its own device_class");
  assert.equal(context.sourceKind, "roomConsensus");
  const data = el._computeData();
  assert.equal(data.metricType, "humidity");
  assert.equal(data.avg, 55);
  env.cleanup(el);
});

test("DATA-02: unavailable rooms must not participate in metric-kind consensus — two unavailable temperature rooms cannot outvote one truly available humidity room", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", "unavailable", { device_class: "temperature" }),
    "sensor.t2": mkState("sensor.t2", "unavailable", { device_class: "temperature" }),
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.hum1" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity", "unavailable temperature rooms must not count toward consensus at all");
  const data = el._computeData();
  assert.equal(data.metricType, "humidity");
  assert.equal(data.avg, 50, "average must come from the single genuinely available humidity room, never 50°C");
  env.cleanup(el);
});

test("DATA-03: a temperature room and a humidity room must never be averaged together — no usable primary + disagreeing rooms yields a defined error state, not 36", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.hum1" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, null);
  assert.equal(context.averageSource, null, "22°C and 50% must never be blended into a single number");
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  const data = el._computeData();
  assert.equal(data.empty, true);
  assert.notEqual(data.avg, 36, "the old raw cross-metric average must never appear");
  env.cleanup(el);
});

test("DATA-04: an unrecognized-unit primary (1013 hPa) must not be usable — falls back to the valid temperature rooms, never displays 1013 as a temperature", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 1013, { unit_of_measurement: "hPa" }), // no device_class, "hpa" not in METRIC_TYPE_BY_UNIT
    "sensor.t1": mkState("sensor.t1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.sourceKind, "roomConsensus", "the unrecognized-unit primary must not be treated as a usable source at all");
  const data = el._computeData();
  assert.equal(data.metricType, "temperature");
  assert.equal(data.avg, 22, "average must come from the room fallback, never the unrecognized 1013 hPa reading");
  assert.notEqual(data.avg, 1013);
  env.cleanup(el);
});

// ==== Review fix (post-AP-01..03): device_class alone must not exempt an
// entity from unit validation — the OLD `_buildEntityModel()` silently
// treated ANY unresolvable unit as canonical once metricKind was already
// resolved via device_class, letting exactly the DATA-04 bug back in
// through a different door: `device_class: temperature` + a stray `hPa`
// unit resolved metricKind="temperature" via device_class alone, and the
// unit-resolution fallback (`_resolveUnitProfileKey(...) || canonicalProfileKey`)
// then silently treated 1013 as already being in Celsius. Fixed by removing
// the canonical fallback entirely: an entity whose device_class resolves a
// metric kind but whose unit does NOT match any of that kind's registered
// UnitProfiles is now `validUnit: false` and excluded from
// primaryUsable/room-consensus, exactly like a physically-invalid reading. ====

test("review fix: device_class:temperature + an unresolvable unit (hPa) must NOT be usable — never displays 1013 as a temperature", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 1013, { device_class: "temperature", unit_of_measurement: "hPa" }),
    "sensor.t1": mkState("sensor.t1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.sourceKind, "roomConsensus", "device_class alone must not make an unresolvable-unit primary usable");
  const data = el._computeData();
  assert.equal(data.metricType, "temperature");
  assert.equal(data.avg, 22, "average must come from the room fallback, never the unresolvable 1013 hPa reading");
  assert.notEqual(data.avg, 1013);
  env.cleanup(el);
});

test("review fix: a room with device_class:temperature but an unresolvable unit is excluded and diagnosed as unusable_unit, not silently dropped or averaged in", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.bad": mkState("sensor.bad", 1013, { device_class: "temperature", unit_of_measurement: "hPa" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.bad" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.averageSource.canonicalValue, 20, "the unresolvable-unit room must not be averaged in with sensor.t1");
  assert.ok(
    context.diagnostics.some((d) => d.code === "unusable_unit" && d.entityId === "sensor.bad"),
    "the excluded room must be diagnosed as unusable_unit, not silently dropped"
  );
  const data = el._computeData();
  assert.equal(data.roomCount, 1, "only sensor.t1 participates");
  assert.ok(!data.rooms.some((r) => r.entity === "sensor.bad"));
  env.cleanup(el);
});

test("review fix: a usable primary with device_class:temperature and an unresolvable-unit room still excludes that room (validUnit gates participation even when metricKind matches)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.bad": mkState("sensor.bad", 1013, { device_class: "temperature", unit_of_measurement: "hPa" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.bad" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.sourceKind, "primary");
  assert.equal(context.participatingRooms.length, 0, "the unresolvable-unit room must not participate even though its metricKind matches the primary");
  assert.ok(
    context.diagnostics.some((d) => d.code === "unusable_unit" && d.entityId === "sensor.bad"),
    "must be diagnosed as unusable_unit even when excluded from the primaryUsable branch, not the roomConsensus branch"
  );
  env.cleanup(el);
});

test("review fix (P0, post-2.21.1): a primary with device_class:temperature but a COMPLETELY MISSING unit_of_measurement is unusable — no more canonical fallback, falls back to room consensus", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }), // no unit_of_measurement at all
    "sensor.t1": mkState("sensor.t1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.sourceKind, "roomConsensus", "a missing unit must be treated exactly like an unresolvable one — the primary must not win primaryUsable");
  const primaryModel = el._buildEntityModel("sensor.avg", "primary");
  assert.equal(primaryModel.validUnit, false);
  assert.equal(primaryModel.unitProfile, null, "no silent canonical assumption for a missing unit");
  assert.equal(primaryModel.metricKind, "temperature", "metricKind stays resolved via device_class even though the reading itself is unusable, so empty-state title/icon fallbacks remain sensible");
  const data = el._computeData();
  assert.equal(data.avg, 22, "the room-consensus average (20/24 -> 22), never a value derived from the unusable primary reading");
  env.cleanup(el);
});

test("review fix (P0, post-2.21.1): a room with device_class:temperature but a COMPLETELY MISSING unit is excluded and diagnosed as unusable_unit, even as the sole candidate", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.bad": mkState("sensor.bad", 21, { device_class: "temperature" }), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.bad" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.averageSource, null, "the sole candidate room has no usable unit, so there is no usable average source at all");
  assert.ok(
    context.diagnostics.some((d) => d.code === "unusable_unit" && d.entityId === "sensor.bad"),
    "must be diagnosed, not silently dropped, even though it's the only candidate"
  );
  const data = el._computeData();
  assert.equal(data.empty, true, "no usable measurement anywhere -> empty state, never a value derived from the unit-less room");
  assert.equal(data.metricType, "temperature", "title/icon must still be temperature-appropriate via the room's own resolved (but untrusted) metricKind, not the generic default");
  env.cleanup(el);
});

test("review fix (P0, post-2.21.1): when every configured entity lacks a unit, the empty state still shows a metric-kind-appropriate title/icon (metricKind resolution is independent of validUnit)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 55, { device_class: "humidity" }), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeData();
  assert.equal(data.empty, true);
  assert.equal(data.metricType, "humidity", "device_class alone still drives the empty-state title/icon, even though the reading itself is unusable");
  env.cleanup(el);
});

test("AP-02: a usable primary excludes type-foreign rooms from averaging/extrema/comfort, diagnosed but not silently dropped", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t1": mkState("sensor.t1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.hum1": mkState("sensor.hum1", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.hum1" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.sourceKind, "primary");
  assert.deepEqual(
    new Set(context.participatingRooms.map((r) => r.entityId)),
    new Set(["sensor.t1", "sensor.t2"])
  );
  assert.deepEqual(normalize(context.excludedRoomIds), ["sensor.hum1"]);
  assert.ok(
    context.diagnostics.some((d) => d.code === "excluded_foreign_metric_kind" && d.entityId === "sensor.hum1"),
    "the excluded humidity room must be diagnosed, not just silently dropped"
  );
  const data = el._computeData();
  assert.equal(data.roomCount, 2, "only the two temperature rooms participate — the humidity room is neither averaged nor rendered as a chip");
  assert.ok(!data.rooms.some((r) => r.entity === "sensor.hum1"));
  env.cleanup(el);
});

test("AP-02: room-consensus averaging canonicalizes mixed units of the SAME metric kind before aggregating (no primary)", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.t2": mkState("sensor.t2", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
    // 71.6°F === 22°C exactly: (71.6-32)*5/9 = 22
    "sensor.t3": mkState("sensor.t3", 71.6, { device_class: "temperature", unit_of_measurement: "°F" }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.t3" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.consistent, true, "a shared metric kind across differing but compatible units is not a misconfiguration");
  const data = el._computeData();
  assert.ok(
    Math.abs(data.avg - 22) < 1e-9,
    "the °F room must be canonicalized to 22°C before averaging with the two °C rooms — a raw (20+24+71.6)/3 would be physically meaningless"
  );
  env.cleanup(el);
});

test("AP-02: the mixed_metric_kinds console.warn is deduplicated across hass updates but re-fires when the diagnosis actually changes", () => {
  // Starts with a benign config (no rooms yet, so no mixed diagnosis is
  // possible at construction time) so the warn spy can be installed BEFORE
  // the mixed-kind state is ever resolved for the first time.
  const initialHass = mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", {}) });
  const el = env.createCard({ entity: "sensor.avg" }, initialHass);
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  const hassA = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 700, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.hum1": mkState("sensor.hum1", 55, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  el.hass = hassA;
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }] });
  assert.equal(warnings.length, 1, "the first resolution of a mixed-kind state must warn once");

  // A new hass object (HA reassigns one on every real update) with the SAME
  // underlying misconfiguration must not re-warn.
  const hassB = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 705, { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.hum1": mkState("sensor.hum1", 56, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  el.hass = hassB;
  assert.equal(warnings.length, 1, "an unchanged mixed_metric_kinds diagnosis must not spam the console on every hass update");

  // A config/hass change where the diagnosis genuinely changes (different
  // pair of disagreeing kinds) must warn again.
  const hassC = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", "unavailable", { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.hum1": mkState("sensor.hum1", 56, { device_class: "humidity", unit_of_measurement: "%" }),
    "sensor.t1": mkState("sensor.t1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  el.hass = hassC;
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }, { entity: "sensor.t1" }] });
  assert.equal(warnings.length, 2, "a genuinely changed diagnosis (co2/humidity -> humidity/temperature) must warn again");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("_resolveMetricContext() is memoized per hass/config identity, like _language()", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const first = el._resolveMetricContext();
  const second = el._resolveMetricContext();
  assert.equal(first, second, "same hass/config identity must return the cached object, not recompute");

  const hass2 = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "humidity" }) });
  el.hass = hass2;
  const third = el._resolveMetricContext();
  assert.notEqual(first, third, "a new hass object must invalidate the cache");
  assert.equal(third.metricType, "humidity");
  env.cleanup(el);
});

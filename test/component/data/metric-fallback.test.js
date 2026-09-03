"use strict";

// Metric-kind fallback when the primary average entity says nothing (missing, or no
// device_class and no unit): resolution falls back to a configured room that carries a
// recognizable device_class/unit rather than defaulting to temperature. Kind, value and
// unit always come from the same entity, so a humidity average is never labelled hPa.
// Rooms that genuinely disagree with no usable primary produce a "mixed_metric_kinds"
// diagnostic and an empty state, never a winner chosen by count; physical validity and
// numeric availability are checked before any entity may participate.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { CO2, HUMIDITY, HUMIDITY_CLASS_ONLY, TEMPERATURE, TEMPERATURE_C, TEMPERATURE_F } = require("../../fixtures/attributes.js");

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

test("missing primary entity + valid humidity rooms -> metricType/comfort bounds resolve to humidity, not temperature", () => {
  const hass = mkHass({
    "sensor.hum1": mkState("sensor.hum1", 55, HUMIDITY),
    "sensor.hum2": mkState("sensor.hum2", 60, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.does_not_exist", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "humidity");
  assert.equal(data.comfort.min, 40);
  assert.equal(data.comfort.max, 60);
  env.cleanup(el);
});

test("primary entity exists but carries neither device_class nor unit -> falls back to a room", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}), // exists, but no device_class/unit at all
    "sensor.co2a": mkState("sensor.co2a", 700, CO2),
    "sensor.co2b": mkState("sensor.co2b", 720, CO2),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.co2b" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "co2");
  env.cleanup(el);
});

test("primary entity's own device_class always wins over any room fallback", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE),
    "sensor.hum1": mkState("sensor.hum1", 55, HUMIDITY_CLASS_ONLY),
    "sensor.hum2": mkState("sensor.hum2", 60, HUMIDITY_CLASS_ONLY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "temperature", "primary entity's device_class must not be overridden by rooms");
  env.cleanup(el);
});

test("no metric type resolvable anywhere -> keeps a null kind and uses the product title", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, null);
  assert.equal(data.title, "Room Climate Card");
  env.cleanup(el);
});

test("primary entity falls back via unit_of_measurement when device_class is absent", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 55, { unit_of_measurement: "%" }), // no device_class
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "humidity");
  env.cleanup(el);
});

test("Fahrenheit without device_class resolves to temperature, canonicalizes to Celsius, and displays in °F", () => {
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
  // Native °F display (full suite: native-fahrenheit.test.js): the view model projects the
  // canonical value back into the resolved unit, so data.average.value reads 72 and comfort
  // bounds are the generated °F integers (68-75), not Celsius.
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "temperature");
  assert.equal(el._unit(), "°F");
  assert.ok(Math.abs(data.average.value - 72) < 1e-9, "data.average.value must display natively as 72°F, not the internal canonical 22.22");
  assert.equal(data.comfort.min, 68);
  assert.equal(data.comfort.max, 75);
  assert.ok(data.average.value >= data.comfort.min && data.average.value <= data.comfort.max, "72°F correctly falls inside the 68-75°F comfort band");
  env.cleanup(el);
});

test("mixed room device_classes (1 vs 1 tie): no primary, no majority winner -> mixed_metric_kinds, never a chosen type", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 700, CO2),
    "sensor.hum1": mkState("sensor.hum1", 55, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, null, "AP-02: no majority selection between genuinely disagreeing rooms");
  assert.equal(context.consistent, false);
  assert.equal(context.averageSource, null);
  assert.equal(context.diagnostics.length, 1);
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  assert.deepEqual(new Set(context.diagnostics[0].metricKinds), new Set(["co2", "humidity"]));
  const data = el._computeViewModel();
  assert.equal(data.empty, true, "no coherent single average can be computed across incompatible metric kinds");
  assert.equal(data.configurationState, "mixed_metric_kinds");
  env.cleanup(el);
});

test("mixed room device_classes (one kind outnumbers the other): still no majority winner -> mixed_metric_kinds", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.hum1": mkState("sensor.hum1", 40, HUMIDITY),
    "sensor.t1": mkState("sensor.t1", 21, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 22, TEMPERATURE_C),
    "sensor.t3": mkState("sensor.t3", 23, TEMPERATURE_C),
  });
  // Three temperature rooms outnumbering one humidity room must not pick a winner by count
  // — blending them, or silently dropping the humidity room, is the DATA-03 bug this removes.
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
  const data = el._computeViewModel();
  assert.equal(data.empty, true);
  assert.equal(data.configurationState, "mixed_metric_kinds");
  env.cleanup(el);
});

test("consistent room device_classes: consistent:true, no disagreement flagged", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 21, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 22, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.consistent, true);
  env.cleanup(el);
});

test("metricType and unit resolve together when the primary carries a stray unit", () => {
  const hass = mkHass({
    // No device_class, a stray hPa unit, and no numeric value.
    "sensor.avg": mkState("sensor.avg", "unavailable", { unit_of_measurement: "hPa" }),
    "sensor.hum1": mkState("sensor.hum1", 55, HUMIDITY),
    "sensor.hum2": mkState("sensor.hum2", 60, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity");
  assert.equal(context.unit, "%", "unit must follow the room source, never the stray primary-entity unit once metricType itself fell back to a room");
  assert.equal(context.sourceKind, "roomConsensus");
  const data = el._computeViewModel();
  assert.equal(data.comfort.min, 40, "comfort bounds must be humidity's, not derived from the stray hPa unit");
  env.cleanup(el);
});

// ==== Measurement-context consistency cases ====
// Shared invariant: metric kind, value and unit resolve atomically — never "55 ppm" or "1013 °C".

test("an unusable CO2 primary keeps the card a CO2 card, and humidity rooms stay foreign", () => {
  // Reading unusable (supplies no value), but the declaration still says CO2 card, so a
  // humidity room stays as foreign as it would be with a fine reading.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", -20, CO2), // a negative concentration is impossible
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
    "sensor.hum2": mkState("sensor.hum2", 60, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "co2");
  assert.equal(context.averageSource, null, "no CO2 source can be read");
  assert.deepEqual([...context.excludedRoomIds], ["sensor.hum1", "sensor.hum2"]);
  const data = el._computeViewModel();
  assert.equal(data.empty, true, "60 % must never be shown as the value of a CO2 card");
  env.cleanup(el);
});

test("an unusable primary that declares nothing lets valid rooms take over", () => {
  // The other half: with no device_class and no unit the primary says nothing, so rooms decide.
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
    "sensor.hum2": mkState("sensor.hum2", 60, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.hum1" }, { entity: "sensor.hum2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity");
  assert.equal(context.sourceKind, "roomConsensus");
  assert.equal(el._computeViewModel().average.value, 55);
  env.cleanup(el);
});

test("unavailable rooms do not participate in metric-kind consensus", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", "unavailable", TEMPERATURE),
    "sensor.t2": mkState("sensor.t2", "unavailable", TEMPERATURE),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.hum1" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "humidity", "unavailable temperature rooms must not count toward consensus at all");
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "humidity");
  assert.equal(data.average.value, 50, "average must come from the single genuinely available humidity room, never 50°C");
  env.cleanup(el);
});

test("rooms of different metric kinds are never averaged together", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 22, TEMPERATURE_C),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.hum1" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, null);
  assert.equal(context.averageSource, null, "22°C and 50% must never be blended into a single number");
  assert.equal(context.diagnostics[0].code, "mixed_metric_kinds");
  const data = el._computeViewModel();
  assert.equal(data.empty, true);
  assert.equal(data.average.value, null, "the normal no-data shell carries no numeric value");
  assert.equal(data.average.valueText, "--", "the old raw cross-metric average must never appear");
  assert.equal(data.configurationState, "mixed_metric_kinds");
  env.cleanup(el);
});

test("an unrecognized-unit primary falls back without displaying hPa as temperature", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 1013, { unit_of_measurement: "hPa" }), // no device_class, "hpa" not in METRIC_TYPE_BY_UNIT
    "sensor.t1": mkState("sensor.t1", 21, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 23, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.sourceKind, "roomConsensus", "the unrecognized-unit primary must not be treated as a usable source at all");
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "temperature");
  assert.equal(data.average.value, 22, "average must come from the room fallback, never the unrecognized 1013 hPa reading");
  assert.notEqual(data.average.value, 1013);
  env.cleanup(el);
});

// ==== device_class does not exempt an entity from unit validation ====
// A resolved metric kind whose unit matches no registered UnitProfile is validUnit: false
// and excluded from primaryUsable/room-consensus, like a physically invalid reading.

test("device_class temperature with an unresolvable hPa unit is unusable", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 1013, { device_class: "temperature", unit_of_measurement: "hPa" }),
    "sensor.t1": mkState("sensor.t1", 21, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 23, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.sourceKind, "roomConsensus", "device_class alone must not make an unresolvable-unit primary usable");
  const data = el._computeViewModel();
  assert.equal(data.metric.kind, "temperature");
  assert.equal(data.average.value, 22, "average must come from the room fallback, never the unresolvable 1013 hPa reading");
  assert.notEqual(data.average.value, 1013);
  env.cleanup(el);
});

test("a temperature room with an unresolvable unit is excluded and diagnosed", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 20, TEMPERATURE_C),
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
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 1, "only sensor.t1 participates");
  assert.ok(!data.rooms.visible.some((r) => r.entity === "sensor.bad"));
  env.cleanup(el);
});

test("a usable temperature primary still excludes a same-kind room with an invalid unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
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

test("a temperature primary without a unit is unusable and falls back to room consensus", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE), // no unit_of_measurement at all
    "sensor.t1": mkState("sensor.t1", 20, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 24, TEMPERATURE_C),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.sourceKind, "roomConsensus", "a missing unit must be treated exactly like an unresolvable one — the primary must not win primaryUsable");
  const primaryModel = internals.entityModel(el, "sensor.avg", "primary");
  assert.equal(primaryModel.validUnit, false);
  assert.equal(primaryModel.unitProfile, null, "no silent canonical assumption for a missing unit");
  assert.equal(primaryModel.metricKind, "temperature", "metricKind stays resolved via device_class even though the reading itself is unusable, so no-data title/icon fallbacks remain sensible");
  const data = el._computeViewModel();
  assert.equal(data.average.value, 22, "the room-consensus average (20/24 -> 22), never a value derived from the unusable primary reading");
  env.cleanup(el);
});

test("a temperature room without a unit is excluded as unusable_unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.bad": mkState("sensor.bad", 21, TEMPERATURE), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.bad" }] }, hass);
  const context = el._resolveMetricContext();
  assert.equal(context.averageSource, null, "the sole candidate room has no usable unit, so there is no usable average source at all");
  assert.ok(
    context.diagnostics.some((d) => d.code === "unusable_unit" && d.entityId === "sensor.bad"),
    "must be diagnosed, not silently dropped, even though it's the only candidate"
  );
  const data = el._computeViewModel();
  assert.equal(data.empty, true, "no usable measurement anywhere -> no-data state, never a value derived from the unit-less room");
  assert.equal(data.metric.kind, "temperature", "title/icon must still be temperature-appropriate via the room's own resolved (but untrusted) metricKind, not the generic default");
  env.cleanup(el);
});

test("a no-data state retains metric-specific presentation when every entity lacks a unit", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 55, HUMIDITY_CLASS_ONLY), // no unit_of_measurement
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const data = el._computeViewModel();
  assert.equal(data.empty, true);
  assert.equal(data.metric.kind, "humidity", "device_class alone still drives the no-data title/icon, even though the reading itself is unusable");
  env.cleanup(el);
});

test("a usable primary excludes and diagnoses type-foreign rooms", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.t1": mkState("sensor.t1", 20, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 24, TEMPERATURE_C),
    "sensor.hum1": mkState("sensor.hum1", 50, HUMIDITY),
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
  const data = el._computeViewModel();
  assert.equal(data.rooms.count, 2, "only the two temperature rooms participate — the humidity room is neither averaged nor rendered as a chip");
  assert.ok(!data.rooms.visible.some((r) => r.entity === "sensor.hum1"));
  env.cleanup(el);
});

test("room consensus canonicalizes mixed units of the same metric before aggregation", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.t1": mkState("sensor.t1", 20, TEMPERATURE_C),
    "sensor.t2": mkState("sensor.t2", 24, TEMPERATURE_C),
    // 71.6°F === 22°C exactly: (71.6-32)*5/9 = 22
    "sensor.t3": mkState("sensor.t3", 71.6, TEMPERATURE_F),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.t1" }, { entity: "sensor.t2" }, { entity: "sensor.t3" }] },
    hass
  );
  const context = el._resolveMetricContext();
  assert.equal(context.metricType, "temperature");
  assert.equal(context.consistent, true, "a shared metric kind across differing but compatible units is not a misconfiguration");
  const data = el._computeViewModel();
  assert.ok(
    Math.abs(data.average.value - 22) < 1e-9,
    "the °F room must be canonicalized to 22°C before averaging with the two °C rooms — a raw (20+24+71.6)/3 would be physically meaningless"
  );
  env.cleanup(el);
});

test("mixed_metric_kinds warnings deduplicate until the diagnosis changes", () => {
  // Benign start (no rooms, so no mixed diagnosis yet) lets the warn spy install before the
  // mixed-kind state is first resolved.
  const initialHass = mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", {}) });
  const el = env.createCard({ entity: "sensor.avg" }, initialHass);
  const warnings = [];
  const originalWarn = el.ownerDocument.defaultView.console.warn;
  el.ownerDocument.defaultView.console.warn = (...args) => warnings.push(args.join(" "));

  const hassA = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 700, CO2),
    "sensor.hum1": mkState("sensor.hum1", 55, HUMIDITY),
  });
  el.hass = hassA;
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }] });
  assert.equal(warnings.length, 1, "the first resolution of a mixed-kind state must warn once");

  // A new hass object (HA makes one per update) with the same misconfiguration must not re-warn.
  const hassB = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", 705, CO2),
    "sensor.hum1": mkState("sensor.hum1", 56, HUMIDITY),
  });
  el.hass = hassB;
  assert.equal(warnings.length, 1, "an unchanged mixed_metric_kinds diagnosis must not spam the console on every hass update");

  // A genuinely changed diagnosis (different disagreeing pair) must warn again.
  const hassC = mkHass({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.co2a": mkState("sensor.co2a", "unavailable", CO2),
    "sensor.hum1": mkState("sensor.hum1", 56, HUMIDITY),
    "sensor.t1": mkState("sensor.t1", 21, TEMPERATURE_C),
  });
  el.hass = hassC;
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.co2a" }, { entity: "sensor.hum1" }, { entity: "sensor.t1" }] });
  assert.equal(warnings.length, 2, "a genuinely changed diagnosis (co2/humidity -> humidity/temperature) must warn again");

  el.ownerDocument.defaultView.console.warn = originalWarn;
  env.cleanup(el);
});

test("_resolveMetricContext() is memoized per hass/config identity, like _language()", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  const first = el._resolveMetricContext();
  const second = el._resolveMetricContext();
  assert.equal(first, second, "same hass/config identity must return the cached object, not recompute");

  const hass2 = mkHass({ "sensor.avg": mkState("sensor.avg", 22, HUMIDITY_CLASS_ONLY) });
  el.hass = hass2;
  const third = el._resolveMetricContext();
  assert.notEqual(first, third, "a new hass object must invalidate the cache");
  assert.equal(third.metricType, "humidity");
  env.cleanup(el);
});

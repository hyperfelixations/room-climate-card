"use strict";

// New particle and CO modes through the shipped element and its full data pipeline.
// Covers policy binding, source arbitration, unit conversion and lifecycle recovery.
// Auxiliary declarations deliberately keep their context-bound contract.
// Numeric profile boundaries are independently pinned by the domain tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { attributesFor } = require("../../fixtures/attributes.js");

let env;
test.before(() => { env = createTestEnvironment(); });
test.after(() => env.cleanupAll());
const factor = 1.164409225500478;
const units = { "mg/m³": 1, "µg/m³": 0.001, ppm: factor, ppb: factor / 1000 };
const custom = (unit, overrides = {}) => ({
  source: "custom", unit,
  bands: { comfort: { min: 0, max: 10 }, optimal: { min: 0, max: 2 } },
  scale: { min: 0, max: 20, step: 1 },
  valid_range: { min: 0 },
  tiers: [{ min: 10, score: 1, level: "Above target", zone: "outside" }, { default: true, score: 0, level: "Target", zone: "optimal" }],
  ...overrides,
});

// curated: the kinds that share a unit with an older measurement
for (const kind of ["pm1", "pm4", "pm10", "co"]) {
  for (const source of ["auto", "entity", "profile", "custom"]) {
    test(`${kind}: ${source} binds in either lifecycle order and recovers from invalid data`, () => {
      const attr = { ...attributesFor(kind), value_color: "#123456", value_level: "Entity target" };
      const config = { entity: "sensor.main", classification: source === "custom" ? custom(attr.unit_of_measurement) : source === "profile" ? { source, profile: "indoor" } : source };
      const hass = (value) => mkHass({ "sensor.main": mkState("sensor.main", value, attr) });
      const first = env.createCard(config, hass(2));
      const second = env.createCard();
      second.setConfig(config);
      second.hass = hass(2);
      assert.equal(first.shadowRoot.innerHTML, second.shadowRoot.innerHTML);
      assert.equal(first._computeViewModel().metric.kind, kind);
      assert.equal(first._computeViewModel().tone.label, source === "custom" ? "Target" : source === "profile" ? kind === "co" ? "Slightly elevated" : "Optimal" : "Entity target");
      for (const value of [-1, "unavailable", 0, 2]) {
        first.hass = hass(value);
        assert.equal(first._computeViewModel().empty, value === -1 || value === "unavailable");
      }
    });
  }
}

test("CO: all source/display unit pairs convert ranges and rates under the unchanged auxiliary contract", () => {
  for (const [display, displayFactor] of Object.entries(units)) {
    for (const [source, sourceFactor] of Object.entries(units)) {
      const states = {
        "sensor.main": mkState("sensor.main", 2 / displayFactor, attributesFor("co", display)),
        "sensor.range": mkState("sensor.range", 3 / sourceFactor, { device_class: "ozone", unit_of_measurement: source, minimum: 1 / sourceFactor, maximum: 4 / sourceFactor }),
        "sensor.trend": mkState("sensor.trend", 0.2 / sourceFactor, { device_class: "carbon_dioxide", unit_of_measurement: `${source}/h` }),
      };
      const card = env.createCard({ entity: "sensor.main", range_entity: "sensor.range", trend_entity: "sensor.trend", views: [{ type: "range_scale", enabled: true }] }, mkHass(states));
      const vm = card._computeViewModel();
      assert.equal(vm.average.valueText, { "mg/m³": "2.0", "µg/m³": "2,000", ppm: "1.7", ppb: "1,718" }[display]);
      assert.ok(Math.abs(vm.range.min * displayFactor - 1) < 1e-12, `${source} → ${display}`);
      assert.ok(Math.abs(vm.range.max * displayFactor - 4) < 1e-12);
      assert.ok(Math.abs(vm.range.state * displayFactor - 3) < 1e-12);
      assert.equal(vm.average.trendDirection, "rising");
      assert.ok(vm.views.keys.includes("range_scale"));
      assert.equal(vm.warning.visible, false);
      env.cleanup(card);
    }
  }
});

test("shared custom units bind to each detected kind and survive changes between gas kinds", () => {
  for (const unit of ["ppm", "µg/m³"]) {
    // curated: the measurements Home Assistant reports in each shared unit
    const kinds = unit === "ppm" ? ["co2", "co"] : ["pm25", "pm1", "pm4", "pm10", "co"];
    const card = env.createCard({ entity: "sensor.main", classification: custom(unit) });
    for (const kind of [...kinds, ...kinds.reverse()]) {
      card.hass = mkHass({ "sensor.main": mkState("sensor.main", 12, attributesFor(kind, unit)) });
      assert.equal(card._computeViewModel().metric.kind, kind);
      assert.equal(card._computeViewModel().tone.label, "Above target", `${kind}/${unit}`);
      assert.equal(card._computeViewModel().warning.visible, false);
    }
  }
});

test("a CO conversion fault in ppm leaves the same profile usable for CO2", () => {
  const card = env.createCard({ entity: "sensor.main", classification: custom("ppm", { scale: { min: 0, max: 1.6e308, step: 1 } }) });
  for (const kind of ["co2", "co", "co2"]) {
    card.hass = mkHass({ "sensor.main": mkState("sensor.main", 12, attributesFor(kind, "ppm")) });
    const vm = card._computeViewModel();
    assert.equal(vm.empty, false);
    assert.equal(vm.warning.visible, kind === "co");
    if (kind === "co") assert.match(vm.warning.text, /classification.scale.max/);
    else assert.equal(vm.tone.label, "Above target");
  }
});

test("a CO profile written in ppm keeps its fine boundaries on a ppm sensor", () => {
  // 0.85 ppm would be floored to 0.8 on its way back from mg/m³.
  const profile = custom("ppm", {
    bands: { comfort: { min: 0, max: 0.85 }, optimal: { min: 0, max: 0.35 } },
    scale: { min: 0, max: 2, step: 0.5 },
    tiers: [{ min: 0.85, score: 1, level: "Above target", zone: "outside" }, { default: true, score: 0, level: "Target", zone: "optimal" }],
  });
  for (const [reading, label] of [[0.84, "Target"], [0.85, "Above target"]]) {
    const card = env.createCard({ entity: "sensor.main", classification: profile }, mkHass({ "sensor.main": mkState("sensor.main", reading, attributesFor("co", "ppm")) }));
    const vm = card._computeViewModel();
    assert.equal(vm.tone.label, label, `${reading} ppm`);
    assert.deepEqual({ min: vm.scale.optimalMin, max: vm.scale.optimalMax }, { min: 0, max: 0.35 });
    assert.equal(vm.warning.visible, false);
  }
});

test("shared units never merge different particle or gas kinds", () => {
  for (const [first, second, unit] of [["pm1", "pm4", "µg/m³"], ["pm10", "pm25", "µg/m³"], ["co", "co2", "ppm"]]) {
    const states = {
      "sensor.a": mkState("sensor.a", 2, attributesFor(first, unit)),
      "sensor.b": mkState("sensor.b", 4, attributesFor(second, unit)),
    };
    const rooms = [{ entity: "sensor.a" }, { entity: "sensor.b" }];
    const mixed = env.createCard({ rooms }, mkHass(states));
    assert.equal(mixed._computeViewModel().empty, true);
    const selected = env.createCard({ entity: "sensor.a", rooms }, mkHass(states));
    const context = normalize(selected._resolveMetricContext());
    assert.equal(context.metricKind, first);
    assert.equal(selected._computeViewModel().average.value, 2);
  }
});

test("mixed CO units produce an order-independent canonical mean", () => {
  const states = Object.fromEntries(Object.entries(units).map(([unit, f], i) => [`sensor.r${i}`, mkState(`sensor.r${i}`, (i + 1) / f, attributesFor("co", unit))]));
  const rooms = Object.keys(states).map((entity) => ({ entity }));
  for (const ordered of [rooms, [...rooms].reverse()]) {
    const card = env.createCard({ rooms: ordered }, mkHass(states));
    assert.equal(card._computeViewModel().metric.unit, "mg/m³");
    assert.ok(Math.abs(card._computeViewModel().average.value - 2.5) < 1e-12);
  }
});

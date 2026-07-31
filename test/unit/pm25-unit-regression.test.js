"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../helpers/card-internals.js");

// The compositions the element used to expose only for tests (see the helper).
let internals;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  env = createTestEnvironment();
});

test.after(() => {
  env.cleanupAll();
});

function pm25Attributes(unit) {
  return { device_class: "pm25", unit_of_measurement: unit };
}

test("PM2.5 accepts equivalent Home Assistant unit spellings at the UnitProfile boundary", () => {
  const equivalentUnits = ["µg/m³", "μg/m³", "ug/m3", "µg/m3", "μg/m^3", " µg / m³ "];

  for (const unit of equivalentUnits) {
    const entityId = `sensor.pm25_${equivalentUnits.indexOf(unit)}`;
    const el = env.createCard({ entity: entityId }, mkHass({
      [entityId]: mkState(entityId, 3.5, pm25Attributes(unit)),
    }));

    const model = internals.entityModel(el, entityId, "primary");
    assert.equal(model.metricKind, "pm25", `metric kind for ${JSON.stringify(unit)}`);
    assert.equal(model.unitProfile, "microgram_per_m3", `unit profile for ${JSON.stringify(unit)}`);
    assert.equal(model.validUnit, true, `unit validity for ${JSON.stringify(unit)}`);
    assert.equal(el._computeViewModel().empty, false, `card data for ${JSON.stringify(unit)}`);
    env.cleanup(el);
  }
});

test("reported PM2.5 dashboard configuration stays usable with normalized primary, room, range, and trend units", () => {
  const unit = "μg/m³";
  const states = {
    "sensor.wohnungspm25": mkState("sensor.wohnungspm25", 3.5, pm25Attributes(unit)),
    "sensor.ku_pm25": mkState("sensor.ku_pm25", 2.1, pm25Attributes(unit)),
    "sensor.sz_pm25": mkState("sensor.sz_pm25", 3.2, pm25Attributes(unit)),
    "sensor.az_pm25": mkState("sensor.az_pm25", 4.3, pm25Attributes(unit)),
    "sensor.wz_pm25": mkState("sensor.wz_pm25", 4.4, pm25Attributes(unit)),
    "sensor.wohnungspm25_tagesspanne": mkState("sensor.wohnungspm25_tagesspanne", 2.8, {
      ...pm25Attributes(unit),
      minimum: 1.7,
      maximum: 4.5,
      minimum_zeitpunkt: "2026-07-23T00:07:00+02:00",
      maximum_zeitpunkt: "2026-07-23T10:42:00+02:00",
    }),
    "sensor.wohnungspm25_trend": mkState("sensor.wohnungspm25_trend", -0.4, {
      unit_of_measurement: "μg/m³/h",
    }),
  };
  const el = env.createCard({
    entity: "sensor.wohnungspm25",
    range_entity: "sensor.wohnungspm25_tagesspanne",
    trend_entity: "sensor.wohnungspm25_trend",
    rooms: [
      { name: "Küche", short: "KÜ", entity: "sensor.ku_pm25" },
      { name: "Schlafzimmer", short: "SZ", entity: "sensor.sz_pm25" },
      { name: "Arbeitszimmer", short: "AZ", entity: "sensor.az_pm25" },
      { name: "Wohnzimmer", short: "WZ", entity: "sensor.wz_pm25" },
    ],
  }, mkHass(states, "de"));

  const data = el._computeViewModel();
  assert.equal(data.empty, false);
  assert.equal(data.metric.kind, "pm25");
  assert.equal(data.rooms.count, 4);
  assert.equal(data.range.hasRange, true);
  assert.equal(data.range.min, 1.7);
  assert.equal(data.range.max, 4.5);
  assert.equal(data.trend.value, -0.4);
  assert.equal(data.trend.unit, "µg/m³/h");
  assert.equal(el.shadowRoot.querySelector(".rtc-empty"), null, "must not render the reported empty state");
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-room-chip").length, 4, "all configured PM2.5 rooms must render");
  env.cleanup(el);
});

test("PM2.5 normalization does not accept a physically different or unknown explicit unit", () => {
  for (const [index, unit] of ["mg/m³", "hPa"].entries()) {
    const entityId = `sensor.invalid_${index}`;
    const el = env.createCard({ entity: entityId }, mkHass({
      [entityId]: mkState(entityId, 3.5, pm25Attributes(unit)),
    }));
    const model = internals.entityModel(el, entityId, "primary");
    assert.equal(model.unitProfile, null);
    assert.equal(model.validUnit, false);
    assert.equal(el._computeViewModel().empty, true);
    env.cleanup(el);
  }
});

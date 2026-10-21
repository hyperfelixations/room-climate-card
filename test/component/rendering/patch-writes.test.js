"use strict";

// What a content patch writes into the shadow DOM, counted with a MutationObserver. An update
// that leaves the view model as it was (a sensor reporting the same value with a new
// timestamp) must not touch a single node; a changed reading touches only what shows it.
// Boundary: which render path an update takes is lifecycle-and-rendering.test.js; the
// write-skip helpers themselves are test/unit/render/render-layer-modules.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// Every view and every patched part of the shell: headline with trend, rooms, warning row.
const CONFIG = {
  entity: "sensor.avg",
  range_entity: "sensor.range",
  trend_entity: "sensor.trend",
  auto_slide: false,
  room_sort: "invalid",
  rooms: [
    { entity: "sensor.r1", short: "R1" },
    { entity: "sensor.r2", short: "R2" },
    { entity: "sensor.r3", short: "R3" },
  ],
  views: [{ type: "scale" }, { type: "range_scale" }, { type: "extremes" }, { type: "range" }],
};

function state(entityId, value, attributes, stamp) {
  return { entity_id: entityId, state: String(value), attributes, last_changed: stamp, last_updated: stamp };
}

function hassAt(stamp, { r2 = 23.4 } = {}) {
  return mkHass({
    "sensor.avg": state("sensor.avg", 22.1, TEMPERATURE_C, "2026-10-01T10:00:00.000Z"),
    "sensor.range": state("sensor.range", 4.2, { unit_of_measurement: "°C", minimum: 19.6, maximum: 23.8 }, "2026-10-01T10:00:00.000Z"),
    "sensor.trend": state("sensor.trend", 0.4, { unit_of_measurement: "°C/h" }, "2026-10-01T10:00:00.000Z"),
    "sensor.r1": state("sensor.r1", 20.8, TEMPERATURE_C, "2026-10-01T10:00:00.000Z"),
    "sensor.r2": state("sensor.r2", r2, TEMPERATURE_C, stamp),
    "sensor.r3": state("sensor.r3", 21.9, TEMPERATURE_C, "2026-10-01T10:00:00.000Z"),
  });
}

function observe(card) {
  const observer = new env.window.MutationObserver(() => {});
  observer.observe(card.shadowRoot, { subtree: true, childList: true, attributes: true, characterData: true });
  return () => {
    const records = observer.takeRecords();
    observer.disconnect();
    return records;
  };
}

function describe(record) {
  const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
  const name = target?.getAttribute("class")?.split(" ")[0] ?? target?.nodeName;
  return `${record.type}${record.attributeName ? `:${record.attributeName}` : ""} on ${name}`;
}

test("an update that leaves the view model unchanged writes nothing into the DOM", () => {
  env.withCard(CONFIG, hassAt("2026-10-01T10:00:00.000Z"), (card) => {
    assert.ok(card.shadowRoot.querySelector(".rtc-warning"), "precondition: the warning row is part of the patched shell");
    const records = observe(card);
    card.hass = hassAt("2026-10-01T10:05:00.000Z");
    assert.deepEqual(records().map(describe), []);
  });
});

test("a changed room reading rewrites what shows it and leaves the other rooms untouched", () => {
  env.withCard(CONFIG, hassAt("2026-10-01T10:00:00.000Z"), (card) => {
    const chip = (entity) => card.shadowRoot.querySelector(`.rtc-room-chip[data-entity="${entity}"]`);
    const untouched = [chip("sensor.r1"), chip("sensor.r3")];
    const changedValue = chip("sensor.r2").querySelector(".rtc-room-value-num");
    const records = observe(card);
    card.hass = hassAt("2026-10-01T10:05:00.000Z", { r2: 24.6 });
    const written = records();
    assert.equal(changedValue.textContent, "24.6");
    assert.ok(written.some((record) => changedValue.contains(record.target)), "the changed reading is written");
    for (const chipEl of untouched) {
      const inside = written.filter((record) => chipEl.contains(record.target));
      assert.deepEqual(inside.map(describe), [], `${chipEl.getAttribute("data-entity")} is not touched`);
    }
  });
});

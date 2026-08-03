"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});

test.after(() => {
  env.cleanupAll();
});

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };
const HUMIDITY = { device_class: "humidity", unit_of_measurement: "%" };

function state(entity, value, attributes = TEMP) {
  return mkState(entity, value, attributes);
}

function room(entity, name) {
  return { entity, name, short: name.slice(0, 2).toUpperCase() };
}

function inspect(config, states) {
  const el = env.createCard(config, mkHass(states));
  const context = el._resolveMetricContext();
  const model = el._computeViewModel();
  return { el, context, model };
}

const cases = [
  {
    name: "primary only uses the primary",
    config: { entity: "sensor.primary" },
    states: { "sensor.primary": state("sensor.primary", 22) },
    expected: { empty: false, source: "sensor", entity: "sensor.primary", roomIndex: null, label: "", chips: false },
  },
  {
    name: "an unavailable primary-only source preserves the configured mode and becomes empty",
    config: { entity: "sensor.primary" },
    states: { "sensor.primary": state("sensor.primary", "unavailable") },
    expected: { empty: true, metricKind: "temperature" },
  },
  {
    name: "one room without a primary is a direct room source",
    config: { rooms: [room("sensor.room", "Kitchen")] },
    states: { "sensor.room": state("sensor.room", 21) },
    expected: { empty: false, source: "room", entity: "sensor.room", roomIndex: 0, label: "Kitchen", chips: false },
  },
  {
    name: "show_rooms true reveals the otherwise redundant single-room chip",
    config: { rooms: [room("sensor.room", "Kitchen")], show_rooms: true },
    states: { "sensor.room": state("sensor.room", 21) },
    expected: { empty: false, source: "room", entity: "sensor.room", roomIndex: 0, label: "Kitchen", chips: true },
  },
  {
    name: "one unavailable room keeps its room-derived metric title",
    config: { rooms: [room("sensor.room", "Bath")] },
    states: { "sensor.room": state("sensor.room", "unknown", HUMIDITY) },
    expected: { empty: true, metricKind: "humidity" },
  },
  {
    name: "a primary equal to the only room is the same direct-room topology",
    config: { entity: "sensor.room", rooms: [room("sensor.room", "Office")] },
    states: { "sensor.room": state("sensor.room", 22) },
    expected: { empty: false, source: "room", entity: "sensor.room", roomIndex: 0, label: "Office", chips: false },
  },
  {
    name: "a primary with one distinct room keeps the primary headline",
    config: { entity: "sensor.primary", rooms: [room("sensor.room", "Kitchen")] },
    states: { "sensor.primary": state("sensor.primary", 22), "sensor.room": state("sensor.room", 21) },
    expected: { empty: false, source: "sensor", entity: "sensor.primary", roomIndex: null, label: "Home avg.", chips: true },
  },
  {
    name: "a primary outage may use one compatible room without adopting its identity",
    config: { entity: "sensor.primary", rooms: [room("sensor.room", "Kitchen")] },
    states: { "sensor.primary": state("sensor.primary", "unavailable"), "sensor.room": state("sensor.room", 21) },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "Home avg.", chips: true },
  },
  {
    name: "a primary with several rooms remains a primary source",
    config: { entity: "sensor.primary", rooms: [room("sensor.a", "A"), room("sensor.b", "B")] },
    states: { "sensor.primary": state("sensor.primary", 22), "sensor.a": state("sensor.a", 21), "sensor.b": state("sensor.b", 23) },
    expected: { empty: false, source: "sensor", entity: "sensor.primary", roomIndex: null, label: "Home avg.", chips: true, comparable: true },
  },
  {
    name: "a primary repeated among several rooms does not receive room actions",
    config: { entity: "sensor.primary", rooms: [room("sensor.primary", "Primary room"), room("sensor.other", "Other")] },
    states: { "sensor.primary": state("sensor.primary", 22), "sensor.other": state("sensor.other", 23) },
    expected: { empty: false, source: "sensor", entity: "sensor.primary", roomIndex: null, label: "Home avg.", chips: true, comparable: true },
  },
  {
    name: "a repeated unavailable primary still does not turn the fallback into a room",
    config: { entity: "sensor.primary", rooms: [room("sensor.primary", "Primary room"), room("sensor.other", "Other")] },
    states: { "sensor.primary": state("sensor.primary", "unavailable"), "sensor.other": state("sensor.other", 23) },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "Home avg.", chips: true, comparable: false },
  },
  {
    name: "two rooms without a primary form a non-clickable consensus",
    config: { rooms: [room("sensor.a", "A"), room("sensor.b", "B")] },
    states: { "sensor.a": state("sensor.a", 20), "sensor.b": state("sensor.b", 24) },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "Home avg.", chips: true, comparable: true, value: 22 },
  },
  {
    name: "one usable room can carry a multi-room consensus without becoming the card identity",
    config: { rooms: [room("sensor.a", "A"), room("sensor.b", "B")] },
    states: { "sensor.a": state("sensor.a", 20), "sensor.b": state("sensor.b", "unavailable") },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "Home avg.", chips: true, comparable: false, value: 20 },
  },
  {
    name: "mixed compatible temperature units aggregate canonically",
    config: { rooms: [room("sensor.c", "C"), room("sensor.f", "F")] },
    states: {
      "sensor.c": state("sensor.c", 20),
      "sensor.f": state("sensor.f", 68, { device_class: "temperature", unit_of_measurement: "°F" }),
    },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "Home avg.", chips: true, comparable: true, value: 20, unit: "°C" },
  },
  {
    name: "mixed room metric kinds do not elect a majority",
    config: { rooms: [room("sensor.temp", "Temp"), room("sensor.humidity", "Humidity")] },
    states: { "sensor.temp": state("sensor.temp", 22), "sensor.humidity": state("sensor.humidity", 50, HUMIDITY) },
    expected: { empty: true, metricKind: "temperature", configurationState: "mixed_metric_kinds" },
  },
  {
    name: "an explicit empty value_label removes the caption in a room consensus",
    config: { rooms: [room("sensor.a", "A"), room("sensor.b", "B")], value_label: "" },
    states: { "sensor.a": state("sensor.a", 20), "sensor.b": state("sensor.b", 24) },
    expected: { empty: false, source: "calculated", entity: "", roomIndex: null, label: "", chips: true, comparable: true },
  },
];

for (const entry of cases) {
  test(entry.name, () => {
    const { el, context, model } = inspect(entry.config, entry.states);
    try {
      assert.equal(model.empty, entry.expected.empty);
      if (model.empty) {
        assert.equal(model.metric.kind, entry.expected.metricKind);
        if (entry.expected.configurationState) {
          assert.equal(model.configurationState, entry.expected.configurationState);
        }
        return;
      }

      assert.equal(model.average.source, entry.expected.source);
      assert.equal(model.average.entity, entry.expected.entity);
      assert.equal(model.average.roomIndex, entry.expected.roomIndex);
      assert.equal(model.average.label, entry.expected.label);
      assert.equal(model.rooms.showChips, entry.expected.chips);
      if (entry.expected.comparable !== undefined) {
        assert.equal(model.rooms.comparable, entry.expected.comparable);
      }
      if (entry.expected.value !== undefined) {
        assert.ok(Math.abs(model.average.value - entry.expected.value) < 1e-9);
      }
      if (entry.expected.unit) assert.equal(model.metric.unit, entry.expected.unit);

      const headline = el.shadowRoot.querySelector(".rtc-avg-button");
      assert.equal(headline.hasAttribute("data-room-index"), entry.expected.roomIndex !== null);
      assert.equal(headline.tagName, entry.expected.entity ? "BUTTON" : "DIV");
      if (entry.expected.source === "calculated") assert.equal(context.averageSource.kind, "roomConsensus");
    } finally {
      env.cleanup(el);
    }
  });
}

test("availability changes the displayed value but not the configured primary-with-rooms identity", () => {
  const config = { entity: "sensor.primary", rooms: [room("sensor.room", "Kitchen")] };
  const el = env.createCard(config, mkHass({
    "sensor.primary": state("sensor.primary", 22),
    "sensor.room": state("sensor.room", 21),
  }));
  try {
    assert.equal(el._computeViewModel().average.source, "sensor");
    assert.equal(el._computeViewModel().average.label, "Home avg.");

    el.hass = mkHass({
      "sensor.primary": state("sensor.primary", "unavailable"),
      "sensor.room": state("sensor.room", 21),
    });
    const fallback = el._computeViewModel();
    assert.equal(fallback.average.source, "calculated");
    assert.equal(fallback.average.label, "Home avg.");
    assert.equal(fallback.average.roomIndex, null);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-button").tagName, "DIV");

    el.hass = mkHass({
      "sensor.primary": state("sensor.primary", 23),
      "sensor.room": state("sensor.room", 21),
    });
    const recovered = el._computeViewModel();
    assert.equal(recovered.average.source, "sensor");
    assert.equal(recovered.average.label, "Home avg.");
    assert.equal(recovered.average.roomIndex, null);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-button").tagName, "BUTTON");
  } finally {
    env.cleanup(el);
  }
});

test("a direct-room headline uses the room tap and hold actions through the existing dispatcher", () => {
  const config = {
    rooms: [{
      entity: "sensor.room",
      name: "Kitchen",
      tap_action: { action: "navigate", navigation_path: "/lovelace/kitchen" },
      hold_action: { action: "perform-action", perform_action: "light.toggle" },
    }],
  };
  const el = env.createCard(config, mkHass({ "sensor.room": state("sensor.room", 21) }));
  const events = [];
  el.addEventListener("hass-action", (event) => events.push(event.detail));
  try {
    const headline = el.shadowRoot.querySelector(".rtc-avg-button");
    el._fireHassAction(headline, "tap");
    el._fireHassAction(headline, "hold");
    assert.equal(events.length, 2);
    assert.equal(events[0].action, "tap");
    assert.equal(events[0].config.tap_action.navigation_path, "/lovelace/kitchen");
    assert.equal(events[1].action, "hold");
    assert.equal(events[1].config.hold_action.perform_action, "light.toggle");
  } finally {
    env.cleanup(el);
  }
});

test("setConfig rebuilds only when label-node presence changes", () => {
  const el = env.createCard({ entity: "sensor.primary" }, mkHass({ "sensor.primary": state("sensor.primary", 22) }));
  try {
    const withoutLabel = el.shadowRoot.querySelector(".rtc-avg-button");
    assert.equal(withoutLabel.querySelector(".rtc-avg-label"), null);

    el.setConfig({ entity: "sensor.primary", value_label: "First" });
    const withLabel = el.shadowRoot.querySelector(".rtc-avg-button");
    assert.notEqual(withLabel, withoutLabel, "adding the label node is a structural rebuild");
    assert.equal(withLabel.querySelector(".rtc-avg-label").textContent, "First");

    el.setConfig({ entity: "sensor.primary", value_label: "Second" });
    const patched = el.shadowRoot.querySelector(".rtc-avg-button");
    assert.equal(patched, withLabel, "changing one non-empty label patches the existing node");
    assert.equal(patched.querySelector(".rtc-avg-label").textContent, "Second");

    el.setConfig({ entity: "sensor.primary", value_label: "" });
    const emptyAgain = el.shadowRoot.querySelector(".rtc-avg-button");
    assert.notEqual(emptyAgain, patched, "removing the label node is a structural rebuild");
    assert.equal(emptyAgain.querySelector(".rtc-avg-label"), null);
  } finally {
    env.cleanup(el);
  }
});

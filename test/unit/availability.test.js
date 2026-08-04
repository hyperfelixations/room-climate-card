"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkHass, mkState } = require("../helpers/hass-fixtures.js");

const TEMP = { device_class: "temperature", unit_of_measurement: "°C" };
const HUMIDITY = { device_class: "humidity", unit_of_measurement: "%" };

let env;
let entityModel;
let measurementContext;

function state(entity, value, attributes = TEMP) {
  return mkState(entity, value, attributes);
}

function room(entity, name) {
  return { entity, name, short: name.slice(0, 2).toUpperCase() };
}

test.before(async () => {
  env = createTestEnvironment();
  entityModel = await import("../../src/application/model/entity-model.js");
  measurementContext = await import("../../src/application/model/measurement-context.js");
});

test.after(() => env.cleanupAll());

test("MeasurementContext exposes typed availability for the primary and every room", () => {
  const config = {
    entity: "sensor.primary",
    rooms: [
      room("sensor.usable", "Usable"),
      room("sensor.unavailable", "Unavailable"),
      room("sensor.invalid", "Invalid"),
      room("sensor.missing", "Missing"),
      room("sensor.unit", "Unit"),
      room("sensor.kind", "Kind"),
    ],
    classification: { source: "auto", profile: null, custom: null },
  };
  const context = measurementContext.resolveMeasurementContext({
    "sensor.primary": state("sensor.primary", "unavailable"),
    "sensor.usable": state("sensor.usable", 21),
    "sensor.unavailable": state("sensor.unavailable", "unknown"),
    "sensor.invalid": state("sensor.invalid", "not-a-number"),
    "sensor.unit": state("sensor.unit", 21, { device_class: "temperature" }),
    "sensor.kind": state("sensor.kind", 21, {}),
  }, config);

  assert.equal(context.primary.availability, entityModel.AVAILABILITY.UNAVAILABLE);
  assert.deepEqual(context.rooms.map((model) => model.availability), [
    entityModel.AVAILABILITY.USABLE,
    entityModel.AVAILABILITY.UNAVAILABLE,
    entityModel.AVAILABILITY.INVALID_VALUE,
    entityModel.AVAILABILITY.MISSING,
    entityModel.AVAILABILITY.INCOMPATIBLE_UNIT,
    entityModel.AVAILABILITY.INCOMPATIBLE_KIND,
  ]);
});

test("fallback arbitration marks the rooms that supply the winning metric usable", () => {
  const context = measurementContext.resolveMeasurementContext({
    "sensor.primary": state("sensor.primary", "unavailable", { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }),
    "sensor.humidity": state("sensor.humidity", 50, HUMIDITY),
  }, {
    entity: "sensor.primary",
    rooms: [room("sensor.humidity", "Humidity")],
    classification: { source: "auto", profile: null, custom: null },
  });

  assert.equal(context.metricKind, "humidity");
  assert.equal(context.averageSource.kind, "roomConsensus");
  assert.equal(context.primary.availability, entityModel.AVAILABILITY.INCOMPATIBLE_KIND);
  assert.equal(context.rooms[0].availability, entityModel.AVAILABILITY.USABLE);
});

test("a no-data mixed-kind configuration exposes incompatibility, not placeholders", () => {
  const context = measurementContext.resolveMeasurementContext({
    "sensor.temperature": state("sensor.temperature", "unavailable", TEMP),
    "sensor.humidity": state("sensor.humidity", "unknown", HUMIDITY),
  }, {
    entity: null,
    rooms: [room("sensor.temperature", "Temperature"), room("sensor.humidity", "Humidity")],
    classification: { source: "auto", profile: null, custom: null },
  });

  assert.equal(context.averageSource, null);
  assert.equal(context.consistent, false);
  assert.deepEqual(context.rooms.map((model) => model.availability), [
    entityModel.AVAILABILITY.INCOMPATIBLE_KIND,
    entityModel.AVAILABILITY.INCOMPATIBLE_KIND,
  ]);
});

test("only unavailable and invalid rooms become neutral placeholders after all usable rooms", () => {
  const config = {
    entity: "sensor.primary",
    show_rooms: true,
    rooms: [
      { ...room("sensor.unavailable", "Unavailable"), tap_action: { action: "navigate", navigation_path: "/unavailable" } },
      room("sensor.usable", "Usable"),
      room("sensor.invalid", "Invalid"),
      room("sensor.missing", "Missing"),
      room("sensor.unit", "Bad unit"),
      room("sensor.foreign", "Foreign"),
    ],
  };
  const el = env.createCard(config, mkHass({
    "sensor.primary": state("sensor.primary", 22),
    "sensor.unavailable": state("sensor.unavailable", "unavailable"),
    "sensor.usable": state("sensor.usable", 21),
    "sensor.invalid": state("sensor.invalid", "garbage"),
    "sensor.unit": state("sensor.unit", 20, { device_class: "temperature" }),
    "sensor.foreign": state("sensor.foreign", 50, HUMIDITY),
  }));
  try {
    const model = el._computeViewModel();
    assert.equal(model.rooms.count, 1, "rooms.count remains the usable calculation count");
    assert.equal(model.rooms.comparable, false);
    assert.deepEqual(Array.from(model.rooms.chips, (chip) => chip.entity), [
      "sensor.usable",
      "sensor.unavailable",
      "sensor.invalid",
    ]);
    assert.deepEqual(Array.from(model.rooms.chips, (chip) => chip.valueText), ["21.0", "--", "--"]);
    assert.equal(model.extremes, null);
    assert.equal(model.roomMarkers.length, 0);

    const placeholderNodes = el.shadowRoot.querySelectorAll(".rtc-room-unavailable");
    assert.equal(placeholderNodes.length, 2);
    for (const node of placeholderNodes) {
      assert.equal(node.tagName, "BUTTON");
      assert.match(node.getAttribute("aria-label"), /no data/i);
    }

    const actions = [];
    el.addEventListener("hass-action", (event) => actions.push(event.detail));
    el._fireHassAction(el.shadowRoot.querySelector('[data-entity="sensor.unavailable"]'), "tap");
    assert.equal(actions.length, 1);
    assert.equal(actions[0].config.entity, "sensor.unavailable");
    assert.equal(actions[0].config.tap_action.navigation_path, "/unavailable");
  } finally {
    env.cleanup(el);
  }
});

test("unavailable_values hide removes optional placeholders but never the no-data headline", () => {
  const states = {
    "sensor.a": state("sensor.a", "unavailable"),
    "sensor.b": state("sensor.b", "unavailable"),
  };
  const shown = env.createCard({ rooms: [room("sensor.a", "Alpha"), room("sensor.b", "Beta")] }, mkHass(states));
  const hidden = env.createCard({ rooms: [room("sensor.a", "Alpha"), room("sensor.b", "Beta")], unavailable_values: "hide" }, mkHass(states));
  try {
    assert.equal(shown.shadowRoot.querySelectorAll(".rtc-room-unavailable").length, 2);
    assert.equal(hidden.shadowRoot.querySelector(".rtc-room-grid"), null);
    assert.equal(hidden.shadowRoot.querySelector(".rtc-avg-value-num").textContent, "--");
    assert.equal(hidden.shadowRoot.querySelector(".rtc-root").dataset.state, "no-data");
  } finally {
    env.cleanup(shown);
    env.cleanup(hidden);
  }
});

test("single-room placeholder policy keeps the configured room identity", () => {
  const states = { "sensor.room": state("sensor.room", "unavailable") };
  const automatic = env.createCard({ rooms: [room("sensor.room", "Kitchen")] }, mkHass(states));
  const explicit = env.createCard({ rooms: [room("sensor.room", "Kitchen")], show_rooms: true }, mkHass(states));
  try {
    const headline = automatic.shadowRoot.querySelector(".rtc-avg-button");
    assert.equal(headline.tagName, "BUTTON");
    assert.equal(headline.dataset.entity, "sensor.room");
    assert.equal(headline.dataset.roomIndex, "0");
    assert.equal(automatic.shadowRoot.querySelector(".rtc-avg-label").textContent, "Kitchen");
    assert.equal(automatic.shadowRoot.querySelector(".rtc-room-grid"), null);
    assert.equal(explicit.shadowRoot.querySelectorAll(".rtc-room-unavailable").length, 1);
  } finally {
    env.cleanup(automatic);
    env.cleanup(explicit);
  }
});

test("the no-data shell resolves title, status, views and source clickability honestly", () => {
  const unavailable = env.createCard(
    { entity: "sensor.primary" },
    mkHass({ "sensor.primary": state("sensor.primary", "unavailable", HUMIDITY) })
  );
  const missingId = 'sensor.missing"<img src=x onerror=alert(1)>';
  const missing = env.createCard({ entity: missingId }, mkHass({}));
  try {
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-root").dataset.state, "no-data");
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-title").textContent, "Humidity");
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-status-pill").textContent, "No data");
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-avg-button").tagName, "BUTTON");
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-avg-value-num").textContent, "--");
    assert.equal(unavailable.shadowRoot.querySelector(".rtc-rotator, .rtc-rotator-solo"), null);
    assert.equal(unavailable.shadowRoot.textContent.includes("No view available"), false);
    assert.equal(unavailable._carousel.hasAutoSlide(), false);
    assert.equal(unavailable._carousel.resumeTimerHandle, null);
    assert.equal(unavailable._carousel.accessibilityTimerHandle, null);

    assert.equal(missing.shadowRoot.querySelector(".rtc-title").textContent, "Room Climate Card");
    assert.equal(missing.shadowRoot.querySelector(".rtc-avg-button").tagName, "DIV");
    assert.match(missing.shadowRoot.querySelector(".rtc-subtitle").textContent, /sensor\.missing/);
    assert.equal(missing.shadowRoot.querySelectorAll("img[onerror]").length, 0);
  } finally {
    env.cleanup(unavailable);
    env.cleanup(missing);
  }
});

test("a missing room remains named when the no-data headline has its own outage", () => {
  const el = env.createCard({
    entity: "sensor.primary",
    rooms: [room("sensor.unavailable", "Unavailable"), room("sensor.missing", "Missing")],
  }, mkHass({
    "sensor.primary": state("sensor.primary", "unavailable"),
    "sensor.unavailable": state("sensor.unavailable", "unknown"),
  }));
  try {
    const subtitle = el.shadowRoot.querySelector(".rtc-subtitle").textContent;
    assert.match(subtitle, /currently unavailable/i);
    assert.match(subtitle, /sensor\.missing/);
    assert.equal(el.shadowRoot.querySelector('[data-entity="sensor.missing"]'), null);
  } finally {
    env.cleanup(el);
  }
});

test("no-data updates patch stable text and rebuild only real structure changes", () => {
  const config = { entity: "sensor.primary" };
  const el = env.createCard(config, mkHass({ "sensor.primary": state("sensor.primary", "unavailable") }));
  try {
    const noDataRoot = el.shadowRoot.querySelector(".rtc-root");
    const headline = el.shadowRoot.querySelector(".rtc-avg-button");
    headline.focus();

    el.hass = mkHass({ "sensor.primary": state("sensor.primary", "garbage") });
    assert.equal(el.shadowRoot.querySelector(".rtc-root"), noDataRoot, "same no-data structure is patched");
    assert.equal(el.shadowRoot.activeElement, headline, "a stable button keeps focus through the patch");

    el.hass = mkHass({ "sensor.primary": state("sensor.primary", 22) });
    assert.notEqual(el.shadowRoot.querySelector(".rtc-root"), noDataRoot, "recovery rebuilds the data structure");
    assert.equal(el.shadowRoot.querySelector(".rtc-root").dataset.state, "data");

    el.hass = mkHass({ "sensor.primary": state("sensor.primary", "unavailable") });
    assert.equal(el.shadowRoot.querySelector(".rtc-root").dataset.state, "no-data");
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, "--");
  } finally {
    env.cleanup(el);
  }
});

test("focus falls back safely when a no-data placeholder disappears", () => {
  const config = { rooms: [room("sensor.a", "Alpha"), room("sensor.b", "Beta")], show_rooms: true };
  const el = env.createCard(config, mkHass({
    "sensor.a": state("sensor.a", "unavailable"),
    "sensor.b": state("sensor.b", "unavailable"),
  }));
  try {
    const chip = el.shadowRoot.querySelector('[data-entity="sensor.a"]');
    chip.focus();
    // sensor.a stops existing at all — not "unavailable", GONE from the state machine.
    // Home Assistant only does that for an id it no longer knows, so the card is now a
    // one-room card and says so: no chip for the vanished room, and its single
    // remaining source becomes the interactive headline.
    el.hass = mkHass({ "sensor.b": state("sensor.b", "unavailable") });
    assert.equal(el.shadowRoot.querySelector('[data-entity="sensor.a"]'), null);
    // Focus lands on that headline rather than on .rtc-root: focusFallbackTarget()
    // prefers a real control when one exists, and here one now does. What matters for a
    // keyboard user is that focus never leaves the card, which both targets satisfy.
    const headline = el.shadowRoot.querySelector("button.rtc-avg-button");
    assert.ok(headline, "the one remaining room is the headline, and it is interactive");
    assert.equal(el.shadowRoot.activeElement, headline);
    assert.equal(headline.getAttribute("data-entity"), "sensor.b");
  } finally {
    env.cleanup(el);
  }
});

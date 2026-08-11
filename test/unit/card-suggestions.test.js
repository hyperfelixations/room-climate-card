"use strict";

// The card picker's two entry points, tested as the pure functions they are.
//
// Both run inside Home Assistant's own picker, outside this card's lifecycle and
// against whatever the frontend passes. A throw there does not degrade this card — it
// degrades the picker the user is standing in. So the hostile-input list below is not
// defensive decoration; it is the actual contract.

const test = require("node:test");
const assert = require("node:assert/strict");

let suggestions;

test.before(async () => {
  suggestions = await import("../../src/application/model/card-suggestions.js");
});

const state = (attributes) => ({ entity_id: "sensor.x", state: "21.5", attributes });

function statesWith(entries) {
  return Object.fromEntries(entries.map(([id, attributes]) => [id, { ...state(attributes), entity_id: id }]));
}

// ---------------------------------------------------------- suggestionsForEntity --

test("every measurement the card can read is offered, addressed as a custom card", () => {
  const cases = [
    ["sensor.t", { device_class: "temperature", unit_of_measurement: "°C" }],
    ["sensor.h", { device_class: "humidity", unit_of_measurement: "%" }],
    ["sensor.c", { device_class: "carbon_dioxide", unit_of_measurement: "ppm" }],
    ["sensor.p", { device_class: "pm25", unit_of_measurement: "µg/m³" }],
  ];
  const states = statesWith(cases);
  for (const [entityId] of cases) {
    assert.deepEqual(
      suggestions.suggestionsForEntity(states, entityId),
      { config: { type: "custom:room-climate-card", entity: entityId } },
      entityId
    );
  }
});

// The suggestion path uses the same resolver the card uses at runtime, so an entity
// that only declares a unit is offered for exactly the reason the card can read it.
test("a recognized unit alone is enough, and an unrecognized one is not", () => {
  const states = statesWith([
    ["sensor.unit_only", { unit_of_measurement: "°F" }],
    ["sensor.pressure", { device_class: "pressure", unit_of_measurement: "hPa" }],
  ]);
  assert.ok(suggestions.suggestionsForEntity(states, "sensor.unit_only"));
  assert.equal(suggestions.suggestionsForEntity(states, "sensor.pressure"), null);
});

test("entities this card cannot read are not offered", () => {
  const states = {
    ...statesWith([["sensor.plain", {}]]),
    "climate.living_room": { entity_id: "climate.living_room", state: "heat", attributes: { current_temperature: 21 } },
    "weather.home": { entity_id: "weather.home", state: "sunny", attributes: { temperature: 21 } },
    "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: {} },
  };
  for (const entityId of ["climate.living_room", "weather.home", "light.kitchen", "sensor.plain", "sensor.absent"]) {
    assert.equal(suggestions.suggestionsForEntity(states, entityId), null, entityId);
  }
});

// A restarting integration publishes its entities as `unavailable`. The card renders
// that state deliberately, so excluding it would make this card vanish from the picker
// during every restart window.
test("an entity that is currently unavailable is still offered", () => {
  const states = {
    "sensor.t": { entity_id: "sensor.t", state: "unavailable", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
  };
  assert.deepEqual(suggestions.suggestionsForEntity(states, "sensor.t"), {
    config: { type: "custom:room-climate-card", entity: "sensor.t" },
  });
});

// ------------------------------------------------------------------ stubConfigFor --

const TEMPERATURE = { device_class: "temperature", unit_of_measurement: "°C" };

test("the stub prefers what the view already uses, then the fallback list, then anything", () => {
  const states = statesWith([
    ["sensor.in_view", TEMPERATURE],
    ["sensor.in_fallback", TEMPERATURE],
    ["sensor.elsewhere", TEMPERATURE],
  ]);
  assert.deepEqual(
    suggestions.stubConfigFor(states, ["sensor.in_view"], ["sensor.in_fallback"]),
    { entity: "sensor.in_view" }
  );
  assert.deepEqual(
    suggestions.stubConfigFor(states, [], ["sensor.in_fallback"]),
    { entity: "sensor.in_fallback" }
  );
  // With neither list to go on, any readable entity beats an invented one — which one
  // is not a promise this makes, so the case is asserted where only one can win.
  const onlyOne = {
    ...statesWith([["sensor.somewhere", TEMPERATURE]]),
    "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: {} },
  };
  assert.deepEqual(suggestions.stubConfigFor(onlyOne, [], []), { entity: "sensor.somewhere" });
});

test("candidates this card cannot read are skipped rather than offered", () => {
  const states = {
    ...statesWith([["sensor.real", TEMPERATURE]]),
    "light.kitchen": { entity_id: "light.kitchen", state: "on", attributes: {} },
  };
  assert.deepEqual(
    suggestions.stubConfigFor(states, ["light.kitchen"], ["sensor.real"]),
    { entity: "sensor.real" },
    "an unusable entity in the preferred list must not win over a usable one in the fallback"
  );
});

// The template is what a user with no matching sensor still gets, and it has to stay
// exactly what it was: the registration baseline pins it, and its whole value is that
// the SHAPE teaches what the card is for.
test("with nothing to find, the documented template comes back unchanged", () => {
  const template = {
    entity: "sensor.house_temperature",
    rooms: [
      { name: "Kitchen", short: "KI", entity: "sensor.kitchen_temperature" },
      { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
      { name: "Living Room", short: "LR", entity: "sensor.living_room_temperature" },
    ],
  };
  assert.deepEqual(suggestions.stubConfigFor({}, [], []), template);
  assert.deepEqual(suggestions.stubConfigFor(undefined, undefined, undefined), template, "called the way older frontends call it");
});

// ------------------------------------------------------------------- total, always --

test("neither function throws, whatever the picker hands it", () => {
  const hostile = [
    undefined,
    null,
    "",
    0,
    false,
    [],
    "not an object",
    { "sensor.t": null },
    { "sensor.t": {} },
    { "sensor.t": { attributes: null } },
    { "sensor.t": { attributes: { device_class: 5, unit_of_measurement: {} } } },
    Object.create(null),
    JSON.parse('{"__proto__": {"polluted": true}}'),
  ];
  const ids = [undefined, null, "", 0, {}, [], "sensor.t", "__proto__", "toString", "constructor"];
  for (const states of hostile) {
    for (const entityId of ids) {
      const label = `states=${JSON.stringify(states)} id=${JSON.stringify(entityId)}`;
      let suggestion;
      assert.doesNotThrow(() => {
        suggestion = suggestions.suggestionsForEntity(states, entityId);
      }, label);
      assert.ok(suggestion === null || typeof suggestion.config === "object", label);
      let stub;
      assert.doesNotThrow(() => {
        stub = suggestions.stubConfigFor(states, entityId, entityId);
      }, label);
      assert.equal(typeof stub, "object", label);
      assert.ok(stub && typeof stub.entity === "string", label);
    }
  }
  assert.equal({}.polluted, undefined, "no prototype pollution may survive the sweep");
});

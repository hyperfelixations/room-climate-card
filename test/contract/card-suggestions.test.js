"use strict";

// The card picker's two entry points, tested as the pure functions they are. Both run
// inside Home Assistant's picker, outside this card's lifecycle, against whatever the
// frontend passes — a throw there degrades the picker, not just this card. The
// hostile-input list below is the actual contract, not defensive decoration.
// The browse path's start rooms are pinned here case by case; the randomized population is
// test/property/discovery.property.test.js. See internal dev doc §4 "Card-Picker-Vertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { CO2, HUMIDITY, PM25, TEMPERATURE_C } = require("../fixtures/attributes.js");
const { installation, sensor } = require("../fixtures/installation.js");
const { METRIC_KINDS } = require("../manifests/product-surface.js");

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
    ["sensor.t", TEMPERATURE_C],
    ["sensor.h", HUMIDITY],
    ["sensor.c", CO2],
    ["sensor.p", PM25],
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

// The suggestion path uses the same resolver as runtime: a unit-only entity is offered because the card can read it.
test("a recognized unit alone is enough, and an unrecognized one is not", () => {
  const states = statesWith([
    ["sensor.unit_only", { unit_of_measurement: "°F" }],
    ["sensor.pressure", { device_class: "pressure", unit_of_measurement: "hPa" }],
  ]);
  assert.ok(suggestions.suggestionsForEntity(states, "sensor.unit_only"));
  assert.equal(suggestions.suggestionsForEntity(states, "sensor.pressure"), null);
});

// A battery or a temperature difference shares a unit with the card's measurements; its declared class says it is something else.
test("an entity declaring another Home Assistant measurement is not offered, whatever its unit", () => {
  const states = statesWith([
    ["sensor.battery", { device_class: "battery", unit_of_measurement: "%" }],
    ["sensor.soil", { device_class: "moisture", unit_of_measurement: "%" }],
    ["sensor.delta", { device_class: "temperature_delta", unit_of_measurement: "°C" }],
    ["sensor.typo", { device_class: "temperatur", unit_of_measurement: "°C" }],
  ]);
  for (const entityId of ["sensor.battery", "sensor.soil", "sensor.delta"]) {
    assert.equal(suggestions.suggestionsForEntity(states, entityId), null, entityId);
  }
  assert.ok(suggestions.suggestionsForEntity(states, "sensor.typo"), "a misspelled class declares nothing; °C still identifies it");
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

// A restarting integration publishes `unavailable`; the card renders that state, so excluding it would drop the card from the picker every restart.
test("an entity that is currently unavailable is still offered", () => {
  const states = {
    "sensor.t": { entity_id: "sensor.t", state: "unavailable", attributes: TEMPERATURE_C },
  };
  assert.deepEqual(suggestions.suggestionsForEntity(states, "sensor.t"), {
    config: { type: "custom:room-climate-card", entity: "sensor.t" },
  });
});

// A number entity with a temperature class is a setpoint the user may still pick deliberately.
test("the entity path offers whatever readable entity was picked, not only sensors", () => {
  const states = { "number.setpoint": { entity_id: "number.setpoint", state: "21", attributes: TEMPERATURE_C } };
  assert.deepEqual(suggestions.suggestionsForEntity(states, "number.setpoint"), {
    config: { type: "custom:room-climate-card", entity: "number.setpoint" },
  });
});

// ------------------------------------------------------------------ stubConfigFor --

const TEMPLATE = {
  entity: "sensor.house_temperature",
  rooms: [
    { name: "Kitchen", short: "KI", entity: "sensor.kitchen_temperature" },
    { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
    { name: "Living Room", short: "LR", entity: "sensor.living_room_temperature" },
  ],
};

const BATTERY = Object.freeze({ device_class: "battery", unit_of_measurement: "%" });

// Two IKEA TIMMERFLOTTE sensors (temperature, humidity, battery each), listed the way the
// screenshot's installation published them: living room first. Every discovery once began
// with the first usable entity, here the living-room battery, read as humidity through its %.
function timmerflotte({ withAreas = true, batteryCategory } = {}) {
  const device = (deviceId) => (withAreas ? { device_id: deviceId } : {});
  const battery = (deviceId) => ({ ...device(deviceId), ...(batteryCategory ? { entity_category: batteryCategory } : {}) });
  return installation({
    areas: withAreas ? [["wohnzimmer", "Wohnzimmer"], ["bad", "Bad"]] : [],
    devices: withAreas ? { wz: { area_id: "wohnzimmer" }, ba: { area_id: "bad" } } : {},
    sensors: [
      sensor("sensor.living_room_wz_temperatur_batterie", BATTERY, { state: 100, name: "WZ Batterie", registry: battery("wz") }),
      sensor("sensor.living_room_wz_temperatur_luftfeuchtigkeit", HUMIDITY, { state: 63.3, name: "WZ Luftfeuchtigkeit", registry: device("wz") }),
      sensor("sensor.living_room_wz_temperatur_temperatur", TEMPERATURE_C, { state: 21.4, name: "WZ Temperatur", registry: device("wz") }),
      sensor("sensor.bathroom_ba_temperatur_batterie", BATTERY, { state: 100, name: "BA Batterie", registry: battery("ba") }),
      sensor("sensor.bathroom_ba_temperatur_luftfeuchtigkeit", HUMIDITY, { state: 69, name: "BA Luftfeuchtigkeit", registry: device("ba") }),
      sensor("sensor.bathroom_ba_temperatur_temperatur", TEMPERATURE_C, { state: 22, name: "BA Temperatur", registry: device("ba") }),
    ],
  });
}

test("the TIMMERFLOTTE installation starts as a temperature card of its two rooms, named after their areas", () => {
  const expected = {
    rooms: [
      { name: "Wohnzimmer", entity: "sensor.living_room_wz_temperatur_temperatur" },
      { name: "Bad", entity: "sensor.bathroom_ba_temperatur_temperatur" },
    ],
  };
  // The battery declared as a plain entity and as the diagnostic entity it usually is.
  assert.deepEqual(suggestions.stubConfigFor(timmerflotte()), expected);
  assert.deepEqual(suggestions.stubConfigFor(timmerflotte({ batteryCategory: "diagnostic" })), expected);
  // Without areas the same two thermometers, named as the system names them.
  assert.deepEqual(suggestions.stubConfigFor(timmerflotte({ withAreas: false })), {
    rooms: [
      { name: "BA Temperatur", entity: "sensor.bathroom_ba_temperatur_temperatur" },
      { name: "WZ Temperatur", entity: "sensor.living_room_wz_temperatur_temperatur" },
    ],
  });
});

test("the start configuration has rooms only, never an invented home average", () => {
  const stub = suggestions.stubConfigFor(timmerflotte());
  assert.deepEqual(Object.keys(stub), ["rooms"]);
  for (const room of stub.rooms) assert.deepEqual(Object.keys(room).sort(), ["entity", "name"]);
});

// ------------------------------------------------ how many sensors of which kind --

// One area per index; temperature sensor i and humidity sensor i live in area i.
function roomsOfTwoKinds(temperatures, humidities, { withAreas }) {
  const count = Math.max(temperatures, humidities);
  const areas = withAreas ? Array.from({ length: count }, (_, index) => [`area_${index}`, `Area ${index}`]) : [];
  const place = (index) => (withAreas ? { area_id: `area_${index}` } : {});
  const sensors = [
    ...Array.from({ length: temperatures }, (_, index) =>
      sensor(`sensor.t${index}`, TEMPERATURE_C, { state: 20 + index, name: `T${index}`, registry: place(index) })
    ),
    ...Array.from({ length: humidities }, (_, index) =>
      sensor(`sensor.h${index}`, HUMIDITY, { state: 40 + index, name: `H${index}`, registry: place(index) })
    ),
  ];
  return installation({ areas, sensors });
}

// The expected answer, stated as the rule: temperature before humidity, a kind that fills two
// rooms before one that fills one, never more than three rooms.
function expectedKind(temperatures, humidities) {
  if (temperatures >= 2) return "t";
  if (humidities >= 2) return "h";
  if (temperatures >= 1) return "t";
  if (humidities >= 1) return "h";
  return null;
}

test("every count from zero to five temperature and humidity sensors has one answer", () => {
  for (const withAreas of [true, false]) {
    for (let temperatures = 0; temperatures <= 5; temperatures += 1) {
      for (let humidities = 0; humidities <= 5; humidities += 1) {
        const label = `${temperatures} temperature, ${humidities} humidity, areas: ${withAreas}`;
        const stub = suggestions.stubConfigFor(roomsOfTwoKinds(temperatures, humidities, { withAreas }));
        const kind = expectedKind(temperatures, humidities);
        if (kind === null) {
          assert.deepEqual(stub, TEMPLATE, label);
          continue;
        }
        const available = kind === "t" ? temperatures : humidities;
        const rooms = Array.from({ length: Math.min(3, available) }, (_, index) => ({
          name: withAreas ? `Area ${index}` : `${kind.toUpperCase()}${index}`,
          entity: `sensor.${kind}${index}`,
        }));
        assert.deepEqual(stub, { rooms }, label);
      }
    }
  }
});

test("CO2 and PM2.5 are found like the others, after temperature and humidity", () => {
  const only = (attributes, prefix, [first, second]) =>
    installation({
      areas: [["a", "A"], ["b", "B"]],
      sensors: [sensor(`sensor.${prefix}_a`, attributes, { state: first, registry: { area_id: "a" } }), sensor(`sensor.${prefix}_b`, attributes, { state: second, registry: { area_id: "b" } })],
    });
  assert.deepEqual(suggestions.stubConfigFor(only(CO2, "co2", [600, 800])), { rooms: [{ name: "A", entity: "sensor.co2_a" }, { name: "B", entity: "sensor.co2_b" }] });
  assert.deepEqual(suggestions.stubConfigFor(only(PM25, "pm", [8, 14])), { rooms: [{ name: "A", entity: "sensor.pm_a" }, { name: "B", entity: "sensor.pm_b" }] });

  // One thermometer, one hygrometer, two CO2 sensors: CO2 is the first kind that compares two rooms.
  const mixed = installation({
    areas: [["a", "A"], ["b", "B"]],
    sensors: [
      sensor("sensor.t", TEMPERATURE_C, { registry: { area_id: "a" } }),
      sensor("sensor.h", HUMIDITY, { state: 50, registry: { area_id: "a" } }),
      sensor("sensor.c1", CO2, { state: 600, registry: { area_id: "a" } }),
      sensor("sensor.c2", CO2, { state: 700, registry: { area_id: "b" } }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(mixed), { rooms: [{ name: "A", entity: "sensor.c1" }, { name: "B", entity: "sensor.c2" }] });
});

test("the kind priority is temperature, humidity, CO2, PM2.5 and covers every measurement", () => {
  assert.deepEqual([...suggestions.BROWSE_KIND_PRIORITY], ["temperature", "humidity", "co2", "pm25"]);
  assert.deepEqual([...suggestions.BROWSE_KIND_PRIORITY].sort(), [...METRIC_KINDS].sort());
  assert.ok(Object.isFrozen(suggestions.BROWSE_KIND_PRIORITY));
  assert.equal(suggestions.BROWSE_ROOM_LIMIT, 3);
});

// ------------------------------------------------------------ what is never found --

test("only a sensor declaring one of the card's device classes is found", () => {
  const excluded = [
    ["battery", "sensor.battery", BATTERY, {}],
    ["hidden", "sensor.hidden", TEMPERATURE_C, { hidden: true }],
    ["diagnostic", "sensor.chip", TEMPERATURE_C, { entity_category: "diagnostic" }],
    ["config", "sensor.offset", TEMPERATURE_C, { entity_category: "config" }],
    ["unit only", "sensor.template", { unit_of_measurement: "°C" }, {}],
    ["misspelled class", "sensor.typo", { device_class: "temperatur", unit_of_measurement: "°C" }, {}],
    ["temperature difference", "sensor.delta", { device_class: "temperature_delta", unit_of_measurement: "°C" }, {}],
    ["setpoint", "number.setpoint", TEMPERATURE_C, {}],
    ["thermostat", "climate.hall", { current_temperature: 21 }, {}],
  ];
  for (const [label, id, attributes, registry] of excluded) {
    const alone = installation({ sensors: [sensor(id, attributes, { name: "Named", registry })] });
    assert.deepEqual(suggestions.stubConfigFor(alone), TEMPLATE, `${label}: nothing to find`);
    const beside = installation({ sensors: [sensor(id, attributes, { name: "Named", registry }), sensor("sensor.real", TEMPERATURE_C, { name: "Real" })] });
    assert.deepEqual(suggestions.stubConfigFor(beside), { rooms: [{ name: "Real", entity: "sensor.real" }] }, `${label}: beside a real sensor`);
  }
});

// ------------------------------------------------------------------- areas and names --

test("a sensor's area is its own, else its device's, else its parent device's", () => {
  const home = installation({
    areas: [["kitchen", "Kitchen"], ["hall", "Hall"], ["attic", "Attic"], ["study", "Study"]],
    devices: { plug: { area_id: "kitchen" }, hub: { area_id: "attic" }, child: { parent_device_id: "hub" } },
    sensors: [
      sensor("sensor.a", TEMPERATURE_C, { registry: { area_id: "hall", device_id: "plug" } }),
      sensor("sensor.b", TEMPERATURE_C, { registry: { device_id: "plug" } }),
      sensor("sensor.c", TEMPERATURE_C, { registry: { device_id: "child" } }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(home), {
    rooms: [
      { name: "Kitchen", entity: "sensor.b" },
      { name: "Hall", entity: "sensor.a" },
      { name: "Attic", entity: "sensor.c" },
    ],
  });
});

test("an area that does not exist or has no name counts as no area", () => {
  const home = installation({
    areas: [["blank", "   "], ["den", "Den"]],
    sensors: [
      sensor("sensor.ghost", TEMPERATURE_C, { name: "Ghost", registry: { area_id: "deleted" } }),
      sensor("sensor.blank", TEMPERATURE_C, { name: "Blank", registry: { area_id: "blank" } }),
      sensor("sensor.den", TEMPERATURE_C, { name: "Den sensor", registry: { area_id: "den" } }),
    ],
  });
  // One real area only, so the rooms are named by the system — all three of them.
  assert.deepEqual(suggestions.stubConfigFor(home), {
    rooms: [
      { name: "Den sensor", entity: "sensor.den" },
      { name: "Blank", entity: "sensor.blank" },
      { name: "Ghost", entity: "sensor.ghost" },
    ],
  });
});

test("rooms follow the order the areas are arranged in, one sensor per area", () => {
  const home = installation({
    areas: [["z", "Zimmer"], ["a", "Arbeitszimmer"], ["k", "Küche"]],
    sensors: [
      sensor("sensor.a_1", TEMPERATURE_C, { registry: { area_id: "a" } }),
      sensor("sensor.z_2", TEMPERATURE_C, { registry: { area_id: "z" } }),
      sensor("sensor.z_1", TEMPERATURE_C, { registry: { area_id: "z" } }),
      sensor("sensor.z_3", TEMPERATURE_C, { registry: { area_id: "z" } }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(home), {
    rooms: [
      { name: "Zimmer", entity: "sensor.z_1" },
      { name: "Arbeitszimmer", entity: "sensor.a_1" },
    ],
  });
});

test("at most three rooms, and area names are never mixed with sensor names", () => {
  const areas = [["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]];
  const fourAreas = installation({
    areas,
    sensors: [
      ...areas.map(([areaId]) => sensor(`sensor.${areaId}`, TEMPERATURE_C, { registry: { area_id: areaId } })),
      sensor("sensor.loose", TEMPERATURE_C, { name: "Loose" }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(fourAreas), {
    rooms: [
      { name: "A", entity: "sensor.a" },
      { name: "B", entity: "sensor.b" },
      { name: "C", entity: "sensor.c" },
    ],
  });

  // One area and two loose sensors: three rooms named by the system beat one named by area.
  const oneArea = installation({
    areas: [["a", "A"]],
    sensors: [
      sensor("sensor.a1", TEMPERATURE_C, { name: "In A", registry: { area_id: "a" } }),
      sensor("sensor.a2", TEMPERATURE_C, { name: "Also in A", registry: { area_id: "a" } }),
      sensor("sensor.x", TEMPERATURE_C, { name: "X" }),
      sensor("sensor.y", TEMPERATURE_C, { name: "Y" }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(oneArea), {
    rooms: [
      { name: "In A", entity: "sensor.a1" },
      { name: "X", entity: "sensor.x" },
      { name: "Y", entity: "sensor.y" },
    ],
  });

  // One area and nothing else: the area name, on a one-room card.
  const lonely = installation({ areas: [["a", "A"]], sensors: [sensor("sensor.a1", TEMPERATURE_C, { name: "In A", registry: { area_id: "a" } })] });
  assert.deepEqual(suggestions.stubConfigFor(lonely), { rooms: [{ name: "A", entity: "sensor.a1" }] });
});

test("a room needs a name of its own: nameless, blank and repeated names are skipped", () => {
  const home = installation({
    sensors: [
      sensor("sensor.a", TEMPERATURE_C),
      sensor("sensor.b", TEMPERATURE_C, { name: "  " }),
      sensor("sensor.c", TEMPERATURE_C, { name: " Hall " }),
      sensor("sensor.d", TEMPERATURE_C, { name: "Hall" }),
      sensor("sensor.e", TEMPERATURE_C, { name: "Study" }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(home), {
    rooms: [
      { name: "Hall", entity: "sensor.c" },
      { name: "Study", entity: "sensor.e" },
    ],
  });
  // Areas carry the name, so a nameless sensor in an area is a room.
  const inAreas = installation({
    areas: [["a", " Attic "], ["b", "Basement"]],
    sensors: [sensor("sensor.a", TEMPERATURE_C, { registry: { area_id: "a" } }), sensor("sensor.b", TEMPERATURE_C, { registry: { area_id: "b" } })],
  });
  assert.deepEqual(suggestions.stubConfigFor(inAreas), {
    rooms: [
      { name: "Attic", entity: "sensor.a" },
      { name: "Basement", entity: "sensor.b" },
    ],
  });
});

// ------------------------------------------------------------- usable before merely declared --

test("usable sensors are preferred; every kind of unusable one is left for the second pass", () => {
  const broken = {
    unavailable: { state: "unavailable", attributes: TEMPERATURE_C },
    unknown: { state: "unknown", attributes: TEMPERATURE_C },
    "not a number": { state: "warm", attributes: TEMPERATURE_C },
    "unreadable unit": { state: 21, attributes: { device_class: "temperature", unit_of_measurement: "furlongs" } },
    impossible: { state: -500, attributes: TEMPERATURE_C },
  };
  for (const [label, { state: value, attributes }] of Object.entries(broken)) {
    const home = installation({ sensors: [sensor("sensor.a_broken", attributes, { state: value, name: "Broken" }), sensor("sensor.b_live", TEMPERATURE_C, { name: "Live" })] });
    assert.deepEqual(suggestions.stubConfigFor(home), { rooms: [{ name: "Live", entity: "sensor.b_live" }] }, label);
  }
  // One usable humidity sensor beats two unusable thermometers: the preview shows a value.
  const home = installation({
    sensors: [
      sensor("sensor.t1", TEMPERATURE_C, { state: "unavailable", name: "T1" }),
      sensor("sensor.t2", TEMPERATURE_C, { state: "unavailable", name: "T2" }),
      sensor("sensor.h", HUMIDITY, { state: 50, name: "H" }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(home), { rooms: [{ name: "H", entity: "sensor.h" }] });
});

// A restart window: real ids with no value yet still beat the invented template.
test("with nothing usable, declared sensors still make the start rooms", () => {
  const home = installation({
    areas: [["a", "A"], ["b", "B"]],
    sensors: [
      sensor("sensor.a", TEMPERATURE_C, { state: "unavailable", registry: { area_id: "a" } }),
      sensor("sensor.b", TEMPERATURE_C, { state: "unknown", registry: { area_id: "b" } }),
      sensor("sensor.battery", BATTERY, { state: 100, registry: { area_id: "a" } }),
    ],
  });
  assert.deepEqual(suggestions.stubConfigFor(home), { rooms: [{ name: "A", entity: "sensor.a" }, { name: "B", entity: "sensor.b" }] });
});

// ------------------------------------------------------------------- the switch --

test("the browse-discovery switch shapes the same discovery three ways", () => {
  assert.equal(suggestions.BROWSE_DISCOVERY, "rooms");
  const home = timmerflotte();
  assert.deepEqual(suggestions.stubConfigFor(home, { discovery: "rooms" }), suggestions.stubConfigFor(home));
  assert.deepEqual(suggestions.stubConfigFor(home, { discovery: "entity" }), { entity: "sensor.living_room_wz_temperatur_temperatur" });
  assert.deepEqual(suggestions.stubConfigFor(home, { discovery: "template" }), TEMPLATE);
  assert.deepEqual(suggestions.stubConfigFor(installation(), { discovery: "entity" }), TEMPLATE, "nothing found, whatever the switch");
});

// The template is what a user with no matching sensor gets; the registration baseline pins it, its shape teaches what the card is for.
test("with nothing to find, the documented template comes back unchanged", () => {
  assert.deepEqual(suggestions.stubConfigFor({ states: {} }), TEMPLATE);
  assert.deepEqual(suggestions.stubConfigFor(undefined), TEMPLATE, "called the way older frontends call it");
  assert.deepEqual(suggestions.stubConfigFor({ states: { "light.kitchen": { state: "on", attributes: {} } } }), TEMPLATE);
});

// ------------------------------------------------------------------- stability --

// Object key order follows arrival; the same system must open the picker on the same rooms.
test("the same installation always produces the same rooms, whatever order it arrived in", () => {
  const home = timmerflotte();
  const reversed = (record) => Object.fromEntries(Object.entries(record).reverse());
  const shuffled = { ...home, states: reversed(home.states), entities: reversed(home.entities), devices: reversed(home.devices) };
  assert.deepEqual(suggestions.stubConfigFor(shuffled), suggestions.stubConfigFor(home));
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
    }
  }

  const valid = { "sensor.t": { state: "21", attributes: { ...TEMPERATURE_C, friendly_name: "T" } } };
  const registries = [
    undefined,
    null,
    "text",
    [],
    [{ entity_id: "sensor.t", area_id: "a" }],
    { "sensor.t": null },
    { "sensor.t": "entry" },
    { "sensor.t": { area_id: {}, device_id: [], hidden: "yes", entity_category: 5 } },
    { "sensor.t": { device_id: "loop" }, loop: { parent_device_id: "loop" } },
    JSON.parse('{"__proto__": {"area_id": "a", "name": "Polluted"}}'),
    Object.create(null),
  ];
  const hosts = [
    ...hostile.map((states) => ({ states })),
    ...hostile,
    ...registries.flatMap((registry) => [
      { states: valid, entities: registry },
      { states: valid, devices: registry, entities: { "sensor.t": { device_id: "loop" } } },
      { states: valid, areas: registry, entities: { "sensor.t": { area_id: "__proto__" } } },
      { states: valid, entities: registry, devices: registry, areas: registry },
    ]),
  ];
  for (const hass of hosts) {
    for (const options of [undefined, null, "rooms", {}, { discovery: "entity" }, { discovery: 5 }]) {
      const label = `hass=${JSON.stringify(hass)} options=${JSON.stringify(options)}`;
      let stub;
      assert.doesNotThrow(() => {
        stub = suggestions.stubConfigFor(hass, options);
      }, label);
      assert.ok(stub && typeof stub === "object", label);
      assert.ok(typeof stub.entity === "string" || Array.isArray(stub.rooms), label);
      for (const room of stub.rooms || []) {
        assert.equal(typeof room.name, "string", label);
        assert.ok(room.name.trim(), label);
      }
    }
  }
  assert.equal({}.polluted, undefined, "no prototype pollution may survive the sweep");
  assert.equal({}.area_id, undefined);
});

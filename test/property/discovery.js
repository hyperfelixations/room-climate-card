"use strict";

// Randomly described Home Assistant installations for the card picker's browse path, and the
// invariants its start configuration must satisfy over any of them. A description is plain JSON
// in the shape test/fixtures/installation.js builds: areas in registry order, devices (some
// nested under a parent), sensors of the four measurements — 0 to 5 each, declared correctly,
// misspelled, undeclared or foreign, usable or not, named or not, placed or not — and
// distractors that must never be found. DISCOVERY_WEIGHTS is measured by discovery.test.js.
// See internal dev doc §4 "Die Property-Schicht" and "Card-Picker-Vertrag".

const { SeededRandom } = require("../helpers/seeded-random.js");
const { METRICS, METRIC_KINDS } = require("../manifests/product-surface.js");
const { installation } = require("../fixtures/installation.js");
const { weighted } = require("./generators.js");
const V = require("./vocabulary.js");

// ---------------------------------------------------------------------- the weights --

const DISCOVERY_WEIGHTS = {
  // An installation without a single climate sensor, where only distractors can be found.
  installation: [
    [92, "withClimateSensors"],
    [8, "withoutClimateSensors"],
  ],
  // How many sensors of one measurement the installation has, per measurement.
  sensorsPerKind: [
    [26, "0"],
    [16, "1"],
    [18, "2"],
    [16, "3"],
    [13, "4"],
    [11, "5"],
  ],
  areaCount: [
    [14, "0"],
    [14, "1"],
    [18, "2"],
    [18, "3"],
    [16, "4"],
    [12, "5"],
    [8, "6"],
  ],
  deviceCount: [
    [20, "0"],
    [30, "2"],
    [30, "4"],
    [20, "6"],
  ],
  // Where a sensor's area comes from, if anywhere.
  placement: [
    [44, "device"],
    [24, "entity"],
    [8, "parentDevice"],
    [16, "none"],
    [4, "unknownArea"],
    [4, "entityOverridesDevice"],
  ],
  deviceClass: [
    [80, "correct"],
    [5, "respelled"],
    [6, "missing"],
    [5, "typo"],
    [4, "foreign"],
  ],
  unit: [
    [84, "canonical"],
    [7, "alternative"],
    [5, "missing"],
    [4, "otherMetric"],
  ],
  state: [
    [80, "usable"],
    [7, "unavailable"],
    [4, "unknown"],
    [4, "malformed"],
    [5, "impossible"],
  ],
  friendlyName: [
    [68, "unique"],
    [10, "missing"],
    [5, "blank"],
    [9, "duplicate"],
    [8, "awkward"],
  ],
  registry: [
    [78, "plain"],
    [7, "none"],
    [5, "hidden"],
    [6, "diagnostic"],
    [4, "config"],
  ],
  areaName: [
    [82, "plain"],
    [8, "awkward"],
    [5, "blank"],
    [5, "duplicate"],
  ],
  domain: [
    [95, "sensor"],
    [5, "number"],
  ],
  distractors: [
    [30, "0"],
    [30, "1"],
    [25, "2"],
    [15, "4"],
  ],
};

// ---------------------------------------------------------------------- the tables --

const AREA_NAMES = ["Wohnzimmer", "Bad", "Küche", "Schlafzimmer", "Flur", "Büro", "Kinderzimmer", "Keller", "Living Room", "Bedroom"];

// A reading the card accepts, per measurement and unit.
const USABLE_VALUES = {
  temperature: { "°C": [16, 27], "°F": [61, 80], K: [289, 300] },
  humidity: { "%": [30, 70] },
  co2: { ppm: [400, 1600] },
  pm25: { "µg/m³": [1, 40] },
};
const ALTERNATIVE_UNITS = { temperature: ["°F", "K"], humidity: ["%"], co2: ["ppm"], pm25: ["µg/m³"] };

// A value below what the measurement can physically be, in the canonical unit.
const IMPOSSIBLE_VALUES = { temperature: -400, humidity: -5, co2: -5, pm25: -1 };

// Entities that are never found, whatever else the installation holds. Each shares something
// with a real find: a unit, a device class, an area, a domain.
const DISTRACTORS = [
  ["battery", "sensor", { device_class: "battery", unit_of_measurement: "%" }, {}],
  ["moisture", "sensor", { device_class: "moisture", unit_of_measurement: "%" }, {}],
  ["power_factor", "sensor", { device_class: "power_factor", unit_of_measurement: "%" }, {}],
  ["temperature_delta", "sensor", { device_class: "temperature_delta", unit_of_measurement: "°C" }, {}],
  ["pressure", "sensor", { device_class: "atmospheric_pressure", unit_of_measurement: "hPa" }, {}],
  ["unit_only_temperature", "sensor", { unit_of_measurement: "°C" }, {}],
  ["unit_only_humidity", "sensor", { unit_of_measurement: "%" }, {}],
  ["misspelled_class", "sensor", { device_class: "temperatur", unit_of_measurement: "°C" }, {}],
  ["hidden_temperature", "sensor", { device_class: "temperature", unit_of_measurement: "°C" }, { hidden: true }],
  ["diagnostic_temperature", "sensor", { device_class: "temperature", unit_of_measurement: "°C" }, { entity_category: "diagnostic" }],
  ["config_humidity", "sensor", { device_class: "humidity", unit_of_measurement: "%" }, { entity_category: "config" }],
  ["setpoint", "number", { device_class: "temperature", unit_of_measurement: "°C" }, {}],
  ["thermostat", "climate", { current_temperature: 21, temperature: 20 }, {}],
];

const count = (label) => Number(label);

// ------------------------------------------------------------------ the generator --

function generateAreas(rng) {
  const areas = [];
  const total = count(weighted(rng, DISCOVERY_WEIGHTS.areaCount));
  for (let index = 0; index < total; index++) {
    let name;
    switch (weighted(rng, DISCOVERY_WEIGHTS.areaName)) {
      case "awkward":
        name = rng.pick(V.AWKWARD_TEXT);
        break;
      case "blank":
        name = rng.pick(["", "   ", "\t"]);
        break;
      case "duplicate":
        name = areas.length ? rng.pick(areas)[1] : rng.pick(AREA_NAMES);
        break;
      default:
        name = `${rng.pick(AREA_NAMES)}${index ? ` ${index}` : ""}`;
    }
    areas.push([`area_${index}`, name]);
  }
  // Registry order is the user's arrangement, not creation or alphabetical order.
  for (let index = areas.length - 1; index > 0; index--) {
    const other = rng.int(0, index);
    [areas[index], areas[other]] = [areas[other], areas[index]];
  }
  return areas;
}

function generateDevices(rng, areas) {
  const devices = {};
  const total = count(weighted(rng, DISCOVERY_WEIGHTS.deviceCount));
  for (let index = 0; index < total; index++) {
    const areaId = areas.length && rng.bool(0.85) ? rng.pick(areas)[0] : null;
    devices[`device_${index}`] = { area_id: areaId };
  }
  // A child device without an area of its own inherits its parent's.
  if (total >= 2) devices.device_child = { area_id: null, parent_device_id: `device_${rng.int(0, total - 1)}` };
  return devices;
}

function generateRegistry(rng, areas, devices) {
  const kind = weighted(rng, DISCOVERY_WEIGHTS.registry);
  if (kind === "none") return null;
  const registry = {};
  if (kind === "hidden") registry.hidden = true;
  if (kind === "diagnostic" || kind === "config") registry.entity_category = kind;
  const deviceIds = Object.keys(devices).filter((id) => id !== "device_child");
  switch (weighted(rng, DISCOVERY_WEIGHTS.placement)) {
    case "device":
      if (deviceIds.length) registry.device_id = rng.pick(deviceIds);
      break;
    case "entity":
      if (areas.length) registry.area_id = rng.pick(areas)[0];
      break;
    case "parentDevice":
      if (devices.device_child) registry.device_id = "device_child";
      break;
    case "unknownArea":
      registry.area_id = "area_deleted";
      break;
    case "entityOverridesDevice":
      if (deviceIds.length) registry.device_id = rng.pick(deviceIds);
      if (areas.length) registry.area_id = rng.pick(areas)[0];
      break;
    default:
  }
  return registry;
}

function generateReading(rng, metric, unit) {
  switch (weighted(rng, DISCOVERY_WEIGHTS.state)) {
    case "unavailable":
      return "unavailable";
    case "unknown":
      return "unknown";
    case "malformed":
      return rng.pick(V.MALFORMED_STATES);
    case "impossible":
      return IMPOSSIBLE_VALUES[metric];
    default: {
      const [low, high] = (USABLE_VALUES[metric][unit] || Object.values(USABLE_VALUES[metric])[0]);
      return rng.number(low, high, 1);
    }
  }
}

function generateSensor(rng, metric, index, context) {
  const attributes = {};
  const canonical = METRICS[metric].deviceClass;
  switch (weighted(rng, DISCOVERY_WEIGHTS.deviceClass)) {
    case "respelled":
      attributes.device_class = rng.bool() ? canonical.toUpperCase() : ` ${canonical} `;
      break;
    case "typo":
      attributes.device_class = V.typo(rng, canonical);
      break;
    case "foreign":
      attributes.device_class = rng.pick(V.FOREIGN_DEVICE_CLASSES);
      break;
    case "missing":
      break;
    default:
      attributes.device_class = canonical;
  }
  let unit;
  switch (weighted(rng, DISCOVERY_WEIGHTS.unit)) {
    case "alternative":
      unit = rng.pick(ALTERNATIVE_UNITS[metric]);
      break;
    case "otherMetric":
      unit = METRICS[rng.pick(METRIC_KINDS.filter((kind) => kind !== metric))].canonicalUnit;
      break;
    case "missing":
      unit = undefined;
      break;
    default:
      unit = METRICS[metric].canonicalUnit;
  }
  if (unit !== undefined) attributes.unit_of_measurement = unit;

  let name;
  switch (weighted(rng, DISCOVERY_WEIGHTS.friendlyName)) {
    case "missing":
      name = undefined;
      break;
    case "blank":
      name = rng.pick(["", "  "]);
      break;
    case "duplicate":
      name = context.names.length ? rng.pick(context.names) : "Sensor";
      break;
    case "awkward":
      name = rng.pick(V.AWKWARD_TEXT);
      break;
    default:
      name = `${rng.pick(AREA_NAMES)} ${metric} ${index}`;
  }
  if (typeof name === "string") context.names.push(name);

  const domain = weighted(rng, DISCOVERY_WEIGHTS.domain);
  const prefix = rng.pick(["a", "bath", "living", "z", "kitchen"]);
  return {
    id: `${domain}.${prefix}_${metric}_${index}`,
    state: generateReading(rng, metric, unit),
    attributes,
    name,
    registry: generateRegistry(rng, context.areas, context.devices),
  };
}

function distractorAt(rng, index, context) {
  const [label, domain, attributes, extra] = rng.pick(DISTRACTORS);
  const registry = { ...(generateRegistry(rng, context.areas, context.devices) || {}), ...extra };
  return { id: `${domain}.distractor_${label}_${index}`, state: rng.number(0, 100, 1), attributes: { ...attributes }, name: `Distractor ${index}`, registry };
}

// One installation description, plain JSON.
function generateInstallation(seedOrRng) {
  const rng = typeof seedOrRng === "number" ? new SeededRandom(seedOrRng) : seedOrRng;
  const areas = generateAreas(rng);
  const devices = generateDevices(rng, areas);
  const context = { areas, devices, names: [] };
  const sensors = [];
  const withClimateSensors = weighted(rng, DISCOVERY_WEIGHTS.installation) === "withClimateSensors";
  for (const metric of METRIC_KINDS) {
    const total = withClimateSensors ? count(weighted(rng, DISCOVERY_WEIGHTS.sensorsPerKind)) : 0;
    for (let index = 0; index < total; index++) sensors.push(generateSensor(rng, metric, index, context));
  }
  const distractors = count(weighted(rng, DISCOVERY_WEIGHTS.distractors));
  for (let index = 0; index < distractors; index++) sensors.push(distractorAt(rng, index, context));
  // Arrival order is Home Assistant's, never sorted.
  for (let index = sensors.length - 1; index > 0; index--) {
    const other = rng.int(0, index);
    [sensors[index], sensors[other]] = [sensors[other], sensors[index]];
  }
  return { areas, devices, sensors };
}

// ------------------------------------------------------------------- the reference --

// The card's four device classes and their measurements, from the manifest.
const KIND_BY_CLASS = Object.fromEntries(METRIC_KINDS.map((kind) => [METRICS[kind].deviceClass, kind]));
const PRIORITY = ["temperature", "humidity", "co2", "pm25"];

function declaredKind(hass, entityId) {
  const raw = hass.states[entityId]?.attributes?.device_class;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return Object.hasOwn(KIND_BY_CLASS, normalized) ? KIND_BY_CLASS[normalized] : null;
}

function registryOf(hass, entityId) {
  return Object.hasOwn(hass.entities, entityId) ? hass.entities[entityId] : null;
}

function areaOf(hass, entityId) {
  const entry = registryOf(hass, entityId);
  const device = entry?.device_id && Object.hasOwn(hass.devices, entry.device_id) ? hass.devices[entry.device_id] : null;
  const parent = device?.parent_device_id && Object.hasOwn(hass.devices, device.parent_device_id) ? hass.devices[device.parent_device_id] : null;
  const areaId = entry?.area_id || device?.area_id || parent?.area_id || null;
  const name = areaId && Object.hasOwn(hass.areas, areaId) ? hass.areas[areaId].name : null;
  return typeof name === "string" && name.trim() ? { id: areaId, name: name.trim() } : null;
}

// Whether the browse path may take this entity at all, and in the usable pass.
function qualifies(hass, entityId, { usable, isUsable }) {
  if (!entityId.startsWith("sensor.") || !declaredKind(hass, entityId)) return false;
  const entry = registryOf(hass, entityId);
  if (entry?.hidden === true) return false;
  if (typeof entry?.entity_category === "string" && entry.entity_category.trim()) return false;
  return !usable || isUsable(hass, entityId);
}

const reversedRecord = (record) => Object.fromEntries(Object.entries(record).reverse());

// Every invariant a start configuration must hold for one installation. `stubFor(description)`
// runs the product; `isUsable(hass, id)` is the runtime's own availability verdict.
function checkDiscovery(description, { stubFor, isUsable, template }) {
  const violations = [];
  const hass = installation(description);
  const stub = stubFor(description);
  const ids = Object.keys(hass.states);

  // Each measurement alone, restricted to one pass: the rooms it yields by itself. The usable
  // pass decides when any measurement yields a room from usable sensors; the declared pass
  // otherwise; the template when neither yields one (a sensor needs an area or a name).
  const aloneIn = (usable) =>
    Object.fromEntries(
      PRIORITY.map((kind) => {
        const sensors = description.sensors.filter((entry) => declaredKind(hass, entry.id) === kind && qualifies(hass, entry.id, { usable, isUsable }));
        const alone = stubFor({ ...description, sensors });
        return [kind, alone.rooms && !alone.entity ? alone.rooms : []];
      })
    );
  const yields = (rooms) => PRIORITY.some((kind) => rooms[kind].length);
  let usablePass = true;
  let aloneRooms = aloneIn(true);
  if (!yields(aloneRooms)) {
    usablePass = false;
    aloneRooms = aloneIn(false);
  }

  if (JSON.stringify(stub) === JSON.stringify(template)) {
    if (yields(aloneRooms)) violations.push("the template came back although a measurement yields rooms on its own");
    return { violations, stub, outcome: { rooms: 0 } };
  }
  if (!yields(aloneRooms)) violations.push("rooms came back although no measurement yields any on its own");
  const keys = Object.keys(stub);
  if (keys.length !== 1 || keys[0] !== "rooms" || !Array.isArray(stub.rooms)) {
    violations.push(`the start configuration is not rooms only: ${JSON.stringify(stub)}`);
    return { violations, stub, outcome: { rooms: -1 } };
  }
  const rooms = stub.rooms;
  if (rooms.length < 1 || rooms.length > 3) violations.push(`${rooms.length} rooms, outside 1–3`);
  for (const room of rooms) {
    if (Object.keys(room).sort().join() !== "entity,name") violations.push(`a room has other keys: ${JSON.stringify(room)}`);
    if (typeof room.name !== "string" || !room.name || room.name !== room.name.trim()) violations.push(`a room name is empty or untrimmed: ${JSON.stringify(room.name)}`);
    if (!Object.hasOwn(hass.states, room.entity)) {
      violations.push(`${room.entity} is not in the installation`);
      continue;
    }
    if (!qualifies(hass, room.entity, { usable: usablePass, isUsable })) {
      violations.push(`${room.entity} does not qualify${usablePass ? " as usable" : ""}`);
    }
  }
  if (violations.length) return { violations, stub, outcome: { rooms: rooms.length } };

  const kinds = new Set(rooms.map((room) => declaredKind(hass, room.entity)));
  if (kinds.size !== 1) violations.push(`rooms of more than one measurement: ${[...kinds].join(", ")}`);
  const kind = [...kinds][0];
  if (new Set(rooms.map((room) => room.entity)).size !== rooms.length) violations.push("an entity is offered twice");
  if (new Set(rooms.map((room) => room.name)).size !== rooms.length) violations.push("a name is offered twice");
  const areas = rooms.map((room) => areaOf(hass, room.entity));
  const placed = areas.filter(Boolean).map((area) => area.id);
  if (new Set(placed).size !== placed.length) violations.push("two rooms share an area");

  const byArea = rooms.every((room, index) => areas[index] && areas[index].name === room.name);
  const byName = rooms.every((room) => (hass.states[room.entity].attributes.friendly_name ?? "").trim() === room.name);
  if (!byArea && !byName) violations.push("room names are neither all area names nor all friendly names");

  // Two named areas of the chosen measurement: every room is an area, up to three of them.
  const kindIds = ids.filter((id) => declaredKind(hass, id) === kind && qualifies(hass, id, { usable: usablePass, isUsable }));
  const areaNames = new Set(kindIds.map((id) => areaOf(hass, id)?.name).filter(Boolean));
  if (areaNames.size >= 2 && (!byArea || rooms.length !== Math.min(3, areaNames.size))) {
    violations.push(`${areaNames.size} named areas qualify, yet the rooms are not ${Math.min(3, areaNames.size)} areas`);
  }

  // The priority rule over the measurements alone, and the chosen one's rooms do not depend on
  // the other measurements present.
  const expected = PRIORITY.find((other) => aloneRooms[other].length >= 2) || PRIORITY.find((other) => aloneRooms[other].length >= 1);
  if (expected !== kind) violations.push(`${kind} was chosen, but the priority rule gives ${expected}`);
  else if (JSON.stringify(aloneRooms[kind]) !== JSON.stringify(rooms)) violations.push(`the ${kind} rooms change with the other measurements present`);

  // Arrival order is not a preference.
  const reversed = { ...description, sensors: [...description.sensors].reverse(), devices: reversedRecord(description.devices) };
  if (JSON.stringify(stubFor(reversed)) !== JSON.stringify(stub)) violations.push("the rooms depend on arrival order");

  // Nothing that can never be found changes what is found.
  const distracted = { ...description, sensors: [...description.sensors, ...DISTRACTORS.map(([label, domain, attributes, extra], index) => ({ id: `${domain}.late_${label}_${index}`, state: 42, attributes: { ...attributes }, name: `Late ${index}`, registry: { ...extra, area_id: description.areas[0]?.[0] } }))] };
  if (JSON.stringify(stubFor(distracted)) !== JSON.stringify(stub)) violations.push("a distractor changed the rooms");

  return { violations, stub, outcome: { rooms: rooms.length, kind, naming: byArea ? "area" : "name", pass: usablePass ? "usable" : "declared" } };
}

// ------------------------------------------------------------------- shrinking --

// Remove sensors, then areas, then devices, one at a time, while the same violations persist.
function shrinkInstallation(description, stillFails) {
  let current = description;
  let steps = 0;
  const attempt = (candidate) => {
    if (!stillFails(candidate)) return false;
    current = candidate;
    steps += 1;
    return true;
  };
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let index = current.sensors.length - 1; index >= 0; index--) {
      if (attempt({ ...current, sensors: current.sensors.filter((_, other) => other !== index) })) progressed = true;
    }
    for (let index = current.areas.length - 1; index >= 0; index--) {
      if (attempt({ ...current, areas: current.areas.filter((_, other) => other !== index) })) progressed = true;
    }
    for (const deviceId of Object.keys(current.devices)) {
      const devices = { ...current.devices };
      delete devices[deviceId];
      if (attempt({ ...current, devices })) progressed = true;
    }
  }
  return { description: current, steps };
}

module.exports = { DISCOVERY_WEIGHTS, DISTRACTORS, generateInstallation, checkDiscovery, shrinkInstallation, qualifies, declaredKind, areaOf };

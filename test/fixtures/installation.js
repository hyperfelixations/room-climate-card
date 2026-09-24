"use strict";

// A Home Assistant installation as the frontend hands it to the card picker: `states` plus the
// entity, device and area registries (`hass.entities`, `hass.devices`, `hass.areas`). Areas
// keep the order they are listed in, as the frontend builds `hass.areas` in the order the user
// arranged them. A sensor with `registry: null` has no registry entry, like a YAML template
// sensor without a unique_id.

// { areas: [[id, name], …], devices: { id: { area_id, parent_device_id } }, sensors: [sensor(…)] }
function installation({ areas = [], devices = {}, sensors = [] } = {}) {
  const hass = { states: {}, entities: {}, devices: {}, areas: {} };
  for (const [areaId, name] of areas) hass.areas[areaId] = { area_id: areaId, name, floor_id: null, labels: [] };
  for (const [deviceId, device] of Object.entries(devices)) hass.devices[deviceId] = { id: deviceId, area_id: null, ...device };
  for (const { id, state, attributes, name, registry } of sensors) {
    hass.states[id] = {
      entity_id: id,
      state: String(state),
      attributes: name === undefined ? { ...attributes } : { ...attributes, friendly_name: name },
      last_changed: "2026-09-23T08:00:00+00:00",
      last_updated: "2026-09-23T08:00:00+00:00",
    };
    if (registry !== null) hass.entities[id] = { entity_id: id, labels: [], ...registry };
  }
  return hass;
}

// One entity. `registry` is its hass.entities entry ({ area_id, device_id, hidden,
// entity_category }), or null for none.
function sensor(id, attributes, { state = 21.5, name, registry = {} } = {}) {
  return { id, attributes, state, name, registry };
}

module.exports = { installation, sensor };

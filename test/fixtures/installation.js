"use strict";

// A Home Assistant installation as the frontend hands it to the card picker: `states` plus the
// entity, device and area registries (`hass.entities`, `hass.devices`, `hass.areas`). Areas
// keep the order they are listed in, as the frontend builds `hass.areas` in the order the user
// arranged them. A sensor with `registry: null` has no registry entry, like a YAML template
// sensor without a unique_id. With `formatter: true` the installation also has
// `hass.formatEntityName()`, the name the frontend shows (Home Assistant 2026.4 and later).

// The frontend's entity name: a sensor's `systemName` as given (`{ throws: true }` throws), else
// what Home Assistant falls back to without a registry name — the friendly_name, else the object id.
function formatEntityNameOf(systemNames) {
  return (stateObject) => {
    const entityId = stateObject.entity_id;
    if (Object.hasOwn(systemNames, entityId)) {
      const name = systemNames[entityId];
      if (name !== null && typeof name === "object" && name.throws) throw new Error(`no name for ${entityId}`);
      return name;
    }
    const friendly = stateObject.attributes.friendly_name;
    return friendly !== undefined ? friendly : entityId.slice(entityId.indexOf(".") + 1).replace(/_/g, " ");
  };
}

// { areas: [[id, name], …], devices: { id: { area_id, parent_device_id } }, sensors: [sensor(…)], formatter }
function installation({ areas = [], devices = {}, sensors = [], formatter = false } = {}) {
  const hass = { states: {}, entities: {}, devices: {}, areas: {} };
  const systemNames = {};
  for (const [areaId, name] of areas) hass.areas[areaId] = { area_id: areaId, name, floor_id: null, labels: [] };
  for (const [deviceId, device] of Object.entries(devices)) hass.devices[deviceId] = { id: deviceId, area_id: null, ...device };
  for (const { id, state, attributes, name, registry, systemName } of sensors) {
    hass.states[id] = {
      entity_id: id,
      state: String(state),
      attributes: name === undefined ? { ...attributes } : { ...attributes, friendly_name: name },
      last_changed: "2026-09-23T08:00:00+00:00",
      last_updated: "2026-09-23T08:00:00+00:00",
    };
    if (registry !== null) hass.entities[id] = { entity_id: id, labels: [], ...registry };
    if (systemName !== undefined) systemNames[id] = systemName;
  }
  if (formatter) hass.formatEntityName = formatEntityNameOf(systemNames);
  return hass;
}

// One entity. `registry` is its hass.entities entry ({ area_id, device_id, hidden,
// entity_category }), or null for none; `systemName` is what formatEntityName() returns for it.
function sensor(id, attributes, { state = 21.5, name, registry = {}, systemName } = {}) {
  return systemName === undefined ? { id, attributes, state, name, registry } : { id, attributes, state, name, registry, systemName };
}

module.exports = { installation, sensor };

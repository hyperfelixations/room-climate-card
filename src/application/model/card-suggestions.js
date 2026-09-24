// Total card-picker helpers for entity-first suggestions and the browse path's start rooms.
// Both reuse runtime metric detection and guard arbitrary frontend inputs without catch-all
// error suppression. Details: see internal dev doc §4 "Card-Picker-Vertrag".

import { CARD_TYPE } from "../../core/card-metadata.js";
import { classifyDeviceClass } from "../../domain/metrics/resolution.js";
import { AVAILABILITY, buildEntityModel, metricKindForEntity } from "./entity-model.js";

// Derive the picker type from the custom-element registration constant.
const CONFIG_TYPE = `custom:${CARD_TYPE}`;

// Browse-only product policy, not YAML: "rooms", "entity", or "template".
export const BROWSE_DISCOVERY = "rooms";

// Enough to demonstrate comparison without filling the preview.
export const BROWSE_ROOM_LIMIT = 3;

// The first kind filling two rooms wins; failing that, the first filling one.
export const BROWSE_KIND_PRIORITY = Object.freeze(["temperature", "humidity", "co2", "pm25"]);

// Preserve the documented teaching shape when no real candidate exists.
function templateConfig() {
  return {
    entity: "sensor.house_temperature",
    rooms: [
      { name: "Kitchen", short: "KI", entity: "sensor.kitchen_temperature" },
      { name: "Bedroom", short: "BE", entity: "sensor.bedroom_temperature" },
      { name: "Living Room", short: "LR", entity: "sensor.living_room_temperature" },
    ],
  };
}

// Browse discovers measurements only; the explicit entity path accepts any supported domain.
const SENSOR_DOMAIN = "sensor.";

function isSupportedEntity(states, entityId) {
  return typeof entityId === "string" && Boolean(metricKindForEntity(states, entityId));
}

// Explicitly selected unavailable entities remain valid suggestions; unsupported ones do not.
export function suggestionsForEntity(states, entityId) {
  if (!isSupportedEntity(states, entityId)) return null;
  return { config: { type: CONFIG_TYPE, entity: entityId } };
}

// Frontend inputs are read as plain records, and only through their own keys.
function recordOf(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function entryOf(record, key) {
  return record && typeof key === "string" && Object.hasOwn(record, key) ? recordOf(record[key]) : null;
}

function textOf(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idOf(value) {
  return typeof value === "string" && value ? value : null;
}

// hass.areas lists areas in the order the user arranged them; that order ranks rooms.
function readInstallation(hass) {
  const source = recordOf(hass);
  const areas = recordOf(source?.areas);
  return {
    states: recordOf(source?.states),
    entities: recordOf(source?.entities),
    devices: recordOf(source?.devices),
    areas,
    areaRank: new Map((areas ? Object.keys(areas) : []).map((areaId, rank) => [areaId, rank])),
  };
}

// As the frontend's getEntityAreaId(): the entity's area, else its device's, else the parent device's.
function areaOf(installation, registryEntry) {
  const device = entryOf(installation.devices, registryEntry?.device_id);
  const parent = entryOf(installation.devices, device?.parent_device_id);
  const areaId = idOf(registryEntry?.area_id) || idOf(device?.area_id) || idOf(parent?.area_id);
  const name = textOf(entryOf(installation.areas, areaId)?.name);
  return name ? { id: areaId, name, rank: installation.areaRank.get(areaId) } : null;
}

// Sensors declaring one of the card's device classes (never inferred from a unit), not hidden
// or categorized, in entity-id order; `usable` also requires what the runtime would average.
function candidatesOf(installation, { usable }) {
  const { states } = installation;
  if (!states) return [];
  const candidates = [];
  for (const entityId of Object.keys(states).sort()) {
    if (!entityId.startsWith(SENSOR_DOMAIN)) continue;
    const attributes = recordOf(recordOf(states[entityId])?.attributes);
    const { metricKind } = classifyDeviceClass(attributes?.device_class);
    if (!metricKind) continue;
    const registryEntry = entryOf(installation.entities, entityId);
    if (registryEntry?.hidden === true || textOf(registryEntry?.entity_category)) continue;
    if (usable && buildEntityModel(states, null, entityId, "room").availability !== AVAILABILITY.USABLE) continue;
    candidates.push({ entityId, metricKind, area: areaOf(installation, registryEntry), friendlyName: textOf(attributes.friendly_name) });
  }
  return candidates;
}

// One room per area, named after it, in area order.
function areaRooms(candidates) {
  const firstInArea = new Map();
  for (const candidate of candidates) {
    if (candidate.area && !firstInArea.has(candidate.area.id)) firstInArea.set(candidate.area.id, candidate);
  }
  const rooms = [];
  const names = new Set();
  for (const { area, entityId } of [...firstInArea.values()].sort((a, b) => a.area.rank - b.area.rank)) {
    if (rooms.length >= BROWSE_ROOM_LIMIT) break;
    if (names.has(area.name)) continue;
    names.add(area.name);
    rooms.push({ name: area.name, entity: entityId });
  }
  return rooms;
}

// Still one room per area, but named by friendly_name, so area-less sensors can join.
function namedRooms(candidates) {
  const placed = candidates.filter((candidate) => candidate.area).sort((a, b) => a.area.rank - b.area.rank);
  const rooms = [];
  const areas = new Set();
  const names = new Set();
  for (const { area, entityId, friendlyName } of [...placed, ...candidates.filter((candidate) => !candidate.area)]) {
    if (rooms.length >= BROWSE_ROOM_LIMIT) break;
    if ((area && areas.has(area.id)) || !friendlyName || names.has(friendlyName)) continue;
    if (area) areas.add(area.id);
    names.add(friendlyName);
    rooms.push({ name: friendlyName, entity: entityId });
  }
  return rooms;
}

// Names are never mixed: area names once two areas qualify, else whichever plan reaches more rooms.
function roomsOf(candidates) {
  const byArea = areaRooms(candidates);
  if (byArea.length >= 2) return byArea;
  const byName = namedRooms(candidates);
  return byName.length > byArea.length ? byName : byArea;
}

function discoverRooms(installation, phase) {
  const candidates = candidatesOf(installation, phase);
  let fallback = null;
  for (const metricKind of BROWSE_KIND_PRIORITY) {
    const rooms = roomsOf(candidates.filter((candidate) => candidate.metricKind === metricKind));
    if (rooms.length >= 2) return rooms;
    if (rooms.length && !fallback) fallback = rooms;
  }
  return fallback;
}

// Usable sensors first, then merely declared ones (a restart window), then the template.
export function stubConfigFor(hass, options) {
  const discovery = options?.discovery ?? BROWSE_DISCOVERY;
  if (discovery === "template") return templateConfig();
  const installation = readInstallation(hass);
  const rooms = discoverRooms(installation, { usable: true }) || discoverRooms(installation, { usable: false });
  if (!rooms) return templateConfig();
  return discovery === "entity" ? { entity: rooms[0].entity } : { rooms };
}

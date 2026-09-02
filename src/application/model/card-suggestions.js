// Total card-picker helpers for entity-first suggestions and browse-path stubs.
// Both reuse runtime metric detection and guard arbitrary frontend inputs without catch-all
// error suppression. Details: internal docs §4 “Card-Picker-Vertrag”.

import { CARD_TYPE } from "../../core/card-metadata.js";
import { AVAILABILITY, buildEntityModel, metricKindForEntity } from "./entity-model.js";

// Derive the picker type from the custom-element registration constant.
const CONFIG_TYPE = `custom:${CARD_TYPE}`;

// Browse-only product policy, not YAML: "entity-and-rooms", "entity", or "template".
export const BROWSE_DISCOVERY = "entity-and-rooms";

// Enough to demonstrate comparison without filling the preview.
const BROWSE_ROOM_LIMIT = 3;

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

function isBrowsableEntity(states, entityId) {
  return typeof entityId === "string" && entityId.startsWith(SENSOR_DOMAIN) && isSupportedEntity(states, entityId);
}

// Reuse EntityModel so picker and runtime agree on current usability.
function isUsableEntity(states, entityId) {
  if (!isBrowsableEntity(states, entityId)) return false;
  return buildEntityModel(states, null, entityId, "primary").availability === AVAILABILITY.USABLE;
}

// Explicitly selected unavailable entities remain valid suggestions; unsupported ones do not.
export function suggestionsForEntity(states, entityId) {
  if (!isSupportedEntity(states, entityId)) return null;
  return { config: { type: CONFIG_TYPE, entity: entityId } };
}

// Preserve Home Assistant's preferred lists, then append remaining state ids without repeats.
function browseCandidates(states, entities, entitiesFallback) {
  // Sort only the fallback state scan; supplied list order is a preference.
  const all = states && typeof states === "object" ? Object.keys(states).sort() : [];
  const ordered = [...[entities, entitiesFallback].filter(Array.isArray).flat(), ...all];
  return [...new Set(ordered.filter((entityId) => typeof entityId === "string"))];
}

// Offer usable, named rooms of the primary metric; bare entity-id chips are omitted.
function browseRooms(states, candidates, primary) {
  const kind = metricKindForEntity(states, primary);
  const rooms = [];
  for (const entityId of candidates) {
    if (rooms.length >= BROWSE_ROOM_LIMIT) break;
    if (entityId === primary) continue;
    // Never construct a cross-metric average.
    if (metricKindForEntity(states, entityId) !== kind) continue;
    if (!isUsableEntity(states, entityId)) continue;
    const name = states?.[entityId]?.attributes?.friendly_name;
    if (typeof name !== "string" || !name.trim()) continue;
    rooms.push({ name: name.trim(), entity: entityId });
  }
  return rooms;
}

// Prefer any usable sensor over every merely recognized one; use the template last.
export function stubConfigFor(states, entities, entitiesFallback) {
  if (BROWSE_DISCOVERY === "template") return templateConfig();

  const candidates = browseCandidates(states, entities, entitiesFallback);
  const primary =
    candidates.find((entityId) => isUsableEntity(states, entityId)) ||
    candidates.find((entityId) => isBrowsableEntity(states, entityId));
  if (!primary) return templateConfig();

  if (BROWSE_DISCOVERY !== "entity-and-rooms") return { entity: primary };
  const rooms = browseRooms(states, candidates, primary);
  return rooms.length ? { entity: primary, rooms } : { entity: primary };
}

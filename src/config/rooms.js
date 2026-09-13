// Normalizing the `rooms:` list. A structurally unusable room refuses the configuration, and
// room entities must be unique: downstream stages key rooms by entity id (keyed chip patching
// maps DOM nodes by data-entity), so a duplicate would collide on one node rather than be
// special-cased. A room's label and actions fall back with a warning.

import { createDiagnostic, FALLBACK } from "../core/diagnostics.js";
import { normalizeAction } from "./actions.js";
import { rejectConfiguration } from "./errors.js";
import { assertKnownKeys, isPlainObject, isUnwritten, requiredEntity } from "./primitives.js";

export const ROOM_KEYS = Object.freeze(["entity", "name", "short", "tap_action", "hold_action"]);

// A room's name or short label: text, or a number, which is how YAML writes a room number.
function readRoomLabel(value, path, diagnostics) {
  if (isUnwritten(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback: FALLBACK.AUTOMATIC }));
  return null;
}

// Converts one config room entry into an internal room object: its keys first, then its
// entity, then what it is called.
export function normalizeRoom(room, index, diagnostics) {
  const path = `rooms[${index}]`;
  if (!isPlainObject(room)) rejectConfiguration("config.must_be_object", { key: path });
  assertKnownKeys(room, ROOM_KEYS, path);

  const entity = requiredEntity(room.entity, `${path}.entity`);
  const name = readRoomLabel(room.name, `${path}.name`, diagnostics);
  const short = readRoomLabel(room.short, `${path}.short`, diagnostics);

  return {
    name: name ?? short ?? entity,
    short: short ?? name ?? entity,
    entity,
    // Per-room action overrides; null means "inherit the card-level
    // tap_action/hold_action".
    tap_action: normalizeAction(room.tap_action, `${path}.tap_action`, diagnostics, null),
    hold_action: normalizeAction(room.hold_action, `${path}.hold_action`, diagnostics, null),
  };
}

// The whole list, in declaration order, with the uniqueness guarantee applied.
export function normalizeRooms(input, diagnostics) {
  if (!Array.isArray(input)) rejectConfiguration("config.must_be_list", { key: "rooms" });
  const rooms = input.map((room, index) => normalizeRoom(room, index, diagnostics));

  const seenRoomEntities = new Set();
  for (const room of rooms) {
    if (seenRoomEntities.has(room.entity)) rejectConfiguration("config.duplicate_room", { entity: room.entity });
    seenRoomEntities.add(room.entity);
  }
  return rooms;
}

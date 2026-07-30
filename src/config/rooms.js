// Normalizing the `rooms:` list.
//
// A room is rejected outright when it is structurally unusable, because every
// downstream stage indexes rooms by their entity id: the keyed chip patching
// maps DOM nodes by data-entity, and the per-room action overrides are looked up
// by list index. A duplicate entity would silently overwrite one node in that
// map, leaving one room unpatched or two models fighting over one chip — hence
// the explicit uniqueness check rather than an occurrence-suffixed secondary key
// that every consumer would have to special-case.

import { normalizeAction } from "./actions.js";
import { isPlainObject, requiredEntity, stringOrDefault } from "./primitives.js";

// Converts one config room entry into an internal room object.
export function normalizeRoom(room, index) {
  if (!isPlainObject(room)) {
    throw new Error(`Invalid configuration: rooms[${index}] must be an object.`);
  }

  const entity = requiredEntity(room.entity, `rooms[${index}].entity`);
  const name = stringOrDefault(room.name, room.short || entity);
  const short = stringOrDefault(room.short, name || entity);

  return {
    name,
    short,
    entity,
    // Per-room action overrides; null means "inherit the card-level
    // tap_action/hold_action".
    tap_action: normalizeAction(room.tap_action, null),
    hold_action: normalizeAction(room.hold_action, null),
  };
}

// The whole list, in declaration order, with the uniqueness guarantee applied.
export function normalizeRooms(roomsInput) {
  if (!Array.isArray(roomsInput)) {
    throw new Error("Invalid configuration: rooms must be an array.");
  }
  const rooms = roomsInput.map((room, index) => normalizeRoom(room, index));

  const seenRoomEntities = new Set();
  for (const room of rooms) {
    if (seenRoomEntities.has(room.entity)) {
      throw new Error(`Invalid configuration: duplicate rooms[].entity "${room.entity}" — each room must reference a unique entity.`);
    }
    seenRoomEntities.add(room.entity);
  }
  return rooms;
}

// Normalizing the `rooms:` list. A structurally unusable room is rejected outright,
// and room entities must be unique: downstream stages key rooms by entity id (keyed
// chip patching maps DOM nodes by data-entity), so a duplicate would collide on one
// node rather than be special-cased.

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

// Which sources a card is CONFIGURED with, and what that makes the headline value.
//
// One pure function over the normalized configuration, and the only place this is
// decided. Four consumers ask it — the measurement context, the headline label, the
// chip-visibility policy and the card's size hint — and they must not be able to
// disagree, because between them they decide what the big number IS, what it is called,
// whether it can be clicked, and whether the room it came from also gets a chip.
//
// CONFIGURATION, NOT AVAILABILITY. This reads `config` only. A sensor that drops out
// changes the VALUE the card can show; it must never change what kind of card this is.
// Deciding the mode from live availability would make a two-room card relabel its
// headline to a room name and turn it into a button the moment one of the two sensors
// went quiet — and back again when it returned. The value falls back, the identity does
// not.

export const SOURCE_TOPOLOGY = {
  // `entity` alone. The headline is that sensor and nothing on the card competes with
  // it, so it needs no label to tell it apart from anything.
  PRIMARY_ONLY: "primaryOnly",
  // The whole card refers to exactly one entity, and that entity is a room. Covers both
  // "one room, no entity" and "entity that IS the one configured room" — they are the
  // same card, written two ways.
  SINGLE_ROOM: "singleRoom",
  // `entity` plus rooms that are something else. The headline is the primary; the rooms
  // are context beside it.
  PRIMARY_WITH_ROOMS: "primaryWithRooms",
  // No `entity`, several rooms. The headline is computed from them and belongs to no
  // single entity.
  ROOM_CONSENSUS: "roomConsensus",
};

// Returns { kind, headlineEntity, roomIndex }.
//
//   headlineEntity  the entity the big number represents, or null when it is computed
//   roomIndex       the configured room that entity IS, or null
//
// roomIndex is set ONLY for SINGLE_ROOM, and that restriction is deliberate. A card
// configured as `entity: sensor.a` with rooms `[sensor.a, sensor.b, sensor.c]` is a
// whole-home card that happens to list its primary among the rooms; labelling its
// headline "Kitchen" and giving it Kitchen's tap action would be wrong. Only when the
// card refers to exactly one entity, and that entity is the one room, is the headline
// genuinely that room.
export function resolveSourceTopology(config) {
  const entity = config?.entity || null;
  const rooms = config?.rooms || [];
  const distinctSources = new Set([entity, ...rooms.map((room) => room.entity)].filter(Boolean));

  if (rooms.length === 1 && distinctSources.size === 1) {
    return { kind: SOURCE_TOPOLOGY.SINGLE_ROOM, headlineEntity: rooms[0].entity, roomIndex: 0 };
  }
  if (!entity) {
    return { kind: SOURCE_TOPOLOGY.ROOM_CONSENSUS, headlineEntity: null, roomIndex: null };
  }
  if (rooms.length === 0) {
    return { kind: SOURCE_TOPOLOGY.PRIMARY_ONLY, headlineEntity: entity, roomIndex: null };
  }
  return { kind: SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS, headlineEntity: entity, roomIndex: null };
}

// Whether the chip grid would only repeat the headline. True for exactly the card whose
// single room IS the big number — a chip there is the same value twice.
export function chipsWouldDuplicateHeadline(topology) {
  return topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM;
}

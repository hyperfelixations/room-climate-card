// Which sources a card is CONFIGURED with, and what that makes the headline value.
//
// One pure function over the normalized configuration, and the only place this is
// decided. Four consumers ask it — the measurement context, the headline label, the
// chip-visibility policy and the card's size hint — and they must not be able to
// disagree, because between them they decide what the big number IS, what it is called,
// whether it can be clicked, and whether the room it came from also gets a chip.
//
// CONFIGURATION, NOT AVAILABILITY — and the difference between the two is exact.
//
// A sensor that drops out changes the VALUE the card can show; it must never change
// what kind of card this is. Deciding the mode from live availability would make a
// two-room card relabel its headline to a room name and turn it into a button the
// moment one of the two sensors went quiet — and back again when it returned. The value
// falls back, the identity does not.
//
// An entity id Home Assistant does not know at all is a different thing entirely, and
// it is NOT an outage. Home Assistant keeps registered entities in the state machine
// even while their integration is unloaded: it publishes them as `unavailable` carrying
// `attributes.restored === true`, rather than removing them. So an id that is absent
// from `hass.states` is absent because it was mistyped, never existed, or was deleted —
// a property of the configuration, stable until the user edits the YAML.
//
// Such a source therefore does not count towards the card's shape. A card configured
// with one real room and one typo IS a one-room card, and must present itself as one:
// no chip repeating its own headline, the room's name as the caption, the room's own
// actions on the big value. The typo is reported in the subtitle, not by silently
// reshaping the card around it.

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
//
// `isKnownEntity` answers "does Home Assistant have this id at all" (see the note above
// on why that is a configuration question). It is OPTIONAL: without it every configured
// source counts, which is what a caller holding only the configuration — the size hint
// before the first update, and the pure-function tests — should see.
export function resolveSourceTopology(config, isKnownEntity) {
  const entity = config?.entity || null;
  const rooms = config?.rooms || [];

  const known = typeof isKnownEntity === "function" ? isKnownEntity : () => true;
  const knownEntity = entity && known(entity) ? entity : null;
  // Carries the CONFIGURED index, not the position in this filtered list: a roomIndex is
  // used to look the room up in config.rooms again, so narrowing it here would silently
  // point at the wrong room whenever the surviving one is not the first.
  const knownRooms = rooms.map((room, index) => ({ index, entity: room.entity })).filter((room) => known(room.entity));

  // Nothing the card was configured with exists. Shrinking to "no sources" would strip
  // the card of the identity its YAML gives it, so the configuration alone decides —
  // which is also what keeps a card stable through the moment during a Home Assistant
  // start where states have not been published yet.
  const effectiveEntity = !knownEntity && knownRooms.length === 0 ? entity : knownEntity;
  const effectiveRooms =
    !knownEntity && knownRooms.length === 0 ? rooms.map((room, index) => ({ index, entity: room.entity })) : knownRooms;

  const distinctSources = new Set([effectiveEntity, ...effectiveRooms.map((room) => room.entity)].filter(Boolean));

  if (effectiveRooms.length === 1 && distinctSources.size === 1) {
    const room = effectiveRooms[0];
    return { kind: SOURCE_TOPOLOGY.SINGLE_ROOM, headlineEntity: room.entity, roomIndex: room.index };
  }
  if (!effectiveEntity) {
    return { kind: SOURCE_TOPOLOGY.ROOM_CONSENSUS, headlineEntity: null, roomIndex: null };
  }
  if (effectiveRooms.length === 0) {
    return { kind: SOURCE_TOPOLOGY.PRIMARY_ONLY, headlineEntity: effectiveEntity, roomIndex: null };
  }
  return { kind: SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS, headlineEntity: effectiveEntity, roomIndex: null };
}

// Whether the chip grid would only repeat the headline. True for exactly the card whose
// single room IS the big number — a chip there is the same value twice.
export function chipsWouldDuplicateHeadline(topology) {
  return topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM;
}

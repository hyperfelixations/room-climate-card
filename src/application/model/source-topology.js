// Which sources a card HAS, and what that makes the headline value.
//
// The only place this is decided, in two steps: resolveSourceEligibility() says which
// configured ids are sources, and resolveSourceTopology() turns those into one of four
// shapes. Four consumers read the answer — the measurement context, the headline label,
// the chip-visibility policy and the card's size hint — and they must not be able to
// disagree, because between them they decide what the big number IS, what it is called,
// whether it can be clicked, and whether the room it came from also gets a chip.
//
// The shaping step is pure over the normalized configuration and a predicate. Only the
// eligibility step reads `states`, and only for what an entity DECLARES.
//
// DECLARATION, NOT AVAILABILITY — and the difference between the two is exact.
//
// A sensor that drops out changes the VALUE the card can show; it must never change
// what kind of card this is. Deciding the mode from live availability would make a
// two-room card relabel its headline to a room name and turn it into a button the
// moment one of the two sensors went quiet — and back again when it returned. The value
// falls back, the identity does not.
//
// What DOES decide the shape is whether a configured id is a source of THIS card at all,
// and that question has two halves. Both are stable properties rather than readings, and
// resolveSourceEligibility() below answers them together.
//
// FIRST: AN ID HOME ASSISTANT DOES NOT KNOW IS NOT A SOURCE, and that is NOT an outage.
// Home Assistant keeps registered entities in the state machine even while their
// integration is unloaded: it publishes them as `unavailable` carrying
// `attributes.restored === true`, rather than removing them. So an id that is absent
// from `hass.states` is absent because it was mistyped, never existed, or was deleted —
// a property of the configuration, stable until the user edits the YAML.
//
// A card configured with one real room and one typo IS a one-room card, and must present
// itself as one: no chip repeating its own headline, the room's name as the caption, the
// room's own actions on the big value. The typo is reported in the subtitle, not by
// silently reshaping the card around it.
//
// SECOND: A ROOM THAT MEASURES SOMETHING ELSE IS NOT A SOURCE EITHER. `device_class` is a
// statement about a SENSOR, not a reading — the same rule measurement-context.js arbitrates
// on — so a room declaring a different measurement than the primary declares is data this
// card can never show, however healthy the sensor is. Counting it made a card whose only
// usable source was a room stop being a single-room card the moment a thermometer was
// listed on a humidity card: same number, same position on the scale, different caption
// and a different tap target.
//
// That second half is deliberately narrow, and each boundary is load-bearing:
//
//   - It asks what a source DECLARES, never what it currently reads. The restored state
//     above carries `device_class` and `unit_of_measurement` (Home Assistant writes them
//     from the entity registry), so the declaration survives the outage and the card's
//     shape does not flicker while an integration reloads.
//   - It is not "can the card use this room right now". An unreadable unit turns into
//     plain `unavailable` the moment the same sensor drops out, so a topology built on
//     usability WOULD switch shape during an outage.
//   - It applies only where the PRIMARY declares a kind. Without an arbiter the rooms
//     decide among themselves, and filtering them against one of their own would turn a
//     card that correctly reports mixed measurements into a single-room card.

import { hasEntity, metricKindForEntity } from "./entity-model.js";

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
// `isSource` answers "is this configured id a source of this card" — see the two halves
// of that question in the note above, and resolveSourceEligibility() for the production
// answer. It is OPTIONAL: without it every configured source counts, which is what a
// caller holding only the configuration — the size hint before the first update, and the
// pure-function tests — should see.
export function resolveSourceTopology(config, isSource) {
  const entity = config?.entity || null;
  const rooms = config?.rooms || [];

  const counts = typeof isSource === "function" ? isSource : () => true;
  const countedEntity = entity && counts(entity) ? entity : null;
  // Carries the CONFIGURED index, not the position in this filtered list: a roomIndex is
  // used to look the room up in config.rooms again, so narrowing it here would silently
  // point at the wrong room whenever the surviving one is not the first.
  const countedRooms = rooms.map((room, index) => ({ index, entity: room.entity })).filter((room) => counts(room.entity));

  // Nothing the card was configured with is a source. Shrinking to "no sources" would
  // strip the card of the identity its YAML gives it, so the configuration alone decides —
  // which is also what keeps a card stable through the moment during a Home Assistant
  // start where states have not been published yet.
  const effectiveEntity = !countedEntity && countedRooms.length === 0 ? entity : countedEntity;
  const effectiveRooms =
    !countedEntity && countedRooms.length === 0 ? rooms.map((room, index) => ({ index, entity: room.entity })) : countedRooms;

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

// The production answer to "is this configured id a source of this card", as a predicate
// over one set of states. Both halves of the question are settled here so that all four
// consumers of resolveSourceTopology() ask it the same way.
//
// Cheap on purpose: two attribute reads per id, no EntityModel. What it needs is what an
// entity DECLARES, and that is `device_class` first, then a unit only one measurement
// uses — exactly what metricKindForEntity() answers, and exactly what buildEntityModel()
// puts in `metricKind`, so the two can never disagree about a source.
//
// A room whose kind cannot be determined at all stays a source. That is the conservative
// half: `metricKind === null` is an absence of information rather than a contradiction,
// and partitionRooms() in measurement-context.js draws the same line — it excludes and
// diagnoses a room of a FOREIGN kind, and passes over an unidentified one in silence.
export function resolveSourceEligibility(states, config) {
  const declaredKind = metricKindForEntity(states, config?.entity || null);
  return (entityId) => {
    if (!hasEntity(states, entityId)) return false;
    if (!declaredKind) return true;
    const kind = metricKindForEntity(states, entityId);
    return kind === null || kind === declaredKind;
  };
}

// Whether the chip grid would only repeat the headline. True for exactly the card whose
// single room IS the big number — a chip there is the same value twice.
export function chipsWouldDuplicateHeadline(topology) {
  return topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM;
}

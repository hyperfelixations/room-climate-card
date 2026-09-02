// Source identity is decided only here: eligibility filters declarations, topology shapes them.
// Declaration, not live availability, owns card form; outages may change only the value.
// Unknown ids are not sources. Foreign-kind rooms are excluded only when a primary declares
// the card kind; unreadable and untyped rooms remain availability/arbitration concerns.
// Details: internal docs §3 “EntityModel und MeasurementContext”.

import { hasEntity, metricKindForEntity } from "./entity-model.js";

export const SOURCE_TOPOLOGY = {
  // One primary source; headline needs no distinguishing label.
  PRIMARY_ONLY: "primaryOnly",
  // Exactly one distinct entity, and it is a configured room.
  SINGLE_ROOM: "singleRoom",
  // Primary headline with room context.
  PRIMARY_WITH_ROOMS: "primaryWithRooms",
  // Room-derived headline with no owning entity.
  ROOM_CONSENSUS: "roomConsensus",
};

// Returns { kind, headlineEntity, roomIndex }. `roomIndex` belongs only to SINGLE_ROOM;
// a primary repeated among several rooms is still a primary. Without `isSource`, every
// configured source counts for pre-hass size hints and pure configuration calls.
export function resolveSourceTopology(config, isSource) {
  const entity = config?.entity || null;
  const rooms = config?.rooms || [];

  const counts = typeof isSource === "function" ? isSource : () => true;
  const countedEntity = entity && counts(entity) ? entity : null;
  // Preserve the config index; filtered position would address the wrong room.
  const countedRooms = rooms.map((room, index) => ({ index, entity: room.entity })).filter((room) => counts(room.entity));

  // If no state-backed source exists yet, retain YAML identity through HA startup.
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

// Production eligibility reads declarations cheaply through the same metric resolver as
// EntityModel. An unidentified room remains a source: missing information is not contradiction.
export function resolveSourceEligibility(states, config) {
  const declaredKind = metricKindForEntity(states, config?.entity || null);
  return (entityId) => {
    if (!hasEntity(states, entityId)) return false;
    if (!declaredKind) return true;
    const kind = metricKindForEntity(states, entityId);
    return kind === null || kind === declaredKind;
  };
}

// A single-room chip would duplicate the headline value.
export function chipsWouldDuplicateHeadline(topology) {
  return topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM;
}

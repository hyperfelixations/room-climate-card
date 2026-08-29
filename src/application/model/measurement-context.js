// The atomic MeasurementContext: metric kind, current headline source,
// per-entity availability and display unit, decided from one set of EntityModels.
//
// Source topology is configuration-owned. Availability may change the value that
// can be shown (including the established primary-to-room-consensus fallback),
// but it never changes whether the configured card is primary-only, single-room,
// primary-with-rooms or room-consensus.

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { AVAILABILITY, UNUSABLE_REASON, buildEntityModel, hasEntity } from "./entity-model.js";
import { SOURCE_TOPOLOGY, resolveSourceTopology } from "./source-topology.js";

// Numeric consumers use this only after the no-data branch has returned. Display
// identity is deliberately allowed to remain null so the shell can use the
// untranslated product name when no configured source reveals a metric kind.
const FALLBACK_METRIC_KIND = "temperature";

function isUsable(model) {
  return model.availability === AVAILABILITY.USABLE;
}

function identityMetricKind(primary, rooms) {
  return primary.metricKind || rooms.find((room) => room.metricKind)?.metricKind || null;
}

// Which rooms may take part once the card's metric kind is settled, in configuration
// order, and why each of the others may not.
//
// ONE WALK, whether the kind came from a primary the card can read or from one that can
// only still declare what it measures. What decides is the KIND; who supplied it is a
// separate question, answered by the caller.
function partitionRooms(roomModels, metricKind) {
  const participatingRooms = [];
  const excludedRoomIds = [];
  const diagnostics = [];
  for (const room of roomModels) {
    if (room.metricKind === null) continue;
    if (room.metricKind !== metricKind) {
      excludedRoomIds.push(room.entityId);
      diagnostics.push({ code: "excluded_foreign_metric_kind", entityId: room.entityId, metricKind: room.metricKind });
      continue;
    }
    if (room.availability === AVAILABILITY.INCOMPATIBLE_UNIT) {
      excludedRoomIds.push(room.entityId);
      diagnostics.push({ code: "unusable_unit", entityId: room.entityId, metricKind: room.metricKind });
      continue;
    }
    if (isUsable(room)) participatingRooms.push(room);
  }
  return { participatingRooms, excludedRoomIds, diagnostics };
}

// The headline several rooms of one kind produce together, and the unit it can be shown
// in. A unit profile they all share survives; a mixture falls back to the canonical unit
// rather than preferring one room's unit for no reason.
function roomConsensus(rooms) {
  return {
    averageSource: {
      kind: "roomConsensus",
      entityIds: rooms.map((room) => room.entityId),
      canonicalValue: rooms.reduce((sum, room) => sum + room.canonicalValue, 0) / rooms.length,
      unitProfile: null,
    },
    displayUnitProfileKey: rooms.every((room) => room.unitProfile === rooms[0].unitProfile) ? rooms[0].unitProfile : null,
  };
}

// EntityModel owns intrinsic availability. MeasurementContext adds the one
// card-wide fact EntityModel cannot know: whether a recognized entity kind is
// compatible with the selected card kind.
//
// The two rewrites that DO change the reason are the two where the card-wide view is the
// reason: this source measures something else. The third does not touch it, deliberately
// — a sentinel value whose kind cannot be identified is still best explained by what its
// state actually is, and "unavailable" remains the more useful sentence than anything
// this function could add.
function withContextAvailability(model, metricKind, mixed) {
  if (!model.entityId) return model;
  if (
    mixed &&
    model.metricKind &&
    [AVAILABILITY.USABLE, AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE].includes(model.availability)
  ) {
    return { ...model, availability: AVAILABILITY.INCOMPATIBLE_KIND, unusableReason: UNUSABLE_REASON.KIND_MISMATCH };
  }
  if (
    metricKind &&
    model.metricKind &&
    model.metricKind !== metricKind &&
    [AVAILABILITY.USABLE, AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE].includes(model.availability)
  ) {
    return { ...model, availability: AVAILABILITY.INCOMPATIBLE_KIND, unusableReason: UNUSABLE_REASON.KIND_MISMATCH };
  }
  // A sentinel or malformed value without enough metadata to identify its
  // measurement kind cannot become a typed room placeholder.
  if (
    model.metricKind === null &&
    [AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE].includes(model.availability)
  ) {
    return { ...model, availability: AVAILABILITY.INCOMPATIBLE_KIND };
  }
  return model;
}

export function resolveMeasurementContext(states, config) {
  const primaryModel = buildEntityModel(states, config, config?.entity, "primary");
  const roomModels = (config?.rooms || []).map((room) => buildEntityModel(states, config, room.entity, "room"));
  const topology = resolveSourceTopology(config, (entityId) => hasEntity(states, entityId));
  const resolvedIdentityMetricKind = identityMetricKind(primaryModel, roomModels);

  let metricKind;
  let averageSource;
  let participatingRooms;
  let excludedRoomIds;
  let consistent;
  let diagnostics;
  let sourceEntity;
  let sourceKind;
  let displayUnitProfileKey;

  if (topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM) {
    // The topology's own index, never a hard 0: the one room the card refers to is not
    // necessarily the first one configured — the others may simply be ids Home Assistant
    // does not know.
    const room = roomModels[topology.roomIndex];
    metricKind = room.metricKind || null;
    excludedRoomIds = [];
    diagnostics = [];
    consistent = true;
    participatingRooms = isUsable(room) ? [room] : [];
    averageSource = isUsable(room)
      ? { kind: "roomDirect", entityId: room.entityId, canonicalValue: room.canonicalValue, unitProfile: room.unitProfile }
      : null;
    sourceEntity = room.entityId;
    sourceKind = "roomDirect";
    displayUnitProfileKey = isUsable(room) ? room.unitProfile : null;
  } else if (isUsable(primaryModel)) {
    metricKind = primaryModel.metricKind;
    ({ participatingRooms, excludedRoomIds, diagnostics } = partitionRooms(roomModels, metricKind));
    averageSource = {
      kind: "primary",
      entityId: primaryModel.entityId,
      canonicalValue: primaryModel.canonicalValue,
      unitProfile: primaryModel.unitProfile,
    };
    consistent = true;
    sourceEntity = primaryModel.entityId;
    sourceKind = "primary";
    displayUnitProfileKey = primaryModel.unitProfile;
  } else if (primaryModel.metricKind) {
    // THE PRIMARY CANNOT SUPPLY A VALUE, AND CAN STILL SAY WHAT THE CARD IS ABOUT.
    //
    // `device_class` is a statement about a SENSOR, not a reading: an unreachable
    // thermometer measures temperature all the same. source-topology.js already builds the
    // card's SHAPE on exactly that distinction — availability changes the value the card
    // can show, never what kind of card it is — and this is the same rule one layer down.
    // A declaration that survived the outage therefore settles which rooms belong here, by
    // the same walk a readable primary uses; only the VALUE falls back to them.
    //
    // Without it, a single humidity sensor among four thermometers blanked the whole card
    // the moment the thermometer feeding the average went offline: the rooms disagreed,
    // nobody was asked to settle it, and the answer that was available went unread.
    //
    // AN ENTITY HOME ASSISTANT DOES NOT KNOW DECLARES NOTHING — buildEntityModel() leaves
    // metricKind null without a state object — so a mistyped `entity:` still leaves the
    // rooms to agree among themselves or not, in the branch below. That is the difference
    // between an outage and a typo, and it is deliberate.
    metricKind = primaryModel.metricKind;
    ({ participatingRooms, excludedRoomIds, diagnostics } = partitionRooms(roomModels, metricKind));
    // Settled, not merely quiet: the rooms may well disagree with each other, but the
    // question of what this card measures has an answer, so nothing here is "mixed".
    consistent = true;
    if (participatingRooms.length) {
      ({ averageSource, displayUnitProfileKey } = roomConsensus(participatingRooms));
      sourceEntity = participatingRooms[0].entityId;
      sourceKind = "roomConsensus";
    } else {
      averageSource = null;
      displayUnitProfileKey = null;
      sourceEntity = primaryModel.entityId;
      sourceKind = "primary";
    }
  } else {
    const candidates = roomModels.filter(isUsable);
    const unusableUnitRooms = roomModels.filter((room) => room.availability === AVAILABILITY.INCOMPATIBLE_UNIT);
    const unusableUnitIds = unusableUnitRooms.map((room) => room.entityId);
    const unusableUnitDiagnostics = unusableUnitRooms.map((room) => ({
      code: "unusable_unit",
      entityId: room.entityId,
      metricKind: room.metricKind,
    }));
    participatingRooms = [];
    excludedRoomIds = unusableUnitIds;

    if (candidates.length === 0) {
      metricKind = resolvedIdentityMetricKind;
      averageSource = null;
      diagnostics = unusableUnitDiagnostics;
      const knownKinds = new Set(roomModels.map((room) => room.metricKind).filter(Boolean));
      if (primaryModel.metricKind) knownKinds.add(primaryModel.metricKind);
      if (knownKinds.size > 1) diagnostics.unshift({ code: "mixed_metric_kinds", metricKinds: [...knownKinds] });
      consistent = knownKinds.size <= 1;
      sourceEntity = config?.entity || null;
      sourceKind = config?.entity ? "primary" : "roomConsensus";
      displayUnitProfileKey = null;
    } else {
      const kinds = new Set(candidates.map((room) => room.metricKind));
      if (kinds.size > 1) {
        metricKind = null;
        averageSource = null;
        diagnostics = [{ code: "mixed_metric_kinds", metricKinds: [...kinds] }, ...unusableUnitDiagnostics];
        consistent = false;
        sourceEntity = null;
        sourceKind = "mixed";
        displayUnitProfileKey = null;
      } else {
        metricKind = candidates[0].metricKind;
        participatingRooms = candidates;
        diagnostics = unusableUnitDiagnostics;
        consistent = true;
        sourceEntity = candidates[0].entityId;
        sourceKind = "roomConsensus";
        ({ averageSource, displayUnitProfileKey } = roomConsensus(candidates));
      }
    }
  }

  const mixed = consistent === false;
  // Compatibility follows the kind that actually won arbitration. A typed but
  // unusable primary must not make the compatible rooms supplying its fallback
  // look foreign merely because it identifies a different kind.
  const compatibilityMetricKind = metricKind || resolvedIdentityMetricKind;
  const primary = withContextAvailability(primaryModel, compatibilityMetricKind, mixed);
  const rooms = roomModels.map((room) => withContextAvailability(room, compatibilityMetricKind, mixed));
  const roomById = new Map(rooms.map((room) => [room.entityId, room]));
  participatingRooms = participatingRooms.map((room) => roomById.get(room.entityId) || room);

  const definition = METRIC_DEFINITIONS[metricKind];
  const canonicalUnit = definition ? definition.canonicalUnit : null;
  const displayUnitProfile = definition
    ? definition.unitProfiles[displayUnitProfileKey || definition.canonicalProfileKey]
    : null;

  return {
    metricKind,
    identityMetricKind: resolvedIdentityMetricKind,
    canonicalUnit,
    unit: displayUnitProfile ? displayUnitProfile.displayUnit : canonicalUnit || "",
    displayUnitProfile,
    averageSource,
    participatingRooms,
    excludedRoomIds,
    consistent,
    diagnostics,
    primary,
    rooms,
    // Aliases retained for established consumers and diagnostics.
    metricType: metricKind,
    sourceEntity,
    sourceKind,
  };
}

// The metric kind numeric consumers can safely assume. No-data presentation reads
// context.metricKind directly so the product-name fallback remains possible.
export function effectiveMetricKind(context) {
  return context.metricType || FALLBACK_METRIC_KIND;
}

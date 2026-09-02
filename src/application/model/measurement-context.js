// Atomically arbitrate metric kind, headline source, availability and display unit.
// Configuration owns topology; availability may change the value, never the card form.

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { AVAILABILITY, UNUSABLE_REASON, buildEntityModel } from "./entity-model.js";
import { SOURCE_TOPOLOGY, resolveSourceEligibility, resolveSourceTopology } from "./source-topology.js";

// Numeric consumers use this only after no-data; display identity may remain null.
const FALLBACK_METRIC_KIND = "temperature";

function isUsable(model) {
  return model.availability === AVAILABILITY.USABLE;
}

function identityMetricKind(primary, rooms) {
  return primary.metricKind || rooms.find((room) => room.metricKind)?.metricKind || null;
}

// Partition rooms once, in config order, after metric-kind arbitration.
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

// Preserve ordinary sum/divide results bit-for-bit. If the sum overflows, normalize by the
// largest magnitude first; each term is then at most 1 and the finite mean remains recoverable.
function meanOf(values) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Number.isFinite(sum)) return sum / values.length;
  const scale = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);
  return (values.reduce((total, value) => total + value / scale, 0) / values.length) * scale;
}

// Preserve a unanimous unit profile; mixed profiles display in the canonical unit.
function roomConsensus(rooms) {
  return {
    averageSource: {
      kind: "roomConsensus",
      entityIds: rooms.map((room) => room.entityId),
      canonicalValue: meanOf(rooms.map((room) => room.canonicalValue)),
      unitProfile: null,
    },
    displayUnitProfileKey: rooms.every((room) => room.unitProfile === rooms[0].unitProfile) ? rooms[0].unitProfile : null,
  };
}

// Add card-wide kind compatibility to EntityModel's intrinsic availability.
// Rewrite the reason only when kind mismatch is itself the cause; untyped sentinels retain
// their more useful intrinsic explanation.
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
  const topology = resolveSourceTopology(config, resolveSourceEligibility(states, config));
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
    // Use topology's config index; unknown earlier room ids may have been excluded.
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
    // An unreadable primary still arbitrates by its declared sensor kind; only its value falls
    // back to matching rooms. A missing state object declares no kind, so rooms arbitrate below.
    metricKind = primaryModel.metricKind;
    ({ participatingRooms, excludedRoomIds, diagnostics } = partitionRooms(roomModels, metricKind));
    // A declaring primary settles the kind even when rooms disagree.
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
  // Compatibility follows the winning kind so fallback rooms are not marked foreign.
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

// Numeric consumers call this only beyond the no-data boundary.
export function effectiveMetricKind(context) {
  return context.metricType || FALLBACK_METRIC_KIND;
}

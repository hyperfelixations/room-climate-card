// The atomic MeasurementContext: metric kind, average source and display unit,
// decided together from the same EntityModels.
//
// The arbitration rules, in order:
//
//   1. A USABLE primary (numeric + physically valid + resolvable unit + resolvable
//      kind) alone determines the metric kind and is the average source. Rooms of
//      the same kind participate; rooms of a different kind, or with an unusable
//      unit, are excluded AND diagnosed — never silently dropped, never averaged
//      in with an assumed unit.
//   2. No usable primary -> only rooms that are themselves fully valid are
//      candidates, so an unavailable room can never out-vote an available one.
//      - No candidates: no average source. The metric kind still falls back
//        sensibly (the primary's own kind if it has one, else temperature) purely
//        so the empty state can show the right title and icon.
//      - All candidates share one kind: room consensus, averaging their CANONICAL
//        values so compatible units mix correctly.
//      - Candidates span several kinds: NO majority vote. Kind and average source
//        are null and the state is diagnosed as mixed_metric_kinds. That is a
//        defined configuration state, not an arbitrary winner picked by count.
//
// Diagnostics are returned as data, in a stable order. This function does not log:
// deduplicating a warning needs state, and state belongs to the caller.
//
// There is no cache in here either. The element memoizes by hass/config identity,
// where those identities are actually observable.

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { buildEntityModel } from "./entity-model.js";

// Used only for the title/icon fallback when nothing at all resolves.
const FALLBACK_METRIC_KIND = "temperature";

export function resolveMeasurementContext(states, config) {
  const primary = buildEntityModel(states, config, config?.entity, "primary");
  const rooms = (config?.rooms || []).map((room) => buildEntityModel(states, config, room.entity, "room"));
  const primaryUsable = primary.validNumeric && primary.validPhysical && primary.validUnit && primary.metricKind !== null;

  let metricKind;
  let averageSource;
  let participatingRooms;
  let excludedRoomIds;
  let consistent;
  let diagnostics;
  let sourceEntity;
  let sourceKind;
  let displayUnitProfileKey;

  if (primaryUsable) {
    metricKind = primary.metricKind;
    participatingRooms = [];
    excludedRoomIds = [];
    diagnostics = [];
    for (const room of rooms) {
      if (!room.validNumeric || room.metricKind === null) continue;
      if (room.metricKind !== metricKind) {
        excludedRoomIds.push(room.entityId);
        diagnostics.push({ code: "excluded_foreign_metric_kind", entityId: room.entityId, metricKind: room.metricKind });
        continue;
      }
      if (!room.validUnit) {
        excludedRoomIds.push(room.entityId);
        diagnostics.push({ code: "unusable_unit", entityId: room.entityId, metricKind: room.metricKind });
        continue;
      }
      if (room.validPhysical) participatingRooms.push(room);
    }
    averageSource = { kind: "primary", entityId: primary.entityId, canonicalValue: primary.canonicalValue, unitProfile: primary.unitProfile };
    consistent = true;
    sourceEntity = primary.entityId;
    sourceKind = "primary";
    displayUnitProfileKey = primary.unitProfile;
  } else {
    const candidates = rooms.filter((room) => room.validNumeric && room.validPhysical && room.validUnit && room.metricKind !== null);
    // Rooms that are otherwise fine but whose own unit resolves to nothing are
    // diagnosed in this branch too, so they never disappear from the candidate
    // pool without a trace regardless of which sub-branch is reached.
    const unusableUnitRooms = rooms.filter((room) => room.validNumeric && room.validPhysical && !room.validUnit && room.metricKind !== null);
    const unusableUnitIds = unusableUnitRooms.map((room) => room.entityId);
    const unusableUnitDiagnostics = unusableUnitRooms.map((room) => ({ code: "unusable_unit", entityId: room.entityId, metricKind: room.metricKind }));
    participatingRooms = [];
    excludedRoomIds = unusableUnitIds;
    if (candidates.length === 0) {
      metricKind = primary.metricKind || FALLBACK_METRIC_KIND;
      averageSource = null;
      diagnostics = unusableUnitDiagnostics;
      consistent = true;
      sourceEntity = primary.metricKind ? primary.entityId : null;
      sourceKind = primary.metricKind ? "primary" : "default";
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
        // A room-consensus average has no single "the" display unit unless every
        // participating room agrees on one. A °F room mixed among °C rooms still
        // averages correctly (each canonicalValue already is canonical), but
        // display falls back to canonical rather than arbitrarily preferring one
        // disagreeing room's unit.
        displayUnitProfileKey = candidates.every((room) => room.unitProfile === candidates[0].unitProfile)
          ? candidates[0].unitProfile
          : null;
        averageSource = {
          kind: "roomConsensus",
          entityIds: candidates.map((room) => room.entityId),
          canonicalValue: candidates.reduce((sum, room) => sum + room.canonicalValue, 0) / candidates.length,
          unitProfile: null,
        };
      }
    }
  }

  const definition = METRIC_DEFINITIONS[metricKind];
  // With no resolvable kind (the mixed state) there is no definition to ask, so
  // the fallback kind's canonical unit stands in — enough for the empty state's
  // title and icon, never used for a measurement.
  const canonicalUnit = definition ? definition.canonicalUnit : METRIC_DEFINITIONS[FALLBACK_METRIC_KIND].canonicalUnit;
  const displayUnitProfile = definition
    ? definition.unitProfiles[displayUnitProfileKey || definition.canonicalProfileKey]
    : null;

  return {
    metricKind,
    canonicalUnit,
    unit: displayUnitProfile ? displayUnitProfile.displayUnit : canonicalUnit,
    displayUnitProfile,
    averageSource,
    participatingRooms,
    excludedRoomIds,
    consistent,
    diagnostics,
    // Aliases kept because existing consumers and tests read these names.
    metricType: metricKind,
    sourceEntity,
    sourceKind,
  };
}

// The metric kind every consumer can safely assume, with the documented
// temperature default for the mixed-kind state.
export function effectiveMetricKind(context) {
  return context.metricType || FALLBACK_METRIC_KIND;
}

// Numeric and semantic card state; presentation owns text, formatting, CSS and geometry.
// Classification hex values are semantic inputs here, never CSS-ready paint recipes.

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { adaptPalette } from "../../domain/classification/palettes/adaptation.js";
import { tintRecipesFor } from "../../domain/classification/tone-legibility.js";
import { NEUTRAL_COLOR } from "../../domain/classification/palettes/registry.js";
import {
  classificationPolicyOf,
  paletteOf,
  classificationColorOf,
  classifyValue,
  resolveProfileIcon,
  resolveScaleConfig,
} from "./classification.js";
import { AVAILABILITY, readNumericAttribute, convertMetricValue } from "./entity-model.js";
import { effectiveMetricKind } from "./measurement-context.js";
import { resolveSourceEligibility, resolveSourceTopology } from "./source-topology.js";
import { buildRangeModel, buildTrendContext } from "./auxiliary-models.js";
import {
  buildRoomModels,
  buildSubtitleModel,
  computeComfortCounts,
  computeSpread,
  sortRoomsByValue,
} from "./aggregates.js";

export function buildCardDomainModel({ states, config, context, language, surface }) {
  const policy = classificationPolicyOf(config);
  // Adapt only card-built palettes to the measured surface.
  const palette = adaptPalette(paletteOf(config), surface);
  // Resolve self-tint recipes once for every composed colour; explicit colours stay untouched.
  const tintRecipes = tintRecipesFor(
    [...palette.below, palette.optimal, ...palette.above, palette.invalid, NEUTRAL_COLOR],
    surface
  );
  const metricKind = effectiveMetricKind(context);
  // Resolve topology while `states` is available; presentation must not reconstruct it.
  const topology = resolveSourceTopology(config, resolveSourceEligibility(states, config));
  // Carry both the availability decision and its user-facing reason.
  const sourceAvailability = {
    primary: {
      entity: context.primary.entityId,
      status: context.primary.availability,
      reason: context.primary.unusableReason,
      metricKind: context.primary.metricKind,
    },
    rooms: context.rooms.map((room, index) => ({
      index,
      entity: room.entityId,
      status: room.availability,
      reason: room.unusableReason,
      metricKind: room.metricKind,
    })),
  };
  const missingRooms = sourceAvailability.rooms.filter((room) => room.status === AVAILABILITY.MISSING).length;

  // No source or no metric-kind arbiter yields no-data, never a cross-metric average.
  if (context.averageSource === null) {
    return {
      empty: true,
      // Presentation may consume but neither measure nor recompute these.
      surface,
      tintRecipes,
      // Preserve source identity through no-data rendering.
      topology,
      // Null makes no-data presentation use the product name instead of a guessed metric.
      metric: { kind: context.identityMetricKind },
      context: {
        diagnostics: context.diagnostics,
        consistent: context.consistent,
        excludedRoomIds: context.excludedRoomIds,
        sourceKind: context.sourceKind,
        sourceEntity: context.sourceEntity,
        availability: sourceAvailability,
      },
      rooms: {
        declared: [],
        byValue: [],
        count: 0,
        comparable: false,
        missing: missingRooms,
        availability: sourceAvailability.rooms,
      },
      missingRooms,
      configurationState: context.diagnostics[0]?.code ?? null,
    };
  }

  const scaleConfig = resolveScaleConfig(policy, metricKind, context.displayUnitProfile);
  const comfort = scaleConfig.comfort;
  const optimal = scaleConfig.optimal;

  // Project every number once so display, bands, classification and scale share one unit.
  const displayProfile = context.displayUnitProfile;
  const toDisplay = displayProfile ? displayProfile.fromCanonical : (v) => v;
  const toDisplayDelta = displayProfile ? displayProfile.deltaFromCanonical : (v) => v;

  const declaredRooms = buildRoomModels({ config, context, toDisplay });
  const roomsByValue = sortRoomsByValue(declaredRooms, language);

  // Comparison uses all valid rooms, never the grid-capped visible subset.
  const roomsComparable = roomsByValue.length >= 2;
  const coolest = roomsComparable ? roomsByValue[0] : null;
  const warmest = roomsComparable ? roomsByValue[roomsByValue.length - 1] : null;

  const average = toDisplay(context.averageSource.canonicalValue);
  // Attribution controls clickability, entity colour, spread and action ownership:
  // sensor = primary, room = direct single room, calculated = unattributed consensus.
  const averageSourceKind =
    context.averageSource.kind === "primary" ? "sensor" : context.averageSource.kind === "roomDirect" ? "room" : "calculated";
  const averageEntity = averageSourceKind === "calculated" ? "" : context.averageSource.entityId;
  // A room index exists only when topology says the headline is that configured room.
  const averageRoomIndex = averageSourceKind === "room" ? topology.roomIndex : null;

  const range = buildRangeModel({ states, config, policy, palette, metricKind, displayUnitProfile: displayProfile, toDisplay, toDisplayDelta });
  const trend = buildTrendContext({ states, config, metricKind, unit: context.unit, toDisplayDelta });

  const counts = computeComfortCounts(roomsByValue, comfort, roomsComparable);

  let spreadAttribute = averageSourceKind === "sensor" ? readNumericAttribute(states, config.entity, "spread") : null;
  if (spreadAttribute !== null && context.averageSource.unitProfile && METRIC_DEFINITIONS[metricKind]) {
    spreadAttribute = toDisplayDelta(
      convertMetricValue(spreadAttribute, {
        metricKind,
        quantityKind: "delta",
        fromProfileKey: context.averageSource.unitProfile,
        toProfileKey: METRIC_DEFINITIONS[metricKind].canonicalProfileKey,
      })
    );
  }
  const spread = computeSpread({ attributeValue: spreadAttribute, roomsComparable, coolest, warmest });

  // Key semantic room colours by YAML index so all consumers share one colour per render.
  const roomColors = {};
  for (const room of roomsByValue) {
    roomColors[room.index] = classificationColorOf(
      policy,
      metricKind,
      displayProfile,
      room.value,
      states?.[room.entity]?.attributes ?? null,
      palette
    );
  }

  const averageClassification = classifyValue(
    policy,
    metricKind,
    displayProfile,
    average,
    averageEntity ? states?.[averageEntity]?.attributes ?? null : null,
    palette
  );

  return {
    empty: false,
    // See the note on the no-data branch above.
    surface,
    tintRecipes,
    topology,
    metric: {
      kind: metricKind,
      canonicalUnit: context.canonicalUnit,
      unit: context.unit,
      displayUnitProfile: displayProfile,
    },
    context: {
      diagnostics: context.diagnostics,
      consistent: context.consistent,
      excludedRoomIds: context.excludedRoomIds,
      sourceKind: context.sourceKind,
      sourceEntity: context.sourceEntity,
      availability: sourceAvailability,
    },
    average: {
      value: average,
      source: averageSourceKind,
      entity: averageEntity,
      roomIndex: averageRoomIndex,
    },
    rooms: {
      declared: declaredRooms,
      byValue: roomsByValue,
      count: roomsByValue.length,
      comparable: roomsComparable,
      missing: missingRooms,
      availability: sourceAvailability.rooms,
    },
    roomColors,
    extremes: roomsComparable
      ? {
          coolest,
          warmest,
          coolestColor: roomColors[coolest.index],
          warmestColor: roomColors[warmest.index],
        }
      : null,
    comfort: { min: comfort.min, max: comfort.max, ...counts },
    optimal: { min: optimal.min, max: optimal.max },
    // Axis policy only; presentation resolves concrete geometry from visible values.
    scaleConfig,
    spread,
    range,
    trend,
    classification: {
      average: averageClassification,
      profileIcon: resolveProfileIcon(policy, metricKind, displayProfile, average),
    },
    subtitle: buildSubtitleModel({
      avg: average,
      comfort,
      roomsComparable,
      counts,
      roomCount: roomsByValue.length,
      coolest,
      warmest,
      missingRooms,
    }),
  };
}

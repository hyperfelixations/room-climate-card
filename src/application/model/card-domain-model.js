// The CardDomainModel: everything the card knows about the current reading,
// expressed in numbers and semantic tokens.
//
// No translated text, no formatted numbers, no HTML, no CSS, no DOM measurement,
// and no rendering geometry — no percentages, no pixel offsets, no view-specific
// marker objects. Those are all statements about a rendered bar, not about the
// measurement, and they live in presentation/view-model.
//
// The model is NOT colour-free, and deliberately so. A classification result
// carries the hex colour its tier (or the entity's own value_color attribute)
// declares, because that colour is part of the classification itself — a
// SEMANTIC CLASSIFICATION VALUE, authored in a profile or validated out of an
// entity attribute. What the model never carries is a CSS-READY colour: no
// rgba() derivation, no custom-property string, no alpha applied for a soft
// background. Those are presentation decisions.
//
// Structure of the result:
//   metric        kind, canonical unit, display unit, unit profile
//   context       the MeasurementContext and its diagnostics
//   average       value, source kind, the entity it may be attributed to
//   rooms         declared order and business (value) order, plus availability
//   roomColors    one semantic classification colour per participating room
//   extremes      coolest/warmest and their semantic classification colours
//   comfort       band bounds plus the three counts
//   optimal       band bounds
//   scaleConfig   the axis POLICY (preferred bounds, step, anchoring) — no geometry
//   spread        the resolved value, whichever source won
//   range         today's width, min/max, raw timestamps, colours, availability
//   trend         value, unit and the semantic direction
//   classification the average's own tokens plus the profile icon token
//   subtitle      which sentence applies, and its numbers
//   state         empty / configuration state

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import {
  classificationPolicyOf,
  classificationColorOf,
  classifyValue,
  resolveProfileIcon,
  resolveScaleConfig,
} from "./classification.js";
import { AVAILABILITY, readNumericAttribute, convertMetricValue } from "./entity-model.js";
import { effectiveMetricKind } from "./measurement-context.js";
import { resolveSourceTopology } from "./source-topology.js";
import { buildRangeModel, buildTrendContext } from "./auxiliary-models.js";
import {
  buildRoomModels,
  buildSubtitleModel,
  computeComfortCounts,
  computeSpread,
  sortRoomsByValue,
} from "./aggregates.js";

export function buildCardDomainModel({ states, config, context, language }) {
  const policy = classificationPolicyOf(config);
  const metricKind = effectiveMetricKind(context);
  // The same configuration-only classification the measurement context branched on.
  // Recomputed rather than threaded through, because it is a pure function of the
  // config and having one owner beats having one carrier.
  const topology = resolveSourceTopology(config);
  const sourceAvailability = {
    primary: {
      entity: context.primary.entityId,
      status: context.primary.availability,
      metricKind: context.primary.metricKind,
    },
    rooms: context.rooms.map((room, index) => ({
      index,
      entity: room.entityId,
      status: room.availability,
      metricKind: room.metricKind,
    })),
  };
  const missingRooms = sourceAvailability.rooms.filter((room) => room.status === AVAILABILITY.MISSING).length;

  // No usable average source at all: either nothing resolvable anywhere, or rooms
  // reporting genuinely incompatible metric kinds with no usable primary to
  // arbitrate. Exposed as a configuration state so a future release can surface it
  // more specifically; today it renders as the no-data state, never as a
  // cross-metric-kind average.
  if (context.averageSource === null) {
    return {
      empty: true,
      // Unlike effectiveMetricKind(), this may be null. No-data presentation uses
      // that fact to show the product name instead of inventing a temperature card.
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

  // From here on every number is projected into the resolved display unit exactly
  // once. Comfort, classification and scale decisions must be made against the
  // SAME unit as the number that is rendered, or a rounded Fahrenheit boundary
  // would be compared against an unrounded Celsius one. Identity for
  // humidity/co2/pm25 and whenever the display unit already is canonical.
  const displayProfile = context.displayUnitProfile;
  const toDisplay = displayProfile ? displayProfile.fromCanonical : (v) => v;
  const toDisplayDelta = displayProfile ? displayProfile.deltaFromCanonical : (v) => v;

  const declaredRooms = buildRoomModels({ config, context, toDisplay });
  const roomsByValue = sortRoomsByValue(declaredRooms, language);

  // Extended mode (chips, extreme-value view, auto-slide) needs at least two valid
  // rooms. Driven by the complete list, never by the possibly capped visible
  // subset: a grid override that hides chips must not turn off the room-comparison
  // features it does not otherwise affect.
  const roomsComparable = roomsByValue.length >= 2;
  const coolest = roomsComparable ? roomsByValue[0] : null;
  const warmest = roomsComparable ? roomsByValue[roomsByValue.length - 1] : null;

  const average = toDisplay(context.averageSource.canonicalValue);
  // WHICH ENTITY, if any, the displayed headline actually is. Everything attributed to
  // an entity follows this exactly — clickability, the colour taken from its attributes,
  // the spread attribute, and which action config a tap resolves against. A looser "the
  // entity exists" check would keep the headline clickable and colour it from a stale
  // entity while showing a room-derived fallback value.
  //
  //   sensor      the configured primary's own reading
  //   room        one configured room's own reading, because the card names exactly
  //               that one entity (see source-topology.js)
  //   calculated  a consensus over several rooms; no single entity represents it
  const averageSourceKind =
    context.averageSource.kind === "primary" ? "sensor" : context.averageSource.kind === "roomDirect" ? "room" : "calculated";
  const averageEntity = averageSourceKind === "calculated" ? "" : context.averageSource.entityId;
  // Set only where the headline genuinely IS a configured room, which the topology
  // decides. Carries the room's label and its per-room action overrides to the big
  // value without a second lookup — and never fires for a primary that merely happens
  // to appear among several rooms.
  const averageRoomIndex = averageSourceKind === "room" ? topology.roomIndex : null;

  const range = buildRangeModel({ states, config, policy, metricKind, displayUnitProfile: displayProfile, toDisplay, toDisplayDelta });
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

  // One classification colour per participating room, keyed by the room's original
  // YAML index. Every consumer that tints something per room — the chips, the
  // `markers:all` marker set, the extreme-value cards — reads the SAME entry, so a
  // room can never appear in two colours within one render. Keyed rather than
  // attached to the room objects themselves: the room model is a shared, stable
  // shape that several consumers compare by identity.
  const roomColors = {};
  for (const room of roomsByValue) {
    roomColors[room.index] = classificationColorOf(
      policy,
      metricKind,
      displayProfile,
      room.value,
      states?.[room.entity]?.attributes ?? null
    );
  }

  const averageClassification = classifyValue(
    policy,
    metricKind,
    displayProfile,
    average,
    averageEntity ? states?.[averageEntity]?.attributes ?? null : null
  );

  return {
    empty: false,
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
    // The axis POLICY, not an axis: which bounds a profile prefers, which step it
    // rounds to and whether it anchors. Turning that into a concrete axis needs the
    // values it has to cover, which is a rendering decision (see
    // presentation/view-model/scale-view-model.js).
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

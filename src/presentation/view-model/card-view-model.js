// The CardViewModel: the domain model projected into everything the renderers
// need, and nothing they do not.
//
// This is where language, locale and CSS enter the pipeline. Below this line a
// reading is numbers and semantic tokens; from here on it is titles, labels,
// formatted values, percentages, pixel offsets and rgba() colours. Keeping that
// boundary sharp is what lets the whole data path be tested once,
// language-independently, instead of once per locale.
//
// The contract with the rendering layer is that a renderer NEVER translates,
// formats, resolves a profile, classifies a value, recomputes a tone, reads a view
// option or reaches into the configuration. Everything a renderer or a DOM patcher
// interpolates is a finished value on this model. That is what makes the render path
// a pure function of this object, and what makes the render path testable without a
// hass object.
//
// `texts` is the only collaborator, and it is deliberately narrow — a translator, a
// number formatter, a unit-aware formatter and a time formatter. It is not a service
// locator: it cannot reach the card, the DOM or the configuration.

import { metricMetaFor } from "./metric-meta.js";
import { buildRoomChipModel, buildRoomChipRows, buildRoomLayout, decorateRoomForDisplay } from "./room-layout.js";
import { buildViewState } from "./view-state.js";
import { buildScaleAxis, resolveMarkerNudge } from "./scale-view-model.js";
import { SOURCE_TOPOLOGY, chipsWouldDuplicateHeadline } from "../../application/model/source-topology.js";
import { buildRoomMarker } from "./marker.js";
import { buildTone, toneStyleDeclaration } from "./tone.js";
import { buildViewContent } from "./view-content/index.js";
import { AVAILABILITY } from "../../application/model/entity-model.js";
import { CARD_NAME } from "../../core/card-metadata.js";
import { UNAVAILABLE_TEXT } from "../../core/text.js";
import { rgba } from "../../core/color.js";

const NO_DATA_COLOR = "#7F8792";
const PLACEHOLDER_STATUSES = new Set([AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE]);

function buildNeutralTone(icon, texts) {
  return {
    label: texts.t("status.noData"),
    color: NO_DATA_COLOR,
    score: null,
    zone: "neutral",
    source: "availability",
    profileId: null,
    icon,
    soft: rgba(NO_DATA_COLOR, 0.20),
  };
}

// Joins calculation rooms with display-only placeholders by YAML index. Missing
// and incompatible sources never enter this list, and placeholders carry no
// numeric value, classification or colour that a calculation could accidentally
// consume.
function buildDisplayRooms(domainModel, config) {
  const usableByIndex = new Map((domainModel.rooms?.declared || []).map((room) => [room.index, room]));
  const availabilityByIndex = new Map((domainModel.rooms?.availability || []).map((room) => [room.index, room]));
  const displayed = [];
  for (const [index, configured] of (config.rooms || []).entries()) {
    const usable = usableByIndex.get(index);
    if (usable) {
      displayed.push(usable);
      continue;
    }
    const availability = availabilityByIndex.get(index);
    if (config.unavailable_values !== "show" || !PLACEHOLDER_STATUSES.has(availability?.status)) continue;
    displayed.push({
      ...configured,
      index,
      value: null,
      placeholder: true,
      availability: availability.status,
    });
  }
  return displayed;
}

function buildSubtitleText(subtitle, texts, metricKind) {
  const meta = metricMetaFor(metricKind);
  let text;
  if (subtitle.kind === "aboveComfort") {
    text = texts.t("subtitle.aboveComfort", {
      diff: texts.fmtWithUnit(subtitle.diff),
      count: subtitle.count,
      total: subtitle.total,
      adjective: texts.t(meta.aboveAdjectiveKey),
    });
  } else if (subtitle.kind === "aboveComfortNoRooms") {
    text = texts.t("subtitle.aboveComfortNoRooms", { diff: texts.fmtWithUnit(subtitle.diff) });
  } else if (subtitle.kind === "belowComfort") {
    text = texts.t("subtitle.belowComfort", {
      diff: texts.fmtWithUnit(subtitle.diff),
      count: subtitle.count,
      total: subtitle.total,
      adjective: texts.t(meta.belowAdjectiveKey),
    });
  } else if (subtitle.kind === "belowComfortNoRooms") {
    text = texts.t("subtitle.belowComfortNoRooms", { diff: texts.fmtWithUnit(subtitle.diff) });
  } else if (subtitle.kind === "inComfortIssue") {
    text = texts.t("subtitle.inComfortIssue", { name: subtitle.name });
  } else if (subtitle.kind === "inComfortAllGood") {
    text = texts.t("subtitle.inComfortAllGood");
  } else {
    text = texts.t("subtitle.inComfort");
  }
  // Appended rather than folded into the sentence above: it is an independent
  // statement, and every language phrases it as its own clause.
  if (subtitle.missingRooms > 0) {
    text += texts.t("subtitle.missingRooms", { count: subtitle.missingRooms });
  }
  return text;
}

// The signed hourly rate, as displayed. -0 is normalized to 0 so a rate that rounds
// to zero from below does not render as "-0.0". `trend` is the trend MODEL, which is
// null whenever there is no usable rate — the empty string is the right answer then,
// because the footer segment and the ARIA clause are both omitted.
export function buildTrendText(trend, texts) {
  if (!trend) return "";
  const value = Object.is(trend.value, -0) ? 0 : trend.value;
  return `${value > 0 ? "+" : ""}${texts.fmt(value)} ${trend.unit}`;
}

// What the headline value is CALLED.
//
// The caption exists to tell the big number apart from the other values on the card.
// That is the whole rule, and the four cases fall out of it:
//
//   an explicit entity_label  the user said what it is called, including "" for
//                             "call it nothing" — always wins
//   the headline IS a room    that room's name; `name` already falls back through
//                             short to the entity id (see config/rooms.js)
//   there are no rooms        nothing to tell it apart from, and the card title
//                             already names the measurement — so no caption at all
//   otherwise                 it stands among room chips, so it says which one it is
//
// Every branch reads configuration only. A sensor dropping out can change the VALUE,
// never what it is called.
function resolveHeadlineLabel({ config, topology, roomIndex, texts }) {
  if (config.entity_label !== null) return config.entity_label;
  if (roomIndex !== null) return config.rooms[roomIndex].name;
  if (topology.kind === SOURCE_TOPOLOGY.PRIMARY_ONLY) return "";
  return texts.t("value.homeAverage");
}

function buildAverage({ domainModel, config, topology, texts, tone, position, trendText }) {
  const { value, entity, source, roomIndex } = domainModel.average;
  const trend = domainModel.trend.model;
  const label = resolveHeadlineLabel({ config, topology, roomIndex, texts });
  // Carried as its own fact rather than left for each consumer to re-derive from an
  // empty string. The renderer omits the whole element when it is false, which makes
  // this a STRUCTURAL property — see cardStructureSignature().
  const hasLabel = label !== "";
  const valueText = texts.fmtWithUnit(value);

  // A calculated average gets its own tooltip wording: it is not a reading of the
  // configured entity, and saying so is the honest thing to show on hover. Without a
  // caption the label-prefixed forms would produce a tooltip starting with ": ", so
  // each has a captionless twin.
  const tooltipKey = source === "calculated"
    ? (hasLabel ? "value.tooltipCalculated" : "value.tooltipCalculatedNoLabel")
    : (hasLabel ? "value.tooltip" : "value.tooltipNoLabel");
  const tooltip = texts.t(tooltipKey, { value: valueText, label });

  // A headline that IS a room announces that room by name, reusing the same phrasing
  // its chip uses. Otherwise the generic "open the average" wording applies, and a
  // headline that opens nothing falls back to describing itself.
  const ariaBase = !entity
    ? tooltip
    : roomIndex !== null
      ? texts.t("room.ariaOpen", { name: config.rooms[roomIndex].name })
      : texts.t("value.ariaOpen");
  const trendAria = trend
    ? texts.t("trend.aria", { direction: texts.t(trend.directionTranslationKey), value: trendText })
    : "";
  return {
    value,
    valueText: texts.fmt(value),
    unitText: domainModel.metric.unit,
    label,
    hasLabel,
    entity,
    source,
    // The configured room the headline is, or null. The renderer forwards it as
    // data-room-index so a tap resolves against that room's own action overrides
    // through the ordinary action path.
    roomIndex,
    color: tone.color,
    position,
    tooltip,
    ariaLabel: trend ? `${ariaBase}. ${trendAria}` : ariaBase,
    trendDirection: trend ? trend.direction : null,
  };
}

function noDataHeadlineSource(domainModel, config, topology) {
  const availability = domainModel.context.availability;
  if (topology.kind === SOURCE_TOPOLOGY.SINGLE_ROOM) {
    return { ...availability.rooms[topology.roomIndex], source: "room", roomIndex: topology.roomIndex };
  }
  if (topology.kind === SOURCE_TOPOLOGY.PRIMARY_ONLY || topology.kind === SOURCE_TOPOLOGY.PRIMARY_WITH_ROOMS) {
    return { ...availability.primary, source: "sensor", roomIndex: null };
  }
  return { entity: null, status: null, source: "calculated", roomIndex: null };
}

function buildNoDataSubtitle({ domainModel, headline, texts }) {
  const missingRooms = domainModel.context.availability.rooms.filter(
    (room) => room.status === AVAILABILITY.MISSING && room.entity !== headline.entity
  );
  const incompatible = [
    domainModel.context.availability.primary,
    ...domainModel.context.availability.rooms,
  ].some((source) => [AVAILABILITY.INCOMPATIBLE_KIND, AVAILABILITY.INCOMPATIBLE_UNIT].includes(source.status));

  const missingRoomText = () => texts.t("availability.entitiesMissing", {
    count: missingRooms.length,
    entities: missingRooms.map((room) => room.entity).join(", "),
  });
  // A missing configured room is independently actionable information. Keep it
  // visible even when the headline has its own outage or incompatibility reason.
  const appendMissingRooms = (result) => missingRooms.length === 0
    ? result
    : {
        kind: `${result.kind}+rooms-missing`,
        text: `${result.text} ${missingRoomText()}`,
      };

  if (headline.status === AVAILABILITY.MISSING) {
    return appendMissingRooms({
      kind: "entity-missing",
      text: texts.t("availability.entityMissing", { entity: headline.entity }),
    });
  }
  if ([AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE].includes(headline.status)) {
    return appendMissingRooms({ kind: "value-unavailable", text: texts.t("availability.valueUnavailable") });
  }
  if ([AVAILABILITY.INCOMPATIBLE_KIND, AVAILABILITY.INCOMPATIBLE_UNIT].includes(headline.status)) {
    return appendMissingRooms({ kind: "incompatible", text: texts.t("availability.incompatible") });
  }
  if (domainModel.configurationState === "mixed_metric_kinds" || incompatible) {
    return appendMissingRooms({ kind: "incompatible", text: texts.t("availability.incompatible") });
  }
  if (missingRooms.length > 0) {
    return {
      kind: "rooms-missing",
      text: missingRoomText(),
    };
  }
  if (domainModel.context.availability.rooms.length > 0) {
    return { kind: "rooms-unavailable", text: texts.t("availability.noUsableRooms") };
  }
  return { kind: "source-unavailable", text: texts.t("availability.valueUnavailable") };
}

// No data is a normal card shell, not a separate error component. It uses the
// same header, headline and keyed room-grid contracts as the data state, with a
// deliberately collapsed view area and neutral presentation values.
function buildNoDataViewModel({ domainModel, config, texts, topology, title, metricKind, meta }) {
  const headline = noDataHeadlineSource(domainModel, config, topology);
  const label = resolveHeadlineLabel({ config, topology, roomIndex: headline.roomIndex, texts });
  const hasLabel = label !== "";
  const headlineExists = headline.entity && headline.status !== AVAILABILITY.MISSING;
  const statusLabel = texts.t("status.noData");
  const tooltip = hasLabel
    ? texts.t("availability.valueNoData", { label })
    : statusLabel;
  const ariaOpen = headline.roomIndex !== null
    ? texts.t("room.ariaOpen", { name: config.rooms[headline.roomIndex].name })
    : texts.t("value.ariaOpen");
  const icon = config.icon || meta?.emptyIcon || "mdi:home-thermometer-outline";
  const tone = buildNeutralTone(icon, texts);
  const noData = buildNoDataSubtitle({ domainModel, headline, texts });

  const displayRooms = buildDisplayRooms(domainModel, config);
  const decoratedRooms = displayRooms.map((room) => decorateRoomForDisplay(room, config.room_label));
  const layout = buildRoomLayout({ declaredRooms: decoratedRooms, config, metricKind, language: texts.language });
  const chips = layout.visible.map((room) => buildRoomChipModel({ room, color: null, comfort: null, unit: "", texts }));
  const showChips =
    config.show_rooms !== "never" &&
    chips.length >= 1 &&
    (config.show_rooms === "always" || !chipsWouldDuplicateHeadline(topology));

  return {
    empty: true,
    metric: { kind: metricKind, unit: "", displayUnitProfile: null },
    title,
    subtitle: noData.text,
    missingRooms: domainModel.missingRooms,
    configurationState: domainModel.configurationState,
    noData: { hintKind: noData.kind },
    tone,
    toneStyle: toneStyleDeclaration(tone),
    header: { icon, title, subtitle: noData.text, statusLabel },
    average: {
      value: null,
      valueText: UNAVAILABLE_TEXT,
      unitText: "",
      label,
      hasLabel,
      entity: headlineExists ? headline.entity : "",
      source: headline.source,
      roomIndex: headline.roomIndex,
      color: NO_DATA_COLOR,
      position: null,
      tooltip,
      ariaLabel: headlineExists ? `${ariaOpen}. ${statusLabel}` : tooltip,
      trendDirection: null,
      unavailable: true,
    },
    rooms: {
      visible: layout.visible,
      rowSizes: layout.rowSizes,
      count: domainModel.rooms.count,
      comparable: false,
      showChips,
      chips,
      chipRows: buildRoomChipRows(chips, layout.rowSizes),
    },
    extremes: null,
    roomMarkers: [],
    comfort: null,
    spread: null,
    range: null,
    trend: { model: null, text: "" },
    scale: null,
    rangeScale: null,
    views: { keys: [], entries: [], options: {}, collapsed: true, hasRangeScale: false, byKey: {} },
    carousel: { hint: "", noActiveViewsHint: "" },
  };
}

export function buildCardViewModel({ domainModel, config, texts }) {
  // Which sources this card actually refers to. Decides the headline's caption and
  // whether a chip would only repeat it, so both read the same single answer — taken
  // from the model rather than recomputed, because deciding it needs `states` (an id
  // Home Assistant does not know is not a source) and this layer has none.
  const topology = domainModel.topology;
  const metricKind = domainModel.metric.kind;
  const meta = metricKind ? metricMetaFor(metricKind) : null;
  const title = config.title || (meta ? texts.t(meta.titleKey) : CARD_NAME);

  if (domainModel.empty) {
    return buildNoDataViewModel({ domainModel, config, texts, topology, title, metricKind, meta });
  }

  const unit = domainModel.metric.unit;
  const formatBoundary = (value) => texts.fmtWithUnit(value, 0, false);
  const classification = domainModel.classification.average;
  const tone = buildTone({
    classification,
    // config.icon wins outright; then the active profile's own icon; then the
    // metric's stable default, so a kind without icon tiers is never forced into a
    // semantically dubious icon family.
    icon: config.icon || domainModel.classification.profileIcon || meta.icon,
    texts,
  });

  // Decorated once, in declaration order, then reused for both the visible chip list
  // and the extremes — so a room object is the same object wherever it appears.
  const decoratedByIndex = new Map();
  const displayRooms = buildDisplayRooms(domainModel, config);
  const decoratedDeclared = displayRooms.map((room) => {
    const decorated = decorateRoomForDisplay(room, config.room_label);
    decoratedByIndex.set(room.index, decorated);
    return decorated;
  });
  const layout = buildRoomLayout({ declaredRooms: decoratedDeclared, config, metricKind, language: texts.language });

  const average = domainModel.average.value;
  const rooms = domainModel.rooms;
  // Everything that dereferences an extreme is gated on the extremes object itself
  // rather than on rooms.comparable. The domain guarantees the two agree; keying off the
  // object means a single place decides, and no branch can read `.value` off null.
  const hasExtremes = Boolean(domainModel.extremes);
  const coolest = hasExtremes ? domainModel.extremes.coolest : null;
  const warmest = hasExtremes ? domainModel.extremes.warmest : null;

  // The main axis must cover the average as well as the room extrema: an
  // independently sourced average can fall outside [coolest, warmest], and an axis
  // built from the rooms alone would clamp its marker to an edge.
  const scaleMarkerValues = { avg: average };
  if (hasExtremes) {
    scaleMarkerValues.coolest = coolest.value;
    scaleMarkerValues.warmest = warmest.value;
    for (const room of rooms.byValue) scaleMarkerValues[`room_${room.index}`] = room.value;
  }
  const axisInputs = {
    scaleConfig: domainModel.scaleConfig,
    displayUnitProfile: domainModel.metric.displayUnitProfile,
    comfort: domainModel.comfort,
    optimal: domainModel.optimal,
    formatBoundary,
  };
  const scale = buildScaleAxis({
    ...axisInputs,
    low: hasExtremes ? Math.min(coolest.value, average) : average,
    high: hasExtremes ? Math.max(warmest.value, average) : average,
    markers: scaleMarkerValues,
  });

  const range = {
    hasRange: domainModel.range.hasRange,
    state: domainModel.range.state,
    min: domainModel.range.min,
    max: domainModel.range.max,
    minTime: texts.formatTime(domainModel.range.minTimestamp),
    maxTime: texts.formatTime(domainModel.range.maxTimestamp),
    minColor: domainModel.range.minColor,
    maxColor: domainModel.range.maxColor,
  };

  const trendText = buildTrendText(domainModel.trend.model, texts);
  const averageModel = buildAverage({
    domainModel,
    config,
    topology,
    texts,
    tone,
    position: scale.markerPositions.avg,
    trendText,
  });

  // One marker per participating room, always built when there are rooms — the
  // `markers:all` option decides whether the scale view USES them, not whether they
  // exist, and the extreme-value view needs the same colours.
  const roomMarkers = hasExtremes
    ? rooms.byValue.map((room) =>
        buildRoomMarker({
          room,
          position: scale.markerPositions[`room_${room.index}`],
          color: domainModel.roomColors[room.index],
          title: `${room.name}: ${texts.fmtWithUnit(room.value)}`,
        })
      )
    : [];

  let extremes = null;
  if (hasExtremes) {
    const coolestPosition = scale.markerPositions.coolest;
    const warmestPosition = scale.markerPositions.warmest;
    const nudge = resolveMarkerNudge(coolestPosition, warmestPosition);
    extremes = {
      coolest: decoratedByIndex.get(coolest.index),
      warmest: decoratedByIndex.get(warmest.index),
      coolestPosition,
      warmestPosition,
      coolestShift: nudge.first,
      warmestShift: nudge.second,
      coolestColor: domainModel.extremes.coolestColor,
      warmestColor: domainModel.extremes.warmestColor,
    };
  }

  const viewState = buildViewState({
    availability: {
      hasRange: domainModel.range.hasRange,
      roomsComparable: rooms.comparable,
      rangeScaleAvailable: domainModel.range.rangeScaleAvailable,
    },
    config,
  });

  // Everything the four per-view content builders share. Assembled once so no
  // builder needs the domain model, the config or a formatter of its own.
  //
  // buildRangeScaleAxis is a thunk on purpose: the daily-range axis is only ever
  // computed from inside the range-scale branch, so an available-but-not-requested
  // view costs nothing.
  const shared = {
    metricKind,
    unit,
    texts,
    comfort: domainModel.comfort,
    optimal: domainModel.optimal,
    spread: domainModel.spread,
    hideFooter: Boolean(config.hide_footer),
    rangeEntity: config.range_entity,
    average: { ...averageModel },
    rooms: { comparable: rooms.comparable, count: rooms.count, byValue: rooms.byValue },
    roomColors: domainModel.roomColors,
    extremes,
    roomMarkers,
    range,
    trend: { ...domainModel.trend, text: trendText },
    scale,
    buildRangeScaleAxis: () =>
      buildScaleAxis({
        ...axisInputs,
        // The daily-range axis has the same requirement as the main one and for the
        // same reason: the average can sit outside [min, max] when the range entity
        // updates less often than the primary, and the edge labels would then
        // contradict a clamped marker.
        low: Math.min(domainModel.range.min, average),
        high: Math.max(domainModel.range.max, average),
        markers: { current: average, min: domainModel.range.min, max: domainModel.range.max },
      }),
  };

  const byKey = buildViewContent({ shared, viewState });
  const subtitle = buildSubtitleText(domainModel.subtitle, texts, metricKind);

  const chips = layout.visible.map((room) =>
    buildRoomChipModel({
      room,
      color: domainModel.roomColors[room.index],
      comfort: domainModel.comfort,
      unit,
      texts,
    })
  );

  return {
    empty: false,
    metric: {
      kind: metricKind,
      unit,
      displayUnitProfile: domainModel.metric.displayUnitProfile,
    },
    title,
    subtitle,
    tone,
    // The card root's own custom properties, built once and reused by the patch path.
    toneStyle: toneStyleDeclaration(tone),
    // The header's four slots, referencing the same strings rather than recomputing
    // them — a cohesive group for the renderer, not a second copy.
    header: { icon: tone.icon, title, subtitle, statusLabel: tone.label },
    average: averageModel,
    rooms: {
      visible: layout.visible,
      rowSizes: layout.rowSizes,
      count: rooms.count,
      comparable: rooms.comparable,
      // Whether the chip grid is DRAWN. Deliberately independent of `comparable`:
      // those are two different facts, and tying them together is why a card with a
      // primary and one room used to show no chip for it at all.
      //
      //   never   no grid; the rooms stay full data sources regardless
      //   always  a chip for every usable room — an explicit request outranks the
      //           redundancy rule below
      //   auto    chips unless the only room IS the headline, where a chip would
      //           print the same value twice
      //
      // Everything derived from the rooms — extrema, comfort count, spread, the
      // scale's markers — is unaffected by all three, because the rooms remain full
      // data sources whether or not they are drawn.
      showChips:
        config.show_rooms !== "never" &&
        chips.length >= 1 &&
        (config.show_rooms === "always" || !chipsWouldDuplicateHeadline(topology)),
      chips,
      chipRows: buildRoomChipRows(chips, layout.rowSizes),
    },
    extremes,
    roomMarkers,
    comfort: domainModel.comfort,
    spread: domainModel.spread,
    range,
    trend: { ...domainModel.trend, text: trendText },
    scale,
    rangeScale: byKey.range_scale ? byKey.range_scale.geometry : null,
    views: {
      keys: viewState.keys,
      entries: viewState.entries,
      options: viewState.options,
      collapsed: viewState.collapsed,
      hasRangeScale: viewState.hasRangeScale,
      byKey,
    },
    carousel: {
      hint: texts.t("rotator.hint"),
      // Shown instead of the view area when a view WAS requested but is systemically
      // unavailable — a state the user can actually fix. A deliberately empty views:
      // list collapses instead (views.collapsed), so a card configured with no views
      // does not display a hint that looks like a misconfiguration.
      noActiveViewsHint: texts.t("views.none"),
    },
  };
}

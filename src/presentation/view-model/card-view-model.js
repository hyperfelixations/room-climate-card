// Presentation boundary: finish translation, formatting, geometry and paint values here.
// Renderers receive no config or hass and perform none of those decisions themselves.
// `texts` is the only collaborator: translation plus number, unit and time formatting.

import { metricMetaFor } from "./metric-meta.js";
import { buildRoomChipModel, buildRoomChipRows, buildRoomLayout, decorateRoomForDisplay } from "./room-layout.js";
import { buildViewState } from "./view-state.js";
import { buildScaleAxis, resolveMarkerNudge } from "./scale-view-model.js";
import { SOURCE_TOPOLOGY, chipsWouldDuplicateHeadline } from "../../application/model/source-topology.js";
import { buildRoomMarker } from "./marker.js";
import { buildTone, toneStyleDeclaration, NO_DATA_COLOR } from "./tone.js";
import { buildViewContent } from "./view-content/index.js";
import { AVAILABILITY, UNUSABLE_REASON } from "../../application/model/entity-model.js";
import { CARD_NAME } from "../../core/card-metadata.js";
import { UNAVAILABLE_TEXT } from "../../core/text.js";
import { rgba } from "../../core/color.js";

const PLACEHOLDER_STATUSES = new Set([AVAILABILITY.UNAVAILABLE, AVAILABILITY.INVALID_VALUE]);

// No-data has no classification to adjust, so neutral colour and ink are identical.
function buildNeutralTone(icon, texts) {
  return {
    label: texts.t("status.noData"),
    color: NO_DATA_COLOR,
    ink: NO_DATA_COLOR,
    score: null,
    zone: "neutral",
    source: "availability",
    profileId: null,
    icon,
    soft: rgba(NO_DATA_COLOR, 0.20),
  };
}

// Join usable rooms with display-only placeholders by YAML index; never add missing or
// incompatible sources, or numeric data to placeholders.
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
    if (!config.show.unavailable_rooms || !PLACEHOLDER_STATUSES.has(availability?.status)) continue;
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
  // Missing rooms form an independent localized clause.
  if (subtitle.missingRooms > 0) {
    text += texts.t("subtitle.missingRooms", { count: subtitle.missingRooms });
  }
  return text;
}

// Normalize -0 and return empty text when footer and ARIA should omit an unusable trend.
export function buildTrendText(trend, texts) {
  if (!trend) return "";
  const value = Object.is(trend.value, -0) ? 0 : trend.value;
  return `${value > 0 ? "+" : ""}${texts.fmt(value)} ${trend.unit}`;
}

// Config-stable headline label priority: explicit value, direct-room name, none for a lone
// primary, otherwise the localized home average.
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
  // Collapse empty label and show-switch into one structural and tooltip decision.
  const hasLabel = label !== "" && config.show.entity_label;
  const valueText = texts.fmtWithUnit(value);

  // Calculated and captionless headlines use wording that does not imply an entity or colon.
  const tooltipKey = source === "calculated"
    ? (hasLabel ? "value.tooltipCalculated" : "value.tooltipCalculatedNoLabel")
    : (hasLabel ? "value.tooltip" : "value.tooltipNoLabel");
  const tooltip = texts.t(tooltipKey, { value: valueText, label });

  // Direct rooms reuse chip ARIA wording; unattributed averages describe themselves.
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
    // Forward direct-room ownership into the ordinary action path.
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

// One text mapping per unusable reason. `entity: true` marks actionable messages that must
// name what the reader should fix. Details: see internal dev doc §4 "No-Data-Vertrag".
const REASON_TEXTS = {
  [UNUSABLE_REASON.UNAVAILABLE]: { kind: "value-unavailable", key: "availability.valueUnavailable" },
  [UNUSABLE_REASON.NOT_NUMERIC]: { kind: "value-not-numeric", key: "availability.valueNotNumeric" },
  [UNUSABLE_REASON.OUT_OF_RANGE]: { kind: "value-impossible", key: "availability.valueImpossible" },
  [UNUSABLE_REASON.UNIT_AMBIGUOUS]: { kind: "unit-ambiguous", key: "availability.unitAmbiguous", entity: true },
  [UNUSABLE_REASON.UNIDENTIFIED]: { kind: "unidentified", key: "availability.unidentified", entity: true },
  [UNUSABLE_REASON.UNIT_UNREADABLE]: { kind: "unit-unreadable", key: "availability.unitUnreadable", entity: true },
  [UNUSABLE_REASON.KIND_MISMATCH]: { kind: "incompatible", key: "availability.incompatible" },
};

// Subtitle priority: forced no-data explanation, configured text, automatic sentence.
// Empty text removes the node; forced explanations temporarily outrank show.subtitle.
function buildHeaderSubtitle(config, automatic, { forced = null } = {}) {
  const own = config.subtitle?.text;
  const text = forced !== null ? forced : own === null || own === undefined ? automatic : own;
  // Collapse both absence requests; forced no-data explanation is the sole exception.
  const hasSubtitle = text !== "" && (forced !== null || config.show.subtitle);
  return { subtitle: text, hasSubtitle, subtitleOverflow: config.subtitle?.overflow || "clip" };
}

// Unwritten title uses the metric; empty text and show.title:false both remove the node.
function buildHeaderTitle(config, automatic) {
  const own = config.title?.text;
  const text = own === null || own === undefined ? automatic : own;
  return { title: text, hasTitle: text !== "" && config.show.title, titleOverflow: config.title?.overflow || "wrap" };
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
  // Missing rooms remain visible beside any headline-specific reason.
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
  const explained = REASON_TEXTS[headline.reason];
  if (explained) {
    return appendMissingRooms({
      kind: explained.kind,
      text: texts.t(explained.key, explained.entity ? { entity: headline.entity } : undefined),
    });
  }
  // Fallback for calculated headlines without a reason; modeled entities always have one.
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

// No-data keeps the normal shell contracts, neutral paint and a collapsed view area.
function buildNoDataViewModel({ domainModel, config, texts, topology, headerTitle, metricKind, meta }) {
  const title = headerTitle.title;
  const headline = noDataHeadlineSource(domainModel, config, topology);
  const label = resolveHeadlineLabel({ config, topology, roomIndex: headline.roomIndex, texts });
  const hasLabel = label !== "" && config.show.entity_label;
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
  // No-data always forces its explanation into the subtitle.
  const headerSubtitle = buildHeaderSubtitle(config, noData.text, { forced: noData.text });

  const displayRooms = buildDisplayRooms(domainModel, config);
  const decoratedRooms = displayRooms.map((room) => decorateRoomForDisplay(room, config.room_label));
  const layout = buildRoomLayout({ declaredRooms: decoratedRooms, config, metricKind, language: texts.language });
  const chips = layout.visible.map((room) => buildRoomChipModel({ room, color: null, comfort: null, unit: "", texts }));
  const showChips =
    config.show.rooms !== false &&
    chips.length >= 1 &&
    (config.show.rooms === true || !chipsWouldDuplicateHeadline(topology));

  return {
    empty: true,
    metric: { kind: metricKind, unit: "", displayUnitProfile: null },
    title,
    subtitle: headerSubtitle.subtitle,
    missingRooms: domainModel.missingRooms,
    configurationState: domainModel.configurationState,
    noData: { hintKind: noData.kind },
    tone,
    toneStyle: toneStyleDeclaration(tone),
    // Shared shell decisions for data and no-data states.
    accentLine: config.show.accent_line,
    hasPanel: config.show.panel,
    hiddenHint: texts.t("layout.nothingShown"),
    header: { icon, ...headerTitle, ...headerSubtitle, statusLabel, hasIcon: config.show.icon, hasPill: config.show.pill },
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
  // Reuse state-resolved topology for label and chip redundancy decisions.
  const topology = domainModel.topology;
  const metricKind = domainModel.metric.kind;
  const meta = metricKind ? metricMetaFor(metricKind) : null;
  const headerTitle = buildHeaderTitle(config, meta ? texts.t(meta.titleKey) : CARD_NAME);
  const title = headerTitle.title;

  if (domainModel.empty) {
    return buildNoDataViewModel({ domainModel, config, texts, topology, headerTitle, metricKind, meta });
  }

  const unit = domainModel.metric.unit;
  const formatBoundary = (value) => texts.fmtWithUnit(value, 0, false);
  const classification = domainModel.classification.average;
  const tone = buildTone({
    classification,
    // Look up the precomputed tint recipe; score changes must not trigger a search.
    tintRecipes: domainModel.tintRecipes,
    // Icon priority: config, active profile, stable metric default.
    icon: config.icon || domainModel.classification.profileIcon || meta.icon,
    texts,
  });

  // Decorate once in declaration order and reuse object identity across consumers.
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
  // Gate dereferences on the extrema object itself, the domain's single decision.
  const hasExtremes = Boolean(domainModel.extremes);
  const coolest = hasExtremes ? domainModel.extremes.coolest : null;
  const warmest = hasExtremes ? domainModel.extremes.warmest : null;

  // Include an independent average outside room extrema so its marker never clamps.
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

  // Build shared room markers once; view options decide whether to display them.
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

  // Shared finished inputs keep builders independent of domain/config/formatters.
  // Range-scale geometry stays lazy when the view is available but unrequested.
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
        // Include an average outside stale daily extrema so labels and marker agree.
        low: Math.min(domainModel.range.min, average),
        high: Math.max(domainModel.range.max, average),
        markers: { current: average, min: domainModel.range.min, max: domainModel.range.max },
      }),
  };

  const byKey = buildViewContent({ shared, viewState });
  const headerSubtitle = buildHeaderSubtitle(config, buildSubtitleText(domainModel.subtitle, texts, metricKind));

  const chips = layout.visible.map((room) =>
    buildRoomChipModel({
      room,
      color: domainModel.roomColors[room.index],
      comfort: domainModel.comfort,
      unit,
      texts,
      tintRecipes: domainModel.tintRecipes,
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
    subtitle: headerSubtitle.subtitle,
    tone,
    // Reused by the patch path.
    toneStyle: toneStyleDeclaration(tone),
    // Shared shell decisions for data and no-data states.
    accentLine: config.show.accent_line,
    hasPanel: config.show.panel,
    hiddenHint: texts.t("layout.nothingShown"),
    // Cohesive header slots share the already resolved strings.
    header: { icon: tone.icon, ...headerTitle, ...headerSubtitle, statusLabel: tone.label, hasIcon: config.show.icon, hasPill: config.show.pill },
    average: averageModel,
    rooms: {
      visible: layout.visible,
      rowSizes: layout.rowSizes,
      count: rooms.count,
      comparable: rooms.comparable,
      // Grid visibility is independent of comparability and calculations: false hides,
      // true overrides redundancy, auto hides only a direct single-room duplicate.
      showChips:
        config.show.rooms !== false &&
        chips.length >= 1 &&
        (config.show.rooms === true || !chipsWouldDuplicateHeadline(topology)),
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
      // Hint only when requested views are unavailable; an explicit empty list collapses.
      noActiveViewsHint: texts.t("views.none"),
    },
  };
}

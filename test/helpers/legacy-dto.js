"use strict";

// FROZEN. The flat `data` object the card produced before the rendering layer consumed
// the CardViewModel directly.
//
// This file used to live in src/presentation/view-model/ and was shipped in the bundle.
// It is not any more: no production module reads the flat shape, and an architecture
// test proves nothing under src/ can reach it. It survives here for exactly one reason —
// the 32 committed DTO baselines in test/baseline/model/ are a Phase 0 oracle recorded
// against the ORIGINAL monolithic card, and re-recording them would throw away the only
// independent evidence that the whole pipeline still computes what it always computed.
//
// It is therefore frozen in both senses:
//
//   - nothing may be added to it. An extra field would be an untested contract, and the
//     baselines would have to be re-recorded to accept it — which is precisely the thing
//     this file exists to avoid;
//   - it is test-only. It is not importable from src/, not reachable from the
//     composition root, and not present in dist/room-climate-card.js.
//
// When the baselines are eventually retired, this file goes with them.

// The three marker positions of the daily-range axis default to 0 when that view is
// not active, because the flat shape exposes them unconditionally.
const NO_RANGE_SCALE_POSITION = 0;

// The room-marker shape the flat object has always exposed. The structured model
// carries a shadow colour and a tooltip too, which are rendering values; projecting
// explicitly here keeps the frozen shape frozen instead of widening it whenever the
// marker model grows.
function toLegacyRoomMarker({ index, entity, name, value, position, color }) {
  return { index, entity, name, value, position, color };
}

function toLegacyData(viewModel) {
  if (viewModel.empty) {
    return {
      empty: true,
      metricType: viewModel.metric.kind,
      title: viewModel.title,
      missingRooms: viewModel.missingRooms,
      configurationState: viewModel.configurationState,
    };
  }

  const { scale, rangeScale, extremes, range, trend, rooms, views } = viewModel;

  return {
    empty: false,
    hasRoomsView: rooms.hasRoomsView,
    showRoomChips: rooms.showChips,
    hasRange: range.hasRange,
    rangeState: range.state,
    hasRangeScale: views.hasRangeScale,
    views: views.keys,
    viewOptions: views.options,
    viewAreaCollapsed: views.collapsed,
    metricType: viewModel.metric.kind,
    displayUnitProfile: viewModel.metric.displayUnitProfile,
    title: viewModel.title,
    avg: viewModel.average.value,
    avgLabel: viewModel.average.label,
    avgEntity: viewModel.average.entity,
    avgSource: viewModel.average.source,
    rooms: rooms.visible,
    roomCount: rooms.count,
    roomRows: rooms.rowSizes,
    coolest: extremes ? extremes.coolest : null,
    warmest: extremes ? extremes.warmest : null,
    spread: viewModel.spread,
    rangeMin: range.min,
    rangeMax: range.max,
    rangeMinTime: range.minTime,
    rangeMaxTime: range.maxTime,
    rangeMinColor: range.minColor,
    rangeMaxColor: range.maxColor,
    trendValue: trend.value,
    trendUnit: trend.unit,
    trend: trend.model,
    inComfort: viewModel.comfort.inComfort,
    comfortMin: viewModel.comfort.min,
    comfortMax: viewModel.comfort.max,
    // The scale model is spread flat: scaleMin/scaleMax, optimalMin/optimalMax, the
    // comfort and optimal band geometry, displayStep, markerPositions and
    // boundaryLabels all become top-level fields.
    ...scale,
    avgPos: viewModel.average.position,
    coolestPos: extremes ? extremes.coolestPosition : 0,
    warmestPos: extremes ? extremes.warmestPosition : 0,
    coolestShift: extremes ? extremes.coolestShift : 0,
    warmestShift: extremes ? extremes.warmestShift : 0,
    coolestColor: extremes ? extremes.coolestColor : null,
    warmestColor: extremes ? extremes.warmestColor : null,
    scaleRoomMarkers: viewModel.roomMarkers.map(toLegacyRoomMarker),
    avgColor: viewModel.average.color,
    tone: viewModel.tone,
    subtitle: viewModel.subtitle,
    rangeScaleGeometry: rangeScale,
    rangeCurrentPos: rangeScale ? rangeScale.markerPositions.current : NO_RANGE_SCALE_POSITION,
    rangeMinPos: rangeScale ? rangeScale.markerPositions.min : NO_RANGE_SCALE_POSITION,
    rangeMaxPos: rangeScale ? rangeScale.markerPositions.max : NO_RANGE_SCALE_POSITION,
  };
}

// Builds the flat object from a rendered card, through the same view model production
// renders from. The card no longer has a _computeData() of its own; this is what the
// element-level tests written against the flat shape call instead.
function computeLegacyData(element) {
  return toLegacyData(element._computeViewModel());
}

module.exports = { toLegacyData, computeLegacyData };

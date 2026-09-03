"use strict";

// Frozen test-only adapter: projects the current CardViewModel into the retired flat DTO
// captured by the three allowlisted characterization suites (element-ownership.test.js
// LEGACY_DTO_ALLOWLIST). Nothing may be added — an extra field would be an untested
// contract and force a baseline re-record, which this file exists to avoid. Not importable
// from src/. See internal dev doc §4 "Baseline- und Golden-Vertrag".
//
// The daily-range marker positions default to 0 when that view is inactive, since the flat
// shape exposes them unconditionally.
const NO_RANGE_SCALE_POSITION = 0;

// The room-marker shape the flat object exposes. Projected explicitly so the structured
// model's rendering fields (shadow colour, tooltip) do not widen the frozen shape.
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
    hasRoomsView: rooms.comparable,
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

// Builds the frozen flat oracle from the same current view model that production renders.
function computeLegacyData(element) {
  return toLegacyData(element._computeViewModel());
}

module.exports = { toLegacyData, computeLegacyData };

// Turning values into positions on the axis, as percentages.
//
// Percentages rather than pixels: the card's width is decided by the dashboard
// layout, so the only stable description of "where does this marker go" is a
// fraction of the bar. Everything here is a pure number — the pixel-level
// collision avoidance for LABELS is a rendering concern and lives elsewhere.

import { percentInRange } from "../../core/numbers.js";

// Left edge and width for a band, tolerant of an inverted pair.
export function rangePosition(minValue, maxValue, scaleMin, scaleMax) {
  const left = percentInRange(minValue, scaleMin, scaleMax);
  const right = percentInRange(maxValue, scaleMin, scaleMax);
  return {
    left: Math.min(left, right),
    width: Math.abs(right - left),
  };
}

// Everything needed to draw one scale bar's bands and edges. Both scale views use
// this same function with different bounds, which is what structurally guarantees
// identical geometry for identical input rather than leaving it to convention.
export function scaleGeometry(comfortMin, comfortMax, optimalMin, optimalMax, scaleMin, scaleMax) {
  const comfortBand = rangePosition(comfortMin, comfortMax, scaleMin, scaleMax);
  const optimalBand = rangePosition(optimalMin, optimalMax, scaleMin, scaleMax);
  return {
    scaleMin,
    scaleMax,
    optimalMin,
    optimalMax,
    comfortLeft: comfortBand.left,
    comfortWidth: comfortBand.width,
    comfortCenter: comfortBand.left + comfortBand.width / 2,
    optimalLeft: optimalBand.left,
    optimalWidth: optimalBand.width,
    optimalCenter: optimalBand.left + optimalBand.width / 2,
    // A data-anchored axis can legitimately sit wholly outside the semantic bands
    // (a winter outdoor scale at -3..9 °C, say). Their configured bounds stay in
    // the model, but a zero-width band or a label pinned to an axis edge would be
    // actively misleading, so visibility is reported separately.
    comfortVisible: comfortMax > scaleMin && comfortMin < scaleMax,
    optimalVisible: optimalMax > scaleMin && optimalMin < scaleMax,
  };
}

// One position per named marker, against the same axis the geometry above uses.
export function markerPositions(markers, scaleMin, scaleMax) {
  const positions = {};
  for (const key of Object.keys(markers || {})) {
    positions[key] = percentInRange(markers[key], scaleMin, scaleMax);
  }
  return positions;
}

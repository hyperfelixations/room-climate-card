// Turning values into positions on the axis, as percentages.
//
// Percentages, not pixels: the card's width is set by the dashboard layout, so the only
// stable position is a fraction of the bar. Pure numbers — pixel-level label collision
// avoidance is a rendering concern and lives elsewhere.

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

// Everything needed to draw one scale bar's bands and edges. Both scale views call this
// with different bounds, so identical input gives identical geometry by construction.
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
    // A data-anchored axis can sit wholly outside the semantic bands (a winter outdoor
    // scale at -3..9 °C). Their bounds stay in the model, but a zero-width band or an
    // edge-pinned label would mislead, so visibility is reported separately.
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

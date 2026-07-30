// A scale bar, from axis to labels.
//
// Everything on a scale bar is presentation: the axis bounds are chosen so the
// rendered bar covers the values it has to show, the band rectangles are
// percentages of that bar's width, the marker positions are percentages of the
// same, and the edge labels are formatted and unit-bearing. None of it is a fact
// about the measurement — a card showing the same reading on a narrower axis is
// showing the same reading.
//
// What the domain contributes is the axis POLICY (a profile's preferred bounds,
// step and anchoring) and the numbers to place on it. This module turns that into
// geometry.
//
// Both scale-shaped views call buildScaleAxis() with different bounds and markers,
// which is what structurally guarantees identical geometry for identical input.

import { dynamicScale } from "../../domain/scale/dynamic-scale.js";
import { markerPositions, scaleGeometry } from "../../domain/scale/geometry.js";

// How close two markers may sit before they are nudged apart, and by how much.
// A pixel nudge cannot exist in the domain: it is a statement about a rendered
// marker's width, not about the values behind it.
export const MARKER_OVERLAP_PCT = 1.6;
export const MARKER_NUDGE_PX = 4;

export function buildScaleAxis({ scaleConfig, displayUnitProfile, comfort, optimal, low, high, markers, formatBoundary }) {
  const axis = dynamicScale(low, high, scaleConfig, displayUnitProfile?.dynamicDisplaySteps);
  return {
    ...scaleGeometry(comfort.min, comfort.max, optimal.min, optimal.max, axis.min, axis.max),
    displayStep: axis.step,
    markerPositions: markerPositions(markers, axis.min, axis.max),
    boundaryLabels: {
      min: formatBoundary(axis.min),
      max: formatBoundary(axis.max),
    },
  };
}

// Two markers closer together than MARKER_OVERLAP_PCT would visually merge, so
// they are pushed apart symmetrically. Returns the two pixel offsets, never a
// changed percentage: the percentages stay value-derived, the nudge is purely
// optical.
export function resolveMarkerNudge(firstPosition, secondPosition) {
  const overlapping = Math.abs(secondPosition - firstPosition) < MARKER_OVERLAP_PCT;
  return { first: overlapping ? -MARKER_NUDGE_PX : 0, second: overlapping ? MARKER_NUDGE_PX : 0 };
}

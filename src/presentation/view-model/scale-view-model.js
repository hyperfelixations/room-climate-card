// Converts domain scale policy and values into presentation geometry and labels.
// All scale-shaped views share this path, guaranteeing identical geometry for
// identical inputs.

import { dynamicScale } from "../../domain/scale/dynamic-scale.js";
import { markerPositions, scaleGeometry } from "../../domain/scale/geometry.js";

// Optical marker separation; value-derived percentages remain unchanged.
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

// Returns symmetric pixel nudges when markers would visually merge.
export function resolveMarkerNudge(firstPosition, secondPosition) {
  const overlapping = Math.abs(secondPosition - firstPosition) < MARKER_OVERLAP_PCT;
  return { first: overlapping ? -MARKER_NUDGE_PX : 0, second: overlapping ? MARKER_NUDGE_PX : 0 };
}

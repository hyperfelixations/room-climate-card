// One marker on a scale bar.
//
// A marker is a position, a colour, its own drop shadow and a tooltip. The shadow
// is an rgba() derivation of the colour, which is exactly why markers are built
// here and not in the domain: the position is a percentage of a rendered bar and
// the shadow is a CSS value, neither of which is a fact about the reading.
//
// shiftPx exists only for the two extrema markers, which are nudged apart when they
// would otherwise visually merge (see resolveMarkerNudge()). It is always 0 for
// every other marker, so the render and patch paths need no special case.

import { rgba } from "../../core/color.js";

// The two shadow alphas. Room markers are deliberately fainter: with `markers:all`
// there can be a dozen of them, and the extrema plus the average stay the ones the
// eye is drawn to.
const MARKER_SHADOW_ALPHA = 0.28;
const ROOM_MARKER_SHADOW_ALPHA = 0.22;

export function buildMarker({ position, color, title, shiftPx = 0, shadowAlpha = MARKER_SHADOW_ALPHA }) {
  return {
    position,
    shiftPx,
    color,
    shadow: rgba(color, shadowAlpha),
    title,
  };
}

export function buildRoomMarker({ room, position, color, title }) {
  return {
    ...buildMarker({ position, color, title, shadowAlpha: ROOM_MARKER_SHADOW_ALPHA }),
    index: room.index,
    entity: room.entity,
    name: room.name,
    value: room.value,
  };
}

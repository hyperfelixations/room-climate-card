// Presentation marker with percentage geometry and CSS shadow.
// `shiftPx` nudges colliding extrema; all other markers use zero.

import { rgba } from "../../core/color.js";

// Room-marker shadows stay fainter so extrema and average retain emphasis.
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

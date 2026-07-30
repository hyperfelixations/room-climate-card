// The extreme-value view's content model: two cards for the coldest and the warmest
// room (or the driest and most humid, or the lowest and highest — the noun is
// metric-specific).
//
// The two slots are role-keyed, not entity-keyed. When a different room becomes the
// coldest, the SAME slot shows the new room — the slot is continuously "the coldest
// room", the way a value display is continuously "the current reading" regardless of
// which sensor briefly backs it. That is also what lets the patch path reuse the
// node and keep focus.

import { extremeRoomLabel } from "../metric-meta.js";
import { buildMetricCardModel } from "../metric-card.js";

export function buildExtremesViewContent(shared, options) {
  const { texts, extremes, metricKind, roomColors, unit } = shared;
  const showValue = options.show_value;
  const card = (role, room) =>
    buildMetricCardModel({
      label: extremeRoomLabel(role, metricKind, texts),
      name: room.name,
      value: room.value,
      entity: room.entity,
      color: roomColors[room.index],
      roomIndex: room.index,
      unit,
      texts,
      showValue,
    });

  return {
    key: "extremes",
    // Order is structural, and the patch path relies on it: coldest first.
    cards: [card("cold", extremes.coolest), card("warm", extremes.warmest)],
  };
}

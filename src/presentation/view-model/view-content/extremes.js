// Metric-specific low/high cards use stable role keys, not entity keys, so patching
// can reuse focused nodes when a different room becomes an extreme.

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
    // Structural patch order: low first, high second.
    cards: [card("cold", extremes.coolest), card("warm", extremes.warmest)],
  };
}

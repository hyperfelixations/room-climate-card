// Daily min/max are attributes of one range entity, so both cards use default actions.
// `show_time` controls the name slot; absent timestamps omit that slot without a placeholder.

import { buildMetricCardModel } from "../metric-card.js";

export function buildRangeViewContent(shared, options) {
  const { texts, range, unit, rangeEntity } = shared;
  const card = (labelKey, name, value, color) =>
    buildMetricCardModel({
      label: texts.t(labelKey),
      name,
      value,
      entity: rangeEntity,
      color,
      unit,
      texts,
      showName: Boolean(options.show_time && name),
    });

  return {
    key: "range",
    // Structural patch order: minimum first, maximum second.
    cards: [
      card("card.dailyMinimum", range.minTime, range.min, range.minColor),
      card("card.dailyMaximum", range.maxTime, range.max, range.maxColor),
    ],
  };
}

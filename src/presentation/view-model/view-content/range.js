// The daily-range view's content model: two cards for today's minimum and maximum.
//
// Both cards read the same entity — minimum and maximum are attributes of the one
// configured range entity, not two separate sensors — so neither card carries a room
// index and the action layer falls back to the card's default actions.
//
// show_time drives the cards' name slot, which is where their timestamp goes. The
// value itself is unaffected either way.

import { buildMetricCardModel } from "../metric-card.js";

export function buildRangeViewContent(shared, options) {
  const { texts, range, unit, rangeEntity } = shared;
  const showName = options.show_time;
  const card = (labelKey, name, value, color) =>
    buildMetricCardModel({ label: texts.t(labelKey), name, value, entity: rangeEntity, color, unit, texts, showName });

  return {
    key: "range",
    // Order is structural, and the patch path relies on it: minimum first, maximum
    // second.
    cards: [
      card("card.dailyMinimum", range.minTime, range.min, range.minColor),
      card("card.dailyMaximum", range.maxTime, range.max, range.maxColor),
    ],
  };
}

// The main scale view's content model.
//
// A dynamic axis with a comfort band, an optimal band and one to N markers. The
// marker set is an option: "average" leaves only the average, "extremes" is the
// established coldest+warmest+average set, "all" adds every valid room.
//
// The band toggles are purely visual. The comfort and optimal bounds, the
// classification, the footer text and the marker colours are all computed
// independently and never read them, so switching a band off changes what is drawn
// and nothing else.

import { extremeRoomLabel } from "../metric-meta.js";
import { buildMarker } from "../marker.js";
import { buildScaleBarContent } from "./scale-bar.js";

// The room-bound footer: how many rooms sit inside the comfort band, how far apart
// the extremes are, and — only when a trend entity is configured and reporting — the
// signed rate as an independently optional third segment.
function buildFooterText(shared) {
  const { texts, comfort, rooms, spread, trend } = shared;
  const segments = [
    texts.t("footer.comfort", { count: comfort.inComfort, total: rooms.count }),
    texts.t("footer.spread", { value: texts.fmtWithUnit(spread) }),
  ];
  if (trend.model) segments.push(texts.t("footer.trend", { value: trend.text }));
  return segments.join(" · ");
}

export function buildScaleViewContent(shared, options) {
  const { texts, comfort, average, rooms, extremes, roomMarkers, scale, metricKind, hideFooter } = shared;
  const markersMode = options.markers;
  // With every room marked, the average needs extra visual weight to stay findable
  // among them.
  const emphasizeAverage = markersMode === "all" && Boolean(extremes);

  return {
    key: "scale",
    ...buildScaleBarContent({
      geometry: scale,
      texts,
      showComfortBand: options.show_comfort_band,
      showOptimalBand: options.show_optimal_band,
      // Deliberately tied to rooms.comparable: two of the three segments are statements
      // about rooms. The global hide_footer and this view's own footer option are
      // ANDed with it.
      footerText: rooms.comparable && !hideFooter && options.footer !== false ? buildFooterText(shared) : null,
    }),
    comfortLabel: options.show_comfort_band
      ? {
          text: texts.t("scale.comfortLabel", {
            range: `${texts.fmt(comfort.min, 0)}–${texts.fmtWithUnit(comfort.max, 0, false)}`,
          }),
          center: scale.comfortCenter,
          visible: scale.comfortVisible,
        }
      : null,
    emphasizeAverage,
    markers: {
      // Gated on the extremes object itself, never on rooms.comparable: one source of
      // truth for "there are two rooms to compare", and no branch that could read a
      // position off null.
      extremes:
        extremes && markersMode === "extremes"
          ? {
              cold: buildMarker({
                position: extremes.coolestPosition,
                shiftPx: extremes.coolestShift,
                color: extremes.coolestColor,
                title: `${extremeRoomLabel("cold", metricKind, texts)}: ${extremes.coolest.name} ${texts.fmtWithUnit(extremes.coolest.value)}`,
              }),
              warm: buildMarker({
                position: extremes.warmestPosition,
                shiftPx: extremes.warmestShift,
                color: extremes.warmestColor,
                title: `${extremeRoomLabel("warm", metricKind, texts)}: ${extremes.warmest.name} ${texts.fmtWithUnit(extremes.warmest.value)}`,
              }),
            }
          : null,
      rooms: markersMode === "all" ? roomMarkers : [],
      average: buildMarker({
        position: average.position,
        color: average.color,
        // Mirrors the headline's caption, including its absence: a card without one
        // must not give its average marker a tooltip starting with ": ".
        title: texts.t(average.hasLabel ? "value.tooltip" : "value.tooltipNoLabel", {
          value: texts.fmtWithUnit(average.value),
          label: average.label,
        }),
      }),
    },
  };
}

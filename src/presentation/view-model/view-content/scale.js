// Main dynamic scale with optional bands and average, extrema or all-room markers.
// Band toggles affect drawing only, never classification, footer data or colours.

import { extremeRoomLabel } from "../metric-meta.js";
import { buildMarker } from "../marker.js";
import { buildScaleBarContent } from "./scale-bar.js";

// Room footer combines comfort count, spread and an optional reporting trend.
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
  // Emphasize average among all-room markers.
  const emphasizeAverage = markersMode === "all" && Boolean(extremes);

  return {
    key: "scale",
    ...buildScaleBarContent({
      geometry: scale,
      texts,
      showComfortBand: options.show_comfort_band,
      showOptimalBand: options.show_optimal_band,
      // Room-dependent footer also respects global and per-view visibility.
      footerText: rooms.comparable && !hideFooter && options.show_footer ? buildFooterText(shared) : null,
    }),
    // Layout selects long or short comfort text from measured width.
    comfortLabel: options.show_comfort_band
      ? (() => {
          const range = `${texts.fmt(comfort.min, 0)}–${texts.fmtWithUnit(comfort.max, 0, false)}`;
          return {
            long: texts.t("scale.comfortLabel", { range }),
            short: texts.t("scale.comfortLabelShort", { range }),
            center: scale.comfortCenter,
            visible: scale.comfortVisible,
          };
        })()
      : null,
    emphasizeAverage,
    markers: {
      // The extremes object alone proves positions are available.
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
        // Mirror optional headline caption without producing an empty tooltip prefix.
        title: texts.t(average.hasLabel ? "value.tooltip" : "value.tooltipNoLabel", {
          value: texts.fmtWithUnit(average.value),
          label: average.label,
        }),
      }),
    },
  };
}

// Main dynamic scale with optional bands and average, extrema or all-room markers.
// Band toggles affect drawing only, never classification, footer data or colours.

import { boolOption, enumOption } from "../../../config/option-schemas.js";
import { UNAVAILABLE_TEXT } from "../../../core/text.js";
import { extremeRoomLabel } from "../metric-meta.js";
import { buildMarker } from "../marker.js";
import { buildBandLabelForms, buildScaleBarContent, hasCompactForm } from "./scale-bar.js";

// Room footer combines comfort count, spread and an optional reporting trend. A spread no
// double can hold is null and shown as the card's no-number text. `spreadText` writes the
// spread, so the compact form differs only there.
function buildFooterText(shared, spreadText) {
  const { texts, comfort, rooms, spread, trend } = shared;
  const segments = [
    texts.t("footer.comfort", { count: comfort.inComfort, total: rooms.count }),
    texts.t("footer.spread", { value: spread === null ? UNAVAILABLE_TEXT : spreadText(spread) }),
  ];
  if (trend.model) segments.push(texts.t("footer.trend", { value: trend.text }));
  return segments.join(" · ");
}

// The footer with a short-scale spread, or null when the spread has none.
function buildCompactFooterText(shared) {
  const { texts, spread, unit } = shared;
  if (spread === null || !hasCompactForm(spread)) return null;
  return buildFooterText(shared, (value) => `${texts.fmtCompact(value)} ${unit}`);
}

export function buildScaleViewContent(shared, options) {
  const { texts, comfort, average, rooms, extremes, roomMarkers, scale, metricKind, unit } = shared;
  const showFooter = rooms.comparable && options.show_footer;
  const markersMode = options.markers;
  // Emphasize average among all-room markers.
  const emphasizeAverage = markersMode === "all" && Boolean(extremes);

  return {
    key: "scale",
    ...buildScaleBarContent({
      geometry: scale,
      texts,
      unit,
      showComfortBand: options.show_comfort_band,
      showOptimalBand: options.show_optimal_band,
      // Room-dependent footer also respects per-view visibility.
      footerText: showFooter ? buildFooterText(shared, (value) => texts.fmtWithUnit(value)) : null,
      compactFooterText: showFooter ? buildCompactFooterText(shared) : null,
    }),
    // Layout keeps the first comfort form that fits its measured width.
    comfortLabel: options.show_comfort_band
      ? {
          ...buildBandLabelForms(texts, unit, {
            min: comfort.min,
            max: comfort.max,
            longKey: "scale.comfortLabel",
            shortKey: "scale.comfortLabelShort",
          }),
          center: scale.comfortCenter,
          visible: scale.comfortVisible,
        }
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

export const scaleViewDefinition = Object.freeze({
  key: "scale",
  condition: () => true,
  // An explicit `views` list may still omit the otherwise-default scale.
  defaultEnabled: () => true,
  // Band toggles are visual only. Marker modes select average, extrema or all rooms.
  optionsSchema: {
    show_comfort_band: boolOption(true),
    show_optimal_band: boolOption(true),
    show_footer: boolOption(true),
    markers: enumOption("extremes", ["average", "extremes", "all"]),
  },
  buildContent: buildScaleViewContent,
});

// Daily min/max reuse the main scale geometry with three declutterable top labels.
// Current is the fixed live-value pivot; historical min/max may shift. Raw values
// determine order, while formatted `sortKey` is used only for equality/tie detection
// and must never be parsed (grouped display text is not numeric input).

import { boolOption, enumOption } from "../../../config/option-schemas.js";
import { buildMarker } from "../marker.js";
import { buildScaleBarContent, hasCompactForm } from "./scale-bar.js";

// Translations own timestamp brackets and spacing; missing timestamps add nothing.
function timeSuffix(texts, time) {
  return time ? texts.t("rangeScale.footerTime", { time }) : "";
}

// Uses the range entity's state as the span, never `max - min`; compact mode omits times.
// `valueText` writes each number, so the short-scale form differs only there.
function buildFooterText(shared, mode, valueText) {
  const { texts, range } = shared;
  return texts.t(mode === "compact" ? "rangeScale.footerCompact" : "rangeScale.footer", {
    span: valueText(range.state),
    min: valueText(range.min),
    minTime: timeSuffix(texts, range.minTime),
    max: valueText(range.max),
    maxTime: timeSuffix(texts, range.maxTime),
  });
}

// The footer with short-scale numbers, or null when none of them has that form.
function buildCompactFooterText(shared, mode) {
  const { texts, range, unit } = shared;
  if (!hasCompactForm(range.state, range.min, range.max)) return null;
  return buildFooterText(shared, mode, (value) => `${texts.fmtCompact(value)} ${unit}`);
}

export function buildRangeScaleViewContent(shared, options, axis) {
  const { texts, average, range, unit } = shared;
  const positions = axis.markerPositions;

  return {
    key: "range_scale",
    ...buildScaleBarContent({
      geometry: axis,
      texts,
      unit,
      showComfortBand: options.show_comfort_band,
      showOptimalBand: options.show_optimal_band,
      // Daily span remains available with zero comparable rooms.
      footerText: options.show_footer ? buildFooterText(shared, options.footer, (value) => texts.fmtWithUnit(value)) : null,
      compactFooterText: options.show_footer ? buildCompactFooterText(shared, options.footer) : null,
    }),
    topLabels: {
      current: {
        long: texts.t("rangeScale.currentLabel"),
        short: texts.t("rangeScale.currentLabelShort"),
        position: positions.current,
        sortKey: texts.fmt(average.value),
        value: average.value,
      },
      // Min-before-max order and semanticRank resolve indistinguishable display values.
      sides: [
        { role: "min", text: texts.t("rangeScale.minLabel"), position: positions.min, value: range.min, sortKey: texts.fmt(range.min), semanticRank: 0 },
        { role: "max", text: texts.t("rangeScale.maxLabel"), position: positions.max, value: range.max, sortKey: texts.fmt(range.max), semanticRank: 2 },
      ],
    },
    markers: {
      // Min/max reuse the extrema marker shapes with view-specific meaning.
      min: buildMarker({
        position: positions.min,
        color: range.minColor,
        title: [texts.t("card.dailyMinimum") + ":", range.minTime, texts.fmtWithUnit(range.min)].filter(Boolean).join(" "),
      }),
      max: buildMarker({
        position: positions.max,
        color: range.maxColor,
        title: [texts.t("card.dailyMaximum") + ":", range.maxTime, texts.fmtWithUnit(range.max)].filter(Boolean).join(" "),
      }),
      average: buildMarker({
        position: positions.current,
        color: average.color,
        title: texts.t("value.tooltip", { value: texts.fmtWithUnit(average.value), label: texts.t("rangeScale.currentLabel") }),
      }),
    },
  };
}

export const rangeScaleViewDefinition = Object.freeze({
  key: "range_scale",
  // Availability and user activation remain separate.
  condition: (availability) => availability.rangeScaleAvailable,
  // The only view disabled by default because it mirrors the main scale shape.
  defaultEnabled: () => false,
  height: 70,
  // Band toggles suppress both band and label. `show_footer` controls presence;
  // `footer` selects compact/detailed form.
  optionsSchema: {
    show_comfort_band: boolOption(true),
    show_optimal_band: boolOption(true),
    show_footer: boolOption(true),
    footer: enumOption("detailed", ["compact", "detailed"]),
  },
  // The axis is built here, so an inactive view never computes it.
  buildContent: (shared, options) => buildRangeScaleViewContent(shared, options, shared.buildRangeScaleAxis()),
});

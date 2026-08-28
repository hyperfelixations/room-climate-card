// The daily-range scale view's content model.
//
// Same bar as the main scale view, different meaning: the markers show today's
// minimum and maximum instead of the coldest and warmest room, and the top row
// carries three labels above their own markers instead of a single comfort pill.
//
// The three top labels overlap easily, so this model carries what the layout pass
// needs to declutter them without formatting anything itself:
//
//   current  a fixed pivot, never repositioned — it is the primary live value and
//            has no visual identity distinct from the marker above it, so a drifted
//            current label would read as belonging to whichever marker it ended up
//            nearest. Long and short form, chosen at measure time.
//   min/max  historical context values that can absorb a shift. Each carries its
//            numeric value for ordering and a sortKey for tie detection.
//
// sortKey is compared for EQUALITY only and never parsed back into a number: a
// grouped display value ("1,200") is not valid numeric input, and an earlier version
// that re-parsed it compared as NaN for every value above 999. Actual ordering uses
// the raw numeric value.

import { buildMarker } from "../marker.js";
import { buildScaleBarContent } from "./scale-bar.js";

// A timestamp as it appears beside its value, brackets and all — or nothing at all when
// there is no timestamp to show.
//
// The brackets belong to the TRANSLATION rather than to this file, because where they go
// and which ones to use is a question about a language: Japanese and Chinese use
// full-width brackets and no leading space. Putting the whole parenthetical in the value
// is also what lets one sentence serve all four cases — both times, either one, or
// neither — instead of four sentences per language.
function timeSuffix(texts, time) {
  return time ? texts.t("rangeScale.footerTime", { time }) : "";
}

// Today's span (the range entity's own state, never max - min), plus the daily extremes
// and, when the entity reports them, their timestamps. "compact" is the same sentence
// with both timestamps dropped for want of room — a separate translation, because
// truncating a sentence here would have to guess each language's punctuation.
function buildFooterText(shared, mode) {
  const { texts, range } = shared;
  return texts.t(mode === "compact" ? "rangeScale.footerCompact" : "rangeScale.footer", {
    span: texts.fmtWithUnit(range.state),
    min: texts.fmtWithUnit(range.min),
    minTime: timeSuffix(texts, range.minTime),
    max: texts.fmtWithUnit(range.max),
    maxTime: timeSuffix(texts, range.maxTime),
  });
}

export function buildRangeScaleViewContent(shared, options, axis) {
  const { texts, average, range } = shared;
  const positions = axis.markerPositions;

  return {
    key: "range_scale",
    ...buildScaleBarContent({
      geometry: axis,
      texts,
      showComfortBand: options.show_comfort_band,
      showOptimalBand: options.show_optimal_band,
      // Deliberately NOT tied to rooms.comparable, unlike the main scale's footer: this
      // view must show its daily span with zero rooms configured.
      footerText: !options.show_footer || shared.hideFooter ? null : buildFooterText(shared, options.footer),
    }),
    topLabels: {
      current: {
        long: texts.t("rangeScale.currentLabel"),
        short: texts.t("rangeScale.currentLabelShort"),
        position: positions.current,
        sortKey: texts.fmt(average.value),
        value: average.value,
      },
      // Ordered min-before-max, which is also the tie-break order: semanticRank
      // places min left of current and max right of it when their displayed values
      // are indistinguishable.
      sides: [
        { role: "min", text: texts.t("rangeScale.minLabel"), position: positions.min, value: range.min, sortKey: texts.fmt(range.min), semanticRank: 0 },
        { role: "max", text: texts.t("rangeScale.maxLabel"), position: positions.max, value: range.max, sortKey: texts.fmt(range.max), semanticRank: 2 },
      ],
    },
    markers: {
      // Reuses the cold/warm marker shapes for min/max: identical CSS, different
      // meaning in this view.
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

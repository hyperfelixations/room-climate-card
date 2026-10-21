// Shared scale-bar contract for comfort/optimal bands, labels and boundaries.
// Every label carries the forms layout falls back through, widest first; layout keeps the
// first that fits its measured width. See internal dev doc §5 "Grenzbeschriftungen".

// From here on a number has a short-scale form ("3.4K") worth offering as a fallback.
const COMPACT_FROM = 1000;

export const hasCompactForm = (...values) => values.some((value) => Math.abs(value) >= COMPACT_FROM);

// An axis boundary with its unit; the compact form is null where it would read the same.
export function buildBoundaryLabel(texts, unit, value) {
  return `${texts.fmtBoundary(value)}${unit}`;
}

export function buildCompactBoundaryLabel(texts, unit, value) {
  return hasCompactForm(value) ? `${texts.fmtCompact(value)}${unit}` : null;
}

// A band's two bounds, as one string. The dash form is unreadable once a bound is
// negative ("-24–-15"), so such a band switches to the language's own range wording and
// signs both bounds; a band that stays at or above zero keeps the dash. `compact` writes
// both bounds in the short scale. See internal dev doc §5 "i18n und sprachabhängige Formatierung".
export function buildBandRangeText(texts, unit, min, max, { compact = false } = {}) {
  const format = compact ? texts.fmtCompact : texts.fmtBoundary;
  if (min < 0 || max < 0) {
    return texts.t("scale.bandRangeSigned", {
      min: format(min, { signed: true }),
      max: `${format(max, { signed: true })}${unit}`,
    });
  }
  return `${format(min)}–${format(max)}${unit}`;
}

// A band label's forms: long and short wording, then the short wording with compact bounds
// when they are large enough to have them.
export function buildBandLabelForms(texts, unit, { min, max, longKey, shortKey }) {
  const range = buildBandRangeText(texts, unit, min, max);
  return {
    long: texts.t(longKey, { range }),
    short: texts.t(shortKey, { range }),
    compact: hasCompactForm(min, max) ? texts.t(shortKey, { range: buildBandRangeText(texts, unit, min, max, { compact: true }) }) : null,
  };
}

export function buildScaleBarContent({ geometry, texts, unit, showComfortBand, showOptimalBand, footerText, compactFooterText = null }) {
  return {
    geometry,
    showComfortBand,
    showOptimalBand,
    optimalLabel: showOptimalBand
      ? {
          ...buildBandLabelForms(texts, unit, {
            min: geometry.optimalMin,
            max: geometry.optimalMax,
            longKey: "scale.optimalLabel",
            shortKey: "scale.optimalLabelShort",
          }),
          center: geometry.optimalCenter,
          visible: geometry.optimalVisible,
        }
      : null,
    boundaryLabels: geometry.boundaryLabels,
    compactBoundaryLabels: geometry.compactBoundaryLabels,
    footerText,
    compactFooterText: footerText === null ? null : compactFooterText,
  };
}

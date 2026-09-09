// Shared scale-bar contract for comfort/optimal bands, labels and boundaries.
// Long and short optimal labels remain paired so layout can choose from measured width.

// A band's two bounds, as one string. The dash form is unreadable once a bound is
// negative ("-24–-15"), so such a band switches to the language's own range wording and
// signs both bounds; a band that stays at or above zero keeps the dash.
// See internal dev doc §6 "i18n und sprachabhängige Formatierung".
export function buildBandRangeText(texts, min, max) {
  if (min < 0 || max < 0) {
    return texts.t("scale.bandRangeSigned", {
      min: texts.fmtSigned(min, 0),
      max: texts.fmtSignedWithUnit(max, 0, false),
    });
  }
  return `${texts.fmt(min, 0)}–${texts.fmtWithUnit(max, 0, false)}`;
}

export function buildScaleBarContent({ geometry, texts, showComfortBand, showOptimalBand, footerText }) {
  const range = buildBandRangeText(texts, geometry.optimalMin, geometry.optimalMax);
  return {
    geometry,
    showComfortBand,
    showOptimalBand,
    optimalLabel: showOptimalBand
      ? {
          long: texts.t("scale.optimalLabel", { range }),
          short: texts.t("scale.optimalLabelShort", { range }),
          center: geometry.optimalCenter,
          visible: geometry.optimalVisible,
        }
      : null,
    boundaryLabels: geometry.boundaryLabels,
    footerText,
  };
}

// Shared scale-bar contract for comfort/optimal bands, labels and boundaries.
// Long and short optimal labels remain paired so layout can choose from measured width.

export function buildScaleBarContent({ geometry, texts, showComfortBand, showOptimalBand, footerText }) {
  const range = `${texts.fmt(geometry.optimalMin, 0)}–${texts.fmtWithUnit(geometry.optimalMax, 0, false)}`;
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

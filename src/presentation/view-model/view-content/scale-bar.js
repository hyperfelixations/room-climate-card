// What the two scale-shaped views have in common.
//
// The comfort band, the optimal band, the optimal label and the two edge labels are
// identical between the main scale and the daily-range scale — same markup, same
// geometry contract, different bounds. Building them once here is what structurally
// guarantees the two views cannot drift apart.
//
// The optimal label is resolved as a PAIR of texts, not one. A collision-prone label
// is never permanently shortened in the translations; instead both a canonical long
// form and a short fallback exist, and the layout pass picks between them at measure
// time against the actual rendered width. Choosing here would mean guessing from
// character counts.

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

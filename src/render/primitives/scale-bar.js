// The scale bar every scale-shaped view is built from.
//
// One markup template, two callers: the main scale (room-based bounds) and the
// daily-range scale (min/max-based bounds). Only three things differ between them and
// all three are passed in — the top row, the markers and the wrapper class. The
// comfort band, the optimal band, the two edge labels and the footer are shared, and
// that sharing is what makes the two views structurally identical.
//
// Switching a band off is purely a markup omission: neither the band div nor its
// descriptive label is emitted, and the patch path's querySelector guards already
// no-op on their absence.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literal is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../../core/text.js";

export function renderScaleBar({ content, viewClass, topRowHtml, markersHtml }) {
  const geometry = content.geometry;
  const footer = content.footerText ? `<div class="rtc-scale-footer">${escapeHtml(content.footerText)}</div>` : "";
  const comfortBandHtml = content.showComfortBand
    ? `<div class="rtc-comfort-band" style="left:${geometry.comfortLeft}%;width:${geometry.comfortWidth}%;"${geometry.comfortVisible ? "" : " hidden"}></div>`
    : "";
  const optimalBandHtml = content.showOptimalBand
    ? `<div class="rtc-optimal-band" style="left:${geometry.optimalLeft}%;width:${geometry.optimalWidth}%;"${geometry.optimalVisible ? "" : " hidden"}></div>`
    : "";
  // The long form is emitted first, always. The layout pass may swap in the short
  // form once it can measure the real rendered width (see render/layout/).
  const optimalLabelHtml = content.optimalLabel
    ? `<span class="rtc-scale-label-center" style="left:${content.optimalLabel.center}%"${content.optimalLabel.visible ? "" : " hidden"}>${escapeHtml(content.optimalLabel.long)}</span>`
    : "";

  return `
        <div class="${viewClass}">
          ${topRowHtml}

          <div class="rtc-scale-bar">
            ${comfortBandHtml}
            ${optimalBandHtml}
            ${markersHtml}
          </div>

          <div class="rtc-scale-labels">
            <span class="rtc-scale-label-min">${escapeHtml(content.boundaryLabels.min)}</span>
            ${optimalLabelHtml}
            <span class="rtc-scale-label-max rtc-scale-max">${escapeHtml(content.boundaryLabels.max)}</span>
          </div>

          ${footer}
        </div>
      `;
}

// The shared partial update: band positions, band visibility, the footer text and the
// two edge labels. Scoped to the view's own container rather than the whole root,
// because both scale-shaped views can be mounted at once — the carousel keeps every
// view in the DOM — and they share the same inner class names.
//
// The optimal label's own text and position are deliberately NOT touched here. They
// are owned by the layout pass, which picks between the long and short form against
// the measured width, so there is exactly one place that decides them.
export function patchScaleBar(containerEl, content) {
  if (!containerEl) return;
  const geometry = content.geometry;

  const comfortBandEl = containerEl.querySelector(".rtc-comfort-band");
  if (comfortBandEl) {
    comfortBandEl.style.left = `${geometry.comfortLeft}%`;
    comfortBandEl.style.width = `${geometry.comfortWidth}%`;
    comfortBandEl.hidden = !geometry.comfortVisible;
  }

  const optimalBandEl = containerEl.querySelector(".rtc-optimal-band");
  if (optimalBandEl) {
    optimalBandEl.style.left = `${geometry.optimalLeft}%`;
    optimalBandEl.style.width = `${geometry.optimalWidth}%`;
    optimalBandEl.hidden = !geometry.optimalVisible;
  }

  // A footer only exists in the DOM when this view's own render pass decided to show
  // one, so the guard doubles as the "no footer in this view" case.
  const footerEl = containerEl.querySelector(".rtc-scale-footer");
  if (footerEl) footerEl.textContent = content.footerText;

  const optimalLabelEl = containerEl.querySelector(".rtc-scale-label-center");
  if (optimalLabelEl) optimalLabelEl.hidden = !geometry.optimalVisible;

  const labelMinEl = containerEl.querySelector(".rtc-scale-label-min");
  if (labelMinEl) labelMinEl.textContent = content.boundaryLabels.min;

  const labelMaxEl = containerEl.querySelector(".rtc-scale-label-max");
  if (labelMaxEl) labelMaxEl.textContent = content.boundaryLabels.max;
}

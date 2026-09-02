// Shared scale-bar template; callers inject wrapper, top row and markers.
// Disabled bands omit their markup; template-literal indentation is shipped and baseline-pinned.

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
  // Emit long form; measured layout may select the short form.
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

// Patch within one view because both scale shapes share inner classes and remain mounted.
// Measured layout exclusively owns optimal-label form and position.
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

  // Missing footer node means this view omitted it structurally.
  const footerEl = containerEl.querySelector(".rtc-scale-footer");
  if (footerEl) footerEl.textContent = content.footerText;

  const optimalLabelEl = containerEl.querySelector(".rtc-scale-label-center");
  if (optimalLabelEl) optimalLabelEl.hidden = !geometry.optimalVisible;

  const labelMinEl = containerEl.querySelector(".rtc-scale-label-min");
  if (labelMinEl) labelMinEl.textContent = content.boundaryLabels.min;

  const labelMaxEl = containerEl.querySelector(".rtc-scale-label-max");
  if (labelMaxEl) labelMaxEl.textContent = content.boundaryLabels.max;
}

// Shared tappable metric card keeps daily-range and room-extreme views visually identical.
// Template-literal indentation is shipped markup and baseline-pinned.

import { escapeHtml } from "../../core/text.js";

export function renderMetricCard(model) {
  // Only real rooms carry per-room action ownership.
  const roomIndexAttr = model.roomIndex !== null ? ` data-room-index="${model.roomIndex}"` : "";

  return `
        <button
          type="button"
          class="rtc-extreme-card"
          data-entity="${escapeHtml(model.entity)}"${roomIndexAttr}
          style="--extreme-color:${model.color};--extreme-bg:${model.background};--extreme-border:${model.border};--extreme-line-shadow:${model.lineShadow};"
          title="${escapeHtml(model.title)}"
          aria-label="${escapeHtml(model.ariaLabel)}"
        >
          <span class="rtc-extreme-line"></span>
          <span class="rtc-extreme-label">${escapeHtml(model.label)}</span>
          <span class="rtc-extreme-name">${escapeHtml(model.nameText)}</span>
          <span class="rtc-extreme-value"><span class="rtc-extreme-value-num">${escapeHtml(model.numText)}</span><span class="rtc-extreme-value-unit">${escapeHtml(model.unitText)}</span></span>
        </button>
      `;
}

// Mirror renderMetricCard(); update custom properties without reparsing a CSS string.
export function patchMetricCard(element, model) {
  element.setAttribute("data-entity", model.entity);
  if (model.roomIndex !== null) element.setAttribute("data-room-index", String(model.roomIndex));
  else element.removeAttribute("data-room-index");
  element.style.setProperty("--extreme-color", model.color);
  element.style.setProperty("--extreme-bg", model.background);
  element.style.setProperty("--extreme-border", model.border);
  element.style.setProperty("--extreme-line-shadow", model.lineShadow);
  element.setAttribute("title", model.title);
  element.setAttribute("aria-label", model.ariaLabel);
  element.querySelector(".rtc-extreme-label").textContent = model.label;
  element.querySelector(".rtc-extreme-name").textContent = model.nameText;
  element.querySelector(".rtc-extreme-value-num").textContent = model.numText;
  element.querySelector(".rtc-extreme-value-unit").textContent = model.unitText;
}

// Stable positional slots preserve focused nodes; mismatched DOM falls back to pair re-render.
export function patchMetricCardPair(element, models, renderPairHtml) {
  if (!element) return;
  const cards = element.querySelectorAll(".rtc-extreme-card");
  if (cards.length !== models.length) {
    element.innerHTML = renderPairHtml();
    return;
  }
  models.forEach((model, index) => patchMetricCard(cards[index], model));
}

export function renderMetricCards(models) {
  return `
        ${models.map(renderMetricCard).join("\n        ")}
      `;
}

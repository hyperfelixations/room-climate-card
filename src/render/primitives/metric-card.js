// Shared tappable metric card keeps daily-range and room-extreme views visually identical.
// Template-literal indentation is shipped markup and baseline-pinned.

import { escapeHtml } from "../../core/text.js";
import { setAttr, setStyleProperty, setText } from "./dom.js";

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
  setAttr(element, "data-entity", model.entity);
  if (model.roomIndex !== null) setAttr(element, "data-room-index", model.roomIndex);
  else element.removeAttribute("data-room-index");
  setStyleProperty(element, "--extreme-color", model.color);
  setStyleProperty(element, "--extreme-bg", model.background);
  setStyleProperty(element, "--extreme-border", model.border);
  setStyleProperty(element, "--extreme-line-shadow", model.lineShadow);
  setAttr(element, "title", model.title);
  setAttr(element, "aria-label", model.ariaLabel);
  setText(element.querySelector(".rtc-extreme-label"), model.label);
  setText(element.querySelector(".rtc-extreme-name"), model.nameText);
  setText(element.querySelector(".rtc-extreme-value-num"), model.numText);
  setText(element.querySelector(".rtc-extreme-value-unit"), model.unitText);
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

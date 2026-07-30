// The metric card: one large tappable card with a label, a name and a value.
//
// Used by the daily-range view (today's minimum and maximum) and by the
// extreme-value view (the coldest and warmest room). Both get the identical shape
// from the identical model, which is why the two views cannot drift apart visually.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literal is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../../core/text.js";

export function renderMetricCard(model) {
  // Only real rooms carry an index, so the action layer falls back to the card's
  // default actions for a daily-range card instead of a nonexistent room.
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

// Field-for-field mirror of renderMetricCard(). The four custom properties are set
// through style.setProperty() rather than by reassembling one style string, so an
// update never re-parses a value as CSS.
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

// The shared patch path for both two-card views. The pair is positionally fixed by
// its render function, so index 0 and index 1 are stable slots — which is what lets
// a focused card survive the room behind it changing. Falls back to a full
// re-render only as a defensive guard if the DOM does not actually hold two cards;
// these views only appear or disappear through a full rebuild, never mid-patch.
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

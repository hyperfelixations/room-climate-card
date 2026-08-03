// The average: the card's headline number, on the left of the main panel.
//
// Two shapes, one content block. With an average entity it is a button that opens
// more-info; without one it stays visible but is a plain div, because a control that
// looks clickable and does nothing is worse than one that does not look clickable.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literals below is shipped
// markup. It is captured verbatim by the DOM characterization baselines, so it is
// deliberately not re-indented to match this module's nesting.

import { escapeHtml } from "../../core/text.js";
import { applyFocusFallback } from "./focus.js";

function contentHtml(average) {
  const hidden = average.trendDirection ? "" : " hidden";
  // Omitted entirely rather than rendered empty: an empty block would still occupy its
  // own line box and push the value down, which is exactly what a card configured
  // without a caption is asking not to have. Because this is a NODE appearing and
  // disappearing, `hasLabel` is part of cardStructureSignature() — the patch path can
  // update a label, it cannot conjure one.
  const label = average.hasLabel ? `<span class="rtc-avg-label">${escapeHtml(average.label)}</span>` : "";
  const valueStyle = average.hasLabel ? "" : ' style="margin-top: 0px;"';
  return `
        ${label}
        <span class="rtc-avg-value"${valueStyle}>
          <span class="rtc-avg-value-num">${average.valueText}</span><span class="rtc-avg-unit-wrap"><span class="rtc-avg-unit-gap" aria-hidden="true"> </span><span class="rtc-avg-unit-core"><span class="rtc-avg-trend-arrow" aria-hidden="true"${hidden}><svg class="rtc-avg-trend-arrow-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" focusable="false"><path d="M3 13L13 3M8 3H13V8" vector-effect="non-scaling-stroke"></path></svg></span><span class="rtc-avg-value-unit">${escapeHtml(average.unitText)}</span></span></span>
        </span>
      `;
}

export function renderAverage(viewModel) {
  const average = viewModel.average;
  const trendClass = average.trendDirection ? " rtc-has-trend" : "";
  const labelClass = average.hasLabel ? "" : " rtc-no-label";
  const unavailableClass = average.unavailable ? " rtc-unavailable" : "";
  const trendDirection = average.trendDirection ? ` data-trend-direction="${escapeHtml(average.trendDirection)}"` : "";
  const content = contentHtml(average);

  if (!average.entity) {
    return `
          <div
            class="rtc-avg-button rtc-avg-button-disabled${trendClass}${labelClass}${unavailableClass}"
            ${trendDirection}
            title="${escapeHtml(average.tooltip)}"
            aria-label="${escapeHtml(average.ariaLabel)}"
          >
            ${content}
          </div>
        `;
  }

  // data-room-index is what makes a headline that IS a room obey that room's own
  // tap_action/hold_action: the action runtime reads it from the clicked element, the
  // same way it does for a chip. No second action path, no special case there.
  const roomIndex = average.roomIndex !== null ? ` data-room-index="${escapeHtml(String(average.roomIndex))}"` : "";
  return `
        <button
          type="button"
          class="rtc-avg-button${trendClass}${labelClass}${unavailableClass}"
          ${trendDirection}
          data-entity="${escapeHtml(average.entity)}"${roomIndex}
          aria-label="${escapeHtml(average.ariaLabel)}"
          title="${escapeHtml(average.tooltip)}"
        >
          ${content}
        </button>
      `;
}

// Field-for-field mirror of renderAverage()'s two branches. Uses setAttribute and
// textContent exclusively — no interpolated string is ever re-parsed as HTML for an
// update that only changes a value.
export function patchAverage(element, viewModel) {
  const average = viewModel.average;
  element.setAttribute("title", average.tooltip);
  if (average.entity) {
    element.setAttribute("data-entity", average.entity);
  }
  // Removed as well as set: a card that stops being a single-room card must stop
  // resolving its headline against that room's action overrides.
  if (average.roomIndex !== null) {
    element.setAttribute("data-room-index", String(average.roomIndex));
  } else {
    element.removeAttribute("data-room-index");
  }
  element.setAttribute("aria-label", average.ariaLabel);
  // Absent by design when there is no caption; whether it exists at all is structural
  // (see contentHtml()), so this only ever updates one that is already there.
  const labelEl = element.querySelector(".rtc-avg-label");
  if (labelEl) labelEl.textContent = average.label;
  const valueEl = element.querySelector(".rtc-avg-value");
  valueEl.style.marginTop = average.hasLabel ? "" : "0px";
  element.querySelector(".rtc-avg-value-num").textContent = average.valueText;
  element.querySelector(".rtc-avg-value-unit").textContent = average.unitText;
  const hasTrend = Boolean(average.trendDirection);
  element.classList.toggle("rtc-has-trend", hasTrend);
  element.classList.toggle("rtc-no-label", !average.hasLabel);
  element.classList.toggle("rtc-unavailable", Boolean(average.unavailable));
  if (hasTrend) {
    element.setAttribute("data-trend-direction", average.trendDirection);
  } else {
    element.removeAttribute("data-trend-direction");
  }
  element.querySelector(".rtc-avg-trend-arrow").hidden = !hasTrend;
}

// Patches in place while the shape is unchanged — the common case, once per state
// update. Falls back to a full replace only when the interactive-vs-disabled shape
// itself has to change, or on the very first call when the slot is still empty.
export function updateAverage(context, root, averageEl, viewModel) {
  if (!averageEl) return;
  const wantsButton = Boolean(viewModel.average.entity);
  const child = averageEl.firstElementChild;
  const existing =
    child &&
    (wantsButton
      ? child.tagName === "BUTTON" && child.classList.contains("rtc-avg-button")
      : child.classList.contains("rtc-avg-button-disabled"))
      ? child
      : null;
  if (existing) {
    patchAverage(existing, viewModel);
    return;
  }

  const focusedWithin = root?.activeElement && averageEl.contains(root.activeElement);
  averageEl.replaceChildren(context.htmlToElement(renderAverage(viewModel)));
  if (focusedWithin) applyFocusFallback(root);
}

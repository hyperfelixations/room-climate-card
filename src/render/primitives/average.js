// Headline content is a button when attributable to an entity, otherwise a non-interactive div.
// Template-literal indentation is shipped markup and baseline-pinned.

import { escapeHtml } from "../../core/text.js";
import { setAttr, setHidden, setStyleProperty, setText } from "./dom.js";
import { applyFocusFallback } from "./focus.js";

function contentHtml(average) {
  const hidden = average.trendDirection ? "" : " hidden";
  // Omit an absent caption node; its presence belongs to cardStructureSignature().
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

  // A room-attributed headline shares the chip action path through data-room-index.
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

// Mirror renderAverage() field-for-field without reparsing value updates as HTML.
export function patchAverage(element, viewModel) {
  const average = viewModel.average;
  setAttr(element, "title", average.tooltip);
  if (average.entity) {
    setAttr(element, "data-entity", average.entity);
  }
  // Remove stale room action ownership as well as setting it.
  if (average.roomIndex !== null) {
    setAttr(element, "data-room-index", average.roomIndex);
  } else {
    element.removeAttribute("data-room-index");
  }
  setAttr(element, "aria-label", average.ariaLabel);
  // Caption presence is structural; patch only an existing node.
  const labelEl = element.querySelector(".rtc-avg-label");
  if (labelEl) setText(labelEl, average.label);
  setStyleProperty(element.querySelector(".rtc-avg-value"), "margin-top", average.hasLabel ? "" : "0px");
  setText(element.querySelector(".rtc-avg-value-num"), average.valueText);
  setText(element.querySelector(".rtc-avg-value-unit"), average.unitText);
  const hasTrend = Boolean(average.trendDirection);
  element.classList.toggle("rtc-has-trend", hasTrend);
  element.classList.toggle("rtc-no-label", !average.hasLabel);
  element.classList.toggle("rtc-unavailable", Boolean(average.unavailable));
  if (hasTrend) {
    setAttr(element, "data-trend-direction", average.trendDirection);
  } else {
    element.removeAttribute("data-trend-direction");
  }
  setHidden(element.querySelector(".rtc-avg-trend-arrow"), !hasTrend);
}

// Patch stable shape; replace only for first render or interactive/non-interactive shape change.
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

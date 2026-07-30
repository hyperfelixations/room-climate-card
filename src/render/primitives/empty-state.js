// The empty state: what the card shows when neither the primary entity nor any room
// reports a usable number.
//
// It is a real state, not an error screen — the icon still reflects the metric kind,
// so a card that is temporarily without data still looks like the card it is.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literal is shipped markup
// and is captured verbatim by the DOM characterization baselines.

import { escapeHtml } from "../../core/text.js";

export function renderEmptyState(viewModel) {
  const empty = viewModel.emptyState;
  return `
        <div class="rtc-empty">
          <div class="rtc-empty-icon"><ha-icon icon="${escapeHtml(empty.icon)}"></ha-icon></div>
          <div class="rtc-empty-copy">
            <div class="rtc-empty-title">${escapeHtml(empty.title)}</div>
            <div class="rtc-empty-subtitle">${escapeHtml(empty.subtitle)}</div>
          </div>
        </div>
      `;
}

// An empty-to-empty update still has to follow the metric kind: a configured entity
// swapped for a different mode while both stay unavailable would otherwise keep the
// previous mode's icon.
export function patchEmptyState(root, viewModel) {
  if (!root) return;
  const empty = viewModel.emptyState;
  const titleEl = root.querySelector(".rtc-empty-title");
  if (titleEl) titleEl.textContent = empty.title;
  const subtitleEl = root.querySelector(".rtc-empty-subtitle");
  if (subtitleEl) subtitleEl.textContent = empty.subtitle;
  const iconEl = root.querySelector(".rtc-empty-icon ha-icon");
  if (iconEl) iconEl.setAttribute("icon", empty.icon);
}

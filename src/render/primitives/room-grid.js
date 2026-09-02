// Each room row owns its grid/column count; native grid cannot vary columns per row.
// Template-literal indentation is shipped markup and baseline-pinned.

import { escapeHtml } from "../../core/text.js";
import { applyFocusFallback } from "./focus.js";

export function renderRoomChip(chip) {
  const style = `--room-color:${chip.color};--room-mark-bg:${chip.markBackground};--room-bg:${chip.background};--room-border:${chip.border};`;
  const shortGuaranteedAttr = chip.shortGuaranteed ? ' data-short-guaranteed="true"' : "";

  return `
        <button
          type="button"
          class="rtc-room-chip${chip.unavailable ? " rtc-room-unavailable" : ""}"
          data-entity="${escapeHtml(chip.entity)}"
          data-room-index="${chip.index}"
          style="${style}"
          title="${escapeHtml(chip.title)}"
          aria-label="${escapeHtml(chip.ariaLabel)}"
        >
          <span class="rtc-room-top">
            <span class="rtc-room-short"${shortGuaranteedAttr}>${escapeHtml(chip.displayLabel)}</span>
            <span class="rtc-room-mark">${chip.mark}</span>
          </span>
          <span class="rtc-room-value"><span class="rtc-room-value-num">${chip.valueText}</span><span class="rtc-room-value-unit">${escapeHtml(chip.unitText)}</span></span>
        </button>
      `;
}

// Mirror renderRoomChip() for both reused and newly parsed chip skeletons.
export function patchRoomChip(element, chip) {
  element.setAttribute("data-entity", chip.entity);
  element.setAttribute("data-room-index", String(chip.index));
  element.style.setProperty("--room-color", chip.color);
  element.style.setProperty("--room-mark-bg", chip.markBackground);
  element.style.setProperty("--room-bg", chip.background);
  element.style.setProperty("--room-border", chip.border);
  element.setAttribute("title", chip.title);
  element.setAttribute("aria-label", chip.ariaLabel);
  element.classList.toggle("rtc-room-unavailable", Boolean(chip.unavailable));
  const shortEl = element.querySelector(".rtc-room-short");
  shortEl.textContent = chip.displayLabel;
  // Reused nodes must actively remove a stale short-guaranteed flag.
  shortEl.toggleAttribute("data-short-guaranteed", chip.shortGuaranteed);
  element.querySelector(".rtc-room-mark").textContent = chip.mark;
  element.querySelector(".rtc-room-value-num").textContent = chip.valueText;
  element.querySelector(".rtc-room-value-unit").textContent = chip.unitText;
}

export function renderRoomGridRows(viewModel) {
  return viewModel.rooms.chipRows
    .map(
      (row) =>
        `<div class="rtc-room-row" style="grid-template-columns:repeat(${row.columnCount}, minmax(0, 1fr));">${row.chips
          .map(renderRoomChip)
          .join("")}</div>`
    )
    .join("");
}

// Reconcile focus-bearing chips by entity; row wrappers are unkeyed layout containers.
// Browsers blur even a no-op insertion of a focused connected node, so never move an already
// positioned chip. Grow connected row wrappers before moves and trim empty extras afterwards.
export function updateRoomGrid(context, root, roomGridEl, viewModel) {
  if (!roomGridEl) return;

  const activeBefore = root?.activeElement;
  const focusedChip = activeBefore?.classList?.contains("rtc-room-chip") ? activeBefore : null;
  const rows = viewModel.rooms.chipRows;
  const presentEntities = new Set(viewModel.rooms.chips.map((chip) => chip.entity));

  const existingChips = new Map();
  roomGridEl.querySelectorAll(".rtc-room-chip").forEach((chip) => {
    const entity = chip.getAttribute("data-entity");
    if (presentEntities.has(entity)) existingChips.set(entity, chip);
    else chip.remove();
  });

  while (roomGridEl.children.length < rows.length) roomGridEl.appendChild(context.createElement("div"));

  rows.forEach((row, rowIndex) => {
    const rowEl = roomGridEl.children[rowIndex];
    rowEl.className = "rtc-room-row";
    rowEl.style.gridTemplateColumns = `repeat(${row.columnCount}, minmax(0, 1fr))`;
    row.chips.forEach((chip, indexInRow) => {
      const chipEl = existingChips.get(chip.entity) || context.htmlToElement(renderRoomChip(chip));
      patchRoomChip(chipEl, chip);
      if (rowEl.children[indexInRow] !== chipEl) rowEl.insertBefore(chipEl, rowEl.children[indexInRow] || null);
    });
  });

  while (roomGridEl.children.length > rows.length) roomGridEl.removeChild(roomGridEl.lastElementChild);

  // Restore focus after either removal or a genuine move.
  if (focusedChip && root?.activeElement !== focusedChip) applyFocusFallback(root);
}

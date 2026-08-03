// The room chips, and the grid they sit in.
//
// Each row is its own CSS grid with its own column count, because a single native
// grid cannot vary the column count per row. A single row — the unconfigured default
// up to seven rooms — renders identically to a flat grid, just wrapped one level
// deeper.
//
// NOTE ON WHITESPACE: the indentation INSIDE the template literals is shipped markup
// and is captured verbatim by the DOM characterization baselines.

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

// Field-for-field mirror of renderRoomChip(). Used for BOTH reused chips and freshly
// created ones: a new chip is first parsed for its skeleton shape and then patched
// here too, so exactly one place knows which fields a chip has.
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
  // toggleAttribute rather than a conditional setAttribute: chip nodes are reused
  // across renders, so a stale "true" from a previous configuration has to be
  // actively removed once the label no longer qualifies.
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

// Entity-keyed reconciliation instead of rebuilding the grid on every update.
//
// The row wrappers are cheap, unkeyed, non-focusable layout containers; only the chip
// buttons carry identity and focus, and they are reused by data-entity wherever in
// the new row structure they end up.
//
// A real browser blurs a focused node the instant appendChild/insertBefore is called
// on it, EVEN when the node is already exactly where it is being moved to: the DOM
// insert algorithm unconditionally removes and reinserts an already-connected node,
// and the focus fixup rule fires on that removal step alone. The fix is to never
// issue the move at all for a chip that is already correctly positioned — by far the
// common case, since a plain value update touches zero positions. Row wrappers are
// only ever GROWN before repositioning (a detached wrapper would blur through the
// same rule) and trimmed afterwards, once guaranteed empty.
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

  // Covers both ways a focused chip can lose focus: its room disappeared, or it
  // genuinely had to move. Comparing before and after catches both uniformly instead
  // of trying to predict which happened.
  if (focusedChip && root?.activeElement !== focusedChip) applyFocusFallback(root);
}

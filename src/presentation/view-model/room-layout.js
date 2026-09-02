// Room labels, ordering and grid limits are presentation-only. Aggregates,
// extrema, spread, comfort counts and subtitles always use every valid room.

import { rgba } from "../../core/color.js";
import { tintRecipeFor } from "../../domain/classification/tone-legibility.js";
import { isTwoUpperLetterLabel, UNAVAILABLE_TEXT } from "../../core/text.js";
import { autoRoomColumnsFor } from "./metric-meta.js";
import { NO_DATA_COLOR } from "./tone.js";

// Out-of-comfort chips add palette tint and border; others keep the neutral surface.
const CHIP_MARK_ALPHA = 0.18;
const CHIP_OUT_BG_ALPHA = 0.10;
const CHIP_OUT_BORDER_ALPHA = 0.36;

// `auto` and `short` use the short code; `name` uses the full label.
// `shortGuaranteed` applies only to resolved two-uppercase-letter labels.
export function decorateRoomForDisplay(room, roomLabelMode) {
  const displayLabel = roomLabelMode === "name" ? room.name : room.short;
  return { ...room, displayLabel, shortGuaranteed: isTwoUpperLetterLabel(displayLabel) };
}

// Render order never affects calculations.
export function resolveRoomDisplayOrder(list, sortMode, language) {
  const sorted = [...list];
  if (sortMode === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name, language));
  if (sortMode === "value_desc") return sorted.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, language));
  if (sortMode === "configured") return sorted.sort((a, b) => a.index - b.index);
  return sorted.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, language)); // value_asc (default)
}

// Splits chips into `{ itemCount, columnCount }` rows. Fixed columns keep their
// width on a short final row. Capacity is capped only when both dimensions are set.
export function roomGridRows(count, columns, rows, autoMaxColumns = 7) {
  if (count <= 0) return { rowSizes: [], capacity: 0 };

  // Both fixed: fill row-major, cap overflow and omit empty trailing rows.
  if (columns && rows) {
    const capacity = columns * rows;
    const shown = Math.min(count, capacity);
    const rowCount = Math.min(rows, Math.ceil(shown / columns));
    const rowSizes = [];
    let remaining = shown;
    for (let i = 0; i < rowCount; i++) {
      const itemCount = Math.min(columns, remaining);
      rowSizes.push({ itemCount, columnCount: columns });
      remaining -= itemCount;
    }
    return { rowSizes, capacity: shown };
  }

  // Fixed columns grow rows without capping.
  if (columns) {
    const rowCount = Math.ceil(count / columns);
    const rowSizes = [];
    let remaining = count;
    for (let i = 0; i < rowCount; i++) {
      const itemCount = Math.min(columns, remaining);
      rowSizes.push({ itemCount, columnCount: columns });
      remaining -= itemCount;
    }
    return { rowSizes, capacity: count };
  }

  // Fixed rows or fully automatic: distribute evenly, with extras in earlier rows.
  // Cap the row count to avoid empty rows.
  const rowCount = Math.min(rows || Math.max(1, Math.ceil(count / autoMaxColumns)), count);
  const base = Math.floor(count / rowCount);
  const remainder = count % rowCount;
  const rowSizes = [];
  for (let i = 0; i < rowCount; i++) {
    const itemCount = base + (i < remainder ? 1 : 0);
    rowSizes.push({ itemCount, columnCount: itemCount });
  }
  return { rowSizes, capacity: count };
}

// Apply the cap in declaration order before display sorting so the visible set is
// stable as values change.
export function buildRoomLayout({ declaredRooms, config, metricKind, language }) {
  const grid = roomGridRows(declaredRooms.length, config.room_columns, config.room_rows, autoRoomColumnsFor(metricKind));
  // Placeholders follow usable rooms; capacity still selects usable rooms first.
  const usable = declaredRooms.filter((room) => !room.placeholder);
  const placeholders = declaredRooms.filter((room) => room.placeholder).sort((a, b) => a.index - b.index);
  const selectedUsable = usable.slice(0, grid.capacity);
  const remaining = Math.max(0, grid.capacity - selectedUsable.length);
  const visible = [
    ...resolveRoomDisplayOrder(selectedUsable, config.room_sort, language),
    ...placeholders.slice(0, remaining),
  ];
  return {
    visible,
    rowSizes: grid.rowSizes,
  };
}

// Fully resolves the render and patch contract while retaining `room` by identity.
// The direction mark is language-neutral and paints palette ink on its own tint.
export function buildRoomChipModel({ room, color, comfort, unit, texts, tintRecipes = null }) {
  if (room.placeholder) {
    const title = texts.t("availability.roomNoData", { name: room.name });
    return {
      room,
      entity: room.entity,
      index: room.index,
      displayLabel: room.displayLabel,
      shortGuaranteed: room.shortGuaranteed,
      unavailable: true,
      color: NO_DATA_COLOR,
      mark: "–",
      out: false,
      markBackground: rgba(NO_DATA_COLOR, CHIP_MARK_ALPHA),
      background: "var(--rtc-chip-bg)",
      border: "var(--rtc-hairline)",
      valueText: UNAVAILABLE_TEXT,
      unitText: "",
      title,
      ariaLabel: title,
    };
  }
  const out = room.value < comfort.min || room.value > comfort.max;
  // Reuse the pill's legibility recipe. `--room-color` carries adjusted mark ink;
  // the chip fill and border retain the unadjusted palette colour.
  const recipe = tintRecipeFor(tintRecipes, color);
  return {
    room,
    entity: room.entity,
    index: room.index,
    displayLabel: room.displayLabel,
    shortGuaranteed: room.shortGuaranteed,
    color: recipe.ink,
    mark: room.value > comfort.max ? "↑" : room.value < comfort.min ? "↓" : "•",
    out,
    markBackground: rgba(color, CHIP_MARK_ALPHA * recipe.tintFactor),
    background: out ? rgba(color, CHIP_OUT_BG_ALPHA) : "var(--rtc-chip-bg)",
    border: out ? rgba(color, CHIP_OUT_BORDER_ALPHA) : "var(--rtc-hairline)",
    valueText: texts.fmt(room.value),
    unitText: unit,
    title: `${room.name}: ${texts.fmtWithUnit(room.value)}`,
    ariaLabel: texts.t("room.ariaOpen", { name: room.name }),
  };
}

// Groups visible chips into the resolved rows for direct rendering.
export function buildRoomChipRows(chips, rowSizes) {
  let cursor = 0;
  return rowSizes.map(({ itemCount, columnCount }) => {
    const rowChips = chips.slice(cursor, cursor + itemCount);
    cursor += itemCount;
    return { columnCount, chips: rowChips };
  });
}

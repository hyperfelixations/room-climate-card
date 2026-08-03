// How the room chips are labelled, ordered and laid out.
//
// All three are presentation decisions and none of them may reach the
// calculations: the grid cap only limits how many chips are DRAWN, and room_sort
// only reorders those chips. Average, extrema, spread, comfort counting and the
// subtitle always use every valid room.

import { rgba } from "../../core/color.js";
import { isTwoUpperLetterLabel, UNAVAILABLE_TEXT } from "../../core/text.js";
import { autoRoomColumnsFor } from "./metric-meta.js";

// The alphas a chip's own custom properties are derived at. A chip outside the
// comfort band gets a tinted background and a coloured border; one inside keeps the
// theme's neutral chip surface.
const CHIP_MARK_ALPHA = 0.18;
const CHIP_OUT_BG_ALPHA = 0.10;
const CHIP_OUT_BORDER_ALPHA = 0.36;
const UNAVAILABLE_COLOR = "#7F8792";

// room_label picks which of the configured short/name pair a chip shows. "auto"
// and "short" both resolve to the short code; "name" shows the full name and
// relies on the same CSS ellipsis every other label does.
//
// shortGuaranteed marks the one case where the label provably never has to shrink
// or ellipsize: exactly two Unicode uppercase letters. It is a check against the
// RESOLVED label, independent of whether `short` was configured or derived.
export function decorateRoomForDisplay(room, roomLabelMode) {
  const displayLabel = roomLabelMode === "name" ? room.name : room.short;
  return { ...room, displayLabel, shortGuaranteed: isTwoUpperLetterLabel(displayLabel) };
}

// The rendered chip order. Never on the calculation path.
export function resolveRoomDisplayOrder(list, sortMode, language) {
  const sorted = [...list];
  if (sortMode === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name, language));
  if (sortMode === "value_desc") return sorted.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, language));
  if (sortMode === "configured") return sorted.sort((a, b) => a.index - b.index);
  return sorted.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name, language)); // value_asc (default)
}

// Splits `count` chips into row descriptors {itemCount, columnCount}.
//
// columnCount is what drives grid-template-columns for that row. It equals
// itemCount unless `columns` is explicitly fixed, in which case every row —
// including a shorter last one — keeps the same column count, so chip widths stay
// consistent instead of a short last row stretching its chips wider.
//
// `capacity` is how many chips are actually shown. It is only below `count` when
// BOTH columns and rows are explicitly configured and their product is smaller: an
// explicit override wins over showing every configured room.
export function roomGridRows(count, columns, rows, autoMaxColumns = 7) {
  if (count <= 0) return { rowSizes: [], capacity: 0 };

  // Both fixed: a literal columns x rows grid, filled row-major; excess rooms
  // beyond capacity are dropped rather than growing the grid. rowCount is capped to
  // what `count` can actually fill, so an over-large row count never produces
  // empty trailing rows.
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

  // Only columns fixed: rows grow automatically, no capping.
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

  // Only rows fixed, or fully automatic (rows derived from the metric-specific
  // autoMaxColumns): distribute as evenly as possible, extra items going to the
  // earliest rows — 9 rooms over 2 rows becomes [5, 4], 13 over 2 becomes [7, 6].
  // The row count is capped to `count` so an over-large explicit row count never
  // produces empty rows.
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

// The complete chip layout: which rooms are visible, in which order, in how many
// rows.
//
// The cap is applied in CONFIG-DECLARATION order, before the display sort. Capping
// after a value sort would make the visible chip set drift through the day — a
// room silently vanishing once it is no longer among the N coldest — which is
// confusing. Declaration order keeps it stable and predictable.
export function buildRoomLayout({ declaredRooms, config, metricKind, language }) {
  const grid = roomGridRows(declaredRooms.length, config.room_columns, config.room_rows, autoRoomColumnsFor(metricKind));
  // A placeholder is display-only and always follows every usable room. The cap
  // still selects usable rooms in declaration order before sorting them, preserving
  // the stable visible set the existing grid contract promises.
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

// One chip, fully resolved: every string, every colour and every custom property
// the render path and the patch path both need. `room` is carried through by
// reference so a consumer that already holds a room object can match it by
// identity.
//
// The mark is a direction glyph, not a translation: it means the same thing in
// every language.
export function buildRoomChipModel({ room, color, comfort, unit, texts }) {
  if (room.placeholder) {
    const title = texts.t("availability.roomNoData", { name: room.name });
    return {
      room,
      entity: room.entity,
      index: room.index,
      displayLabel: room.displayLabel,
      shortGuaranteed: room.shortGuaranteed,
      unavailable: true,
      color: UNAVAILABLE_COLOR,
      mark: "–",
      out: false,
      markBackground: rgba(UNAVAILABLE_COLOR, CHIP_MARK_ALPHA),
      background: "var(--rtc-chip-bg)",
      border: "var(--rtc-hairline)",
      valueText: UNAVAILABLE_TEXT,
      unitText: "",
      title,
      ariaLabel: title,
    };
  }
  const out = room.value < comfort.min || room.value > comfort.max;
  return {
    room,
    entity: room.entity,
    index: room.index,
    displayLabel: room.displayLabel,
    shortGuaranteed: room.shortGuaranteed,
    color,
    mark: room.value > comfort.max ? "↑" : room.value < comfort.min ? "↓" : "•",
    out,
    markBackground: rgba(color, CHIP_MARK_ALPHA),
    background: out ? rgba(color, CHIP_OUT_BG_ALPHA) : "var(--rtc-chip-bg)",
    border: out ? rgba(color, CHIP_OUT_BORDER_ALPHA) : "var(--rtc-hairline)",
    valueText: texts.fmt(room.value),
    unitText: unit,
    title: `${room.name}: ${texts.fmtWithUnit(room.value)}`,
    ariaLabel: texts.t("room.ariaOpen", { name: room.name }),
  };
}

// The visible chips grouped into their rows, so the renderer walks a structure
// instead of slicing with a running cursor it has to keep in step with rowSizes.
export function buildRoomChipRows(chips, rowSizes) {
  let cursor = 0;
  return rowSizes.map(({ itemCount, columnCount }) => {
    const rowChips = chips.slice(cursor, cursor + itemCount);
    cursor += itemCount;
    return { columnCount, chips: rowChips };
  });
}

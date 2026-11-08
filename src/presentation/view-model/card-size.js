// The size a card draws at its measured width: the factor of each region and the room grid that
// follows from them. Without a size every region is drawn as is and the grid is the drawn card's.
// See internal dev doc §5 "Kartengröße".

import { UNSCALED_SIZE } from "../../core/size.js";
import { CARD_BORDER_PX, ROOM_CHIP_REGIMES } from "./room-chip-metrics.js";
import { autoRoomColumns, chipRegimeAt, fillRoomValue, roomColumnsAt } from "./room-chip-fit.js";
import { roomGridRows } from "./room-layout.js";

// The narrowest card the suite proves: every header and view still fits. Header and panel never
// grow beyond the card's content width over this card's content width.
export const SAFE_CARD_WIDTH_PX = 320;
const SAFE_CONTENT_PX = SAFE_CARD_WIDTH_PX - 2 * CARD_BORDER_PX;
// `dynamic`: every part is drawn as is at the narrowest card and reaches its factor here, where a
// large header and panel first fit; in between it grows with the width.
export const DYNAMIC_FULL_WIDTH_PX = 480;
// Where the rooms keep below the panel, a reading fills its chip up to this share of the headline.
export const ROOM_HEADLINE_SHARE = 0.65;
// A chip's short-code row and frame grow at most this much; its reading grows further.
export const ROOM_LABEL_CAP = 1.5;
// Where the rooms keep below the panel, the short-code row grows at most this much beyond the panel.
export const ROOM_LABEL_OVER_PANEL = 1.25;
// No reading grows beyond this, whatever room its chip has.
export const ROOM_VALUE_CAP = 2.5;
// The headline's font size in each width layout and the entity label's in both; the stylesheet
// draws them from here (styles/average.js, styles/responsive.js).
export const HEADLINE_FONT_PX = Object.freeze({ wide: 33, narrow: 29 });
export const ENTITY_LABEL_FONT_PX = 10;

// A size that draws every region as is: no `size`, or every part small.
export function isDrawnSize(size) {
  return !size || (size.header === 1 && size.panel === 1 && size.rooms === 1);
}

// `chipTexts` from typicalChipTexts(); `grid` is { count, columns, rows } from the configuration.
export function resolveCardSize({ size, width, chipTexts, grid }) {
  if (isDrawnSize(size)) return { size: UNSCALED_SIZE, autoColumns: autoRoomColumns(chipTexts) };
  const fit = Math.max(1, (width - 2 * CARD_BORDER_PX) / SAFE_CONTENT_PX);
  const progress = Math.min(1, Math.max(0, (width - SAFE_CARD_WIDTH_PX) / (DYNAMIC_FULL_WIDTH_PX - SAFE_CARD_WIDTH_PX)));
  const target = (factor) => (size.dynamic ? 1 + (factor - 1) * progress : factor);
  const header = Math.min(target(size.header), fit);
  const panel = Math.min(target(size.panel), fit);
  const shell = Math.max(header, panel);
  const roomsTarget = target(size.rooms);
  const regime = chipRegimeAt(width, shell);
  const base = { shell, header, panel, entityLabel: panel };
  const standard = autoRoomColumns(chipTexts);
  if (roomsTarget === 1) {
    // Chips at their drawn size, in no more columns than the drawn card has.
    const columns = Math.min(standard, roomColumnsAt({ ...chipTexts, width, size: { ...base, rooms: 1, roomValue: 1 } }));
    return { size: { ...base, rooms: 1, roomValue: 1 }, autoColumns: columns };
  }
  const hierarchy = size.hierarchy;
  const labelCap = hierarchy ? Math.min(ROOM_LABEL_CAP, panel * ROOM_LABEL_OVER_PANEL) : ROOM_LABEL_CAP;
  const labelTarget = Math.max(1, Math.min(roomsTarget, labelCap));
  const autoColumns = roomColumnsAt({ ...chipTexts, width, size: { ...base, rooms: labelTarget, roomValue: roomsTarget } });
  const rows = roomGridRows(grid.count, grid.columns, grid.rows, autoColumns).rowSizes;
  const widest = Math.max(1, ...rows.map((row) => row.columnCount));
  // Unless the rooms were asked to be larger than the panel, a reading stays below the headline.
  const headlineCap = (ROOM_HEADLINE_SHARE * HEADLINE_FONT_PX[regime] * panel) / ROOM_CHIP_REGIMES[regime].valueFont;
  const cap = Math.min(ROOM_VALUE_CAP, hierarchy ? headlineCap : Infinity);
  const roomValue = fillRoomValue({ ...chipTexts, width, size: base, columns: widest, from: roomsTarget, cap, labelCap: Math.max(1, labelCap) });
  const rooms = Math.max(1, Math.min(roomValue, labelCap));
  // The same rule for the captions: the entity label grows to at least the short code's size.
  const entityLabel = hierarchy ? Math.max(panel, (rooms * ROOM_CHIP_REGIMES[regime].labelFont) / ENTITY_LABEL_FONT_PX) : panel;
  return { size: { ...base, entityLabel, rooms, roomValue }, autoColumns };
}

// The automatic room-chip column count: how many chips fit side by side at the reference card
// width and at the narrowest card of the wide layout, for the widest typical reading written as
// a chip writes it, at the card's size factors. Its inputs are configuration and measurement,
// never the card's own width. See internal dev doc §5 "Raumchip-Passung".

import { ROOM_GRID_MAX } from "../../config/normalize-config.js";
import { UNSCALED_SIZE } from "../../core/size.js";
import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";
import { metricMetaFor } from "./metric-meta.js";
import {
  CARD_BORDER_PX,
  GLYPH_ADVANCE_EM,
  NARROW_CONTAINER_MAX_PX,
  REFERENCE_SHORT_LABEL,
  ROOM_CHIP_REFERENCE_WIDTH_PX,
  ROOM_CHIP_REGIMES,
  ROOM_CHIP_SHAPE,
  roomChipLengths,
} from "./room-chip-metrics.js";

export const MAX_AUTO_COLUMNS = ROOM_GRID_MAX;

// Absorbs floating-point noise at an exact fit.
const EPSILON = 1e-9;

const WIDEST_EM = Object.fromEntries(Object.entries(GLYPH_ADVANCE_EM).map(([role, table]) => [role, Math.max(...Object.values(table))]));

function textWidthEm(text, role) {
  const table = GLYPH_ADVANCE_EM[role];
  let width = 0;
  for (const character of text) width += Object.hasOwn(table, character) ? table[character] : WIDEST_EM[role];
  return width;
}

// The wider of the chip's two rows: the value with its unit, and a two-letter short code beside its mark.
function chipContentPx(lengths, valueTexts, unitText) {
  const number = Math.max(0, ...valueTexts.map((text) => textWidthEm(text, "value")));
  const value = number * lengths.valueFont + lengths.valueGap + textWidthEm(unitText, "unit") * lengths.unitFont;
  const letters = [...REFERENCE_SHORT_LABEL].length;
  const short = (textWidthEm(REFERENCE_SHORT_LABEL, "label") + letters * ROOM_CHIP_SHAPE.labelLetterSpacing) * lengths.labelFont;
  return Math.max(value, short + lengths.labelGap + lengths.mark);
}

// Equal chips share the row with `gridGap` between them; a chip fits when its content stays
// inside its padding box from the left padding on.
function columnsAt(lengths, cardWidth, content) {
  const row = cardWidth - 2 * CARD_BORDER_PX - 2 * lengths.cardPaddingX;
  const perChip = content + 2 * ROOM_CHIP_SHAPE.border + lengths.chipPaddingX + lengths.gridGap;
  return Math.floor((row + lengths.gridGap) / perChip + EPSILON);
}

// The columns of the drawn card: at the reference width and at the narrowest card of the wide layout.
export function autoRoomColumns({ valueTexts, unitText }) {
  const narrow = roomChipLengths(ROOM_CHIP_REGIMES.narrow, UNSCALED_SIZE);
  const wide = roomChipLengths(ROOM_CHIP_REGIMES.wide, UNSCALED_SIZE);
  const atReference = columnsAt(narrow, ROOM_CHIP_REFERENCE_WIDTH_PX, chipContentPx(narrow, valueTexts, unitText));
  // The wide layout begins where the card's container exceeds the narrow maximum.
  const narrowestWide = NARROW_CONTAINER_MAX_PX + 2 * CARD_BORDER_PX;
  const atWideStart = columnsAt(wide, narrowestWide, chipContentPx(wide, valueTexts, unitText));
  return Math.min(MAX_AUTO_COLUMNS, Math.max(1, Math.min(atReference, atWideStart)));
}

// The texts a chip of this measurement is sized for: the typical reading at both ends, converted to
// the display unit and formatted by `fmt` as a chip formats it. Without a display unit (no data),
// the canonical one.
export function typicalChipTexts({ metricKind, displayUnitProfile, fmt }) {
  const profile = displayUnitProfile || canonicalProfileOf(metricKind);
  const { min, max } = metricMetaFor(metricKind).typicalReading;
  return { valueTexts: [min, max].map((value) => fmt(profile.fromCanonical(value))), unitText: profile.displayUnit };
}

// The width layout a sized card of this width draws: narrow up to its scaled container maximum.
export function chipRegimeAt(width, shell) {
  return width - 2 * CARD_BORDER_PX <= NARROW_CONTAINER_MAX_PX * shell ? "narrow" : "wide";
}

// How many chips of a sized card fit side by side at its width.
export function roomColumnsAt({ valueTexts, unitText, width, size }) {
  const lengths = roomChipLengths(ROOM_CHIP_REGIMES[chipRegimeAt(width, size.shell)], size);
  return Math.min(MAX_AUTO_COLUMNS, Math.max(1, columnsAt(lengths, width, chipContentPx(lengths, valueTexts, unitText))));
}

// The largest reading scale, from `from` up to `cap`, at which `columns` chips still fit the row;
// the short-code row and the chip's frame grow with it up to `labelCap`.
export function fillRoomValue({ valueTexts, unitText, width, size, columns, from, cap, labelCap }) {
  const fits = (roomValue) => roomColumnsAt({ valueTexts, unitText, width, size: { ...size, roomValue, rooms: Math.min(roomValue, labelCap) } }) >= columns;
  if (cap <= from || !fits(from)) return from;
  let low = from;
  let high = cap;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return fits(high) ? high : low;
}

// An unknown kind is sized like temperature, as metricMetaFor() presents it.
function canonicalProfileOf(metricKind) {
  const definition = Object.hasOwn(METRIC_DEFINITIONS, metricKind) ? METRIC_DEFINITIONS[metricKind] : METRIC_DEFINITIONS.temperature;
  return definition.unitProfiles[definition.canonicalProfileKey];
}

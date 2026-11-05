// The lengths and glyph widths the automatic room-chip column count is derived from. The
// stylesheet reads the same lengths, so the derivation and the drawn chip cannot diverge.
// Derivation: see internal dev doc §5 "Raumchip-Passung".

// The card width the automatic grid fits, and the container width up to which the narrow
// layout applies (`@container rtc-card (max-width: …)`).
export const ROOM_CHIP_REFERENCE_WIDTH_PX = 375;
export const NARROW_CONTAINER_MAX_PX = 460;
export const CARD_BORDER_PX = 1;

// Lengths in px per width regime: card padding, grid gap, chip padding, and the font sizes and
// gap of the value and short-label rows.
export const ROOM_CHIP_REGIMES = Object.freeze({
  wide: Object.freeze({ cardPaddingX: 16, gridGap: 6, chipPaddingX: 7, valueFont: 17, valueGap: 1, unitFont: 10, labelFont: 11 }),
  narrow: Object.freeze({ cardPaddingX: 14, gridGap: 5, chipPaddingX: 5, valueFont: 14, valueGap: 0, unitFont: 7.5, labelFont: 10 }),
});

// Lengths in px both regimes share; the letter spacing of the short label is in em.
export const ROOM_CHIP_SHAPE = Object.freeze({ border: 1, mark: 15, labelGap: 4, labelLetterSpacing: 0.04 });

// The widest two-letter short code; a code of two uppercase letters always stays whole.
export const REFERENCE_SHORT_LABEL = "WW";

// A regime's lengths at the card's size factors: the card padding follows `shell`, the reading
// and its unit follow `roomValue`, every other chip length follows `rooms`. The chip border stays a
// hairline and the letter spacing is in em.
export function roomChipLengths(regime, { shell, rooms, roomValue }) {
  return {
    cardPaddingX: regime.cardPaddingX * shell,
    gridGap: regime.gridGap * rooms,
    chipPaddingX: regime.chipPaddingX * rooms,
    valueFont: regime.valueFont * roomValue,
    valueGap: regime.valueGap * roomValue,
    unitFont: regime.unitFont * roomValue,
    labelFont: regime.labelFont * rooms,
    mark: ROOM_CHIP_SHAPE.mark * rooms,
    labelGap: ROOM_CHIP_SHAPE.labelGap * rooms,
  };
}

// Advance widths in em of Roboto, Home Assistant's font, at the chip weights (value 920, drawn at
// Roboto's 900, with tabular figures; unit 750; label 900). Measured in Chromium and checked by
// test/browser/geometry/room-chip-fit.spec.js. A character not listed counts as the widest of
// its role.
export const GLYPH_ADVANCE_EM = Object.freeze({
  value: Object.freeze({
    0: 0.5796, 1: 0.5796, 2: 0.5796, 3: 0.5796, 4: 0.5796, 5: 0.5796, 6: 0.5796, 7: 0.5796, 8: 0.5796, 9: 0.5796,
    ".": 0.3027, ",": 0.2695, "’": 0.2432, "'": 0.1543, " ": 0.249, " ": 0.1245, " ": 0.249,
    "-": 0.4497, "−": 0.5469,
  }),
  unit: Object.freeze({
    "°": 0.3916, C: 0.6548, F: 0.5483, K: 0.6367, "%": 0.7402, p: 0.5625, m: 0.8652, b: 0.5625,
    "µ": 0.6235, "μ": 0.6118, g: 0.5723, "/": 0.3657, "³": 0.373,
  }),
  label: Object.freeze({ W: 0.8691 }),
});

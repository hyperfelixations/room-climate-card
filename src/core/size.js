// The factors the stylesheet draws the card with, one per region: `shell` (the card's frame),
// `header`, `panel` (headline and views), `entityLabel` (the caption above the headline), `rooms`
// (a chip's frame and short-code row) and `roomValue` (the reading in a chip). They are resolved
// from the `size` option and the card's width; see internal dev doc §5 "Kartengröße".

export const SIZE_PARTS = Object.freeze(["shell", "header", "panel", "entityLabel", "rooms", "roomValue"]);

// Every region at its drawn size.
export const UNSCALED_SIZE = Object.freeze({ shell: 1, header: 1, panel: 1, entityLabel: 1, rooms: 1, roomValue: 1 });

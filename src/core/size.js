// The parts of the card a size factor applies to: `shell` (the card's own frame, written `card`
// in YAML), `header`, `panel` (headline and views) and `rooms` (the chips).
// See internal dev doc §5 "Kartengröße".

export const SIZE_PARTS = Object.freeze(["shell", "header", "panel", "rooms"]);

// Every part at its drawn size.
export const UNSCALED_SIZE = Object.freeze({ shell: 1, header: 1, panel: 1, rooms: 1 });

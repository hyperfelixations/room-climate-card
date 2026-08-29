// The keys a card configuration may carry at its top level, and what to say about one it
// may not.
//
// Every nested object in a configuration is already checked against the keys it allows —
// `palette`, `classification`, the tier lists and `views[].options` all are. The top level,
// which is the level a person actually edits, was the one that let a typo through in
// silence: `pallete: vivid` did nothing at all and said nothing about it, and the reader
// went looking for the reason in the wrong place.
//
// IT WARNS RATHER THAN REFUSING, deliberately. A key the card does not know is cosmetic in
// its effect — the option simply does not apply — while a configuration that stops loading
// after an update is not: a card carrying a key an older version once had, or one a
// front-end module the card knows nothing about put there, would take the dashboard down
// with it. That is the same answer `views:` and `show:` give, through the same channel.
//
// THE TWO LISTS BELOW ARE NOT THE SAME KIND OF THING.
//
// TOP_LEVEL_KEYS is what the card OWNS: every key normalizeConfig() reads. It is the
// counterpart of the manifest in test/manifests/product-surface.js, and a contract test
// holds the two together, so a new option cannot be added here without being promised
// there or the other way round.
//
// FRAMEWORK_KEYS is what the card is HANDED. Home Assistant writes its own bookkeeping onto
// every card configuration, and the card is neither the owner nor the reader of any of it —
// warning about it would be a false alarm on a perfectly ordinary dashboard. The list is
// taken from `LovelaceCardConfig` in the Home Assistant frontend (`src/data/lovelace/
// config/card.ts`), plus `card_mod`, which the card-mod front-end module attaches to any
// card it styles. It therefore AGES: a Home Assistant release that adds a field here would
// make the card complain about it, which is the one maintenance cost this file carries.

// Owned by the card. The last three are older spellings, still accepted and listed for
// removal at the next major.
export const TOP_LEVEL_KEYS = Object.freeze(
  new Set([
    "entity",
    "rooms",
    "range_entity",
    "trend_entity",
    "classification",
    "palette",
    "title",
    "subtitle",
    "entity_label",
    "icon",
    "decimals",
    "language",
    "show",
    "room_sort",
    "room_label",
    "room_columns",
    "room_rows",
    "auto_slide",
    "swipe",
    "rotation_seconds",
    "slide_seconds",
    "tap_action",
    "hold_action",
    "views",
    "start_view",
    "show_rooms",
    "unavailable_values",
    "hide_footer",
  ])
);

// Written by Home Assistant and by front-end modules, read by them, ignored here.
export const FRAMEWORK_KEYS = Object.freeze(
  new Set(["type", "index", "view_index", "view_layout", "layout_options", "grid_options", "visibility", "disabled", "card_mod"])
);

// How far apart two keys may be and still be a plausible slip of the fingers. Two covers
// the mistakes people actually make — a dropped or doubled character, a transposition, a
// separator written the other way (`tap-action`, `tapAction`) — without reaching far enough
// to propose an option that has nothing to do with what was typed.
const SUGGESTION_LIMIT = 2;

// Levenshtein distance, abandoned as soon as it cannot come in under `limit`.
//
// The early exits are not an optimisation of a hot path — this runs once per configuration
// change — they are what keeps the answer bounded for a key of any length somebody pastes
// in by accident.
function editDistance(one, other, limit) {
  if (Math.abs(one.length - other.length) > limit) return limit + 1;
  let previous = Array.from({ length: other.length + 1 }, (_, index) => index);
  for (let row = 1; row <= one.length; row++) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= other.length; column++) {
      const substitution = previous[column - 1] + (one[row - 1] === other[column - 1] ? 0 : 1);
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, substitution);
      best = Math.min(best, current[column]);
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[other.length];
}

// The one allowed key a written one was probably meant to be, or null.
//
// ONLY WHEN IT IS THE ONLY ONE THAT CLOSE. Two candidates at the same distance mean the
// card cannot tell which was meant, and naming one of them would send a reader to fix a key
// they did not write. Comparison is case-insensitive, so `Palette` is answered too, and the
// suggestion is spelled the way the option really is.
export function nearestKey(written, allowed) {
  const needle = String(written).toLowerCase();
  let best = null;
  let bestDistance = SUGGESTION_LIMIT + 1;
  let ties = 0;
  for (const candidate of allowed) {
    const distance = editDistance(needle, candidate.toLowerCase(), SUGGESTION_LIMIT);
    if (distance > SUGGESTION_LIMIT) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      ties = 1;
    } else if (distance === bestDistance) {
      ties += 1;
    }
  }
  return ties === 1 ? best : null;
}

// One diagnostic per unknown key, rather than one naming them all: the suggestion belongs
// to the key it is about, and a single line carrying three keys and three suggestions would
// have to be read twice to see which goes with which.
export function unknownTopLevelKeys(userConfig) {
  const diagnostics = [];
  for (const key of Object.keys(userConfig)) {
    if (TOP_LEVEL_KEYS.has(key) || FRAMEWORK_KEYS.has(key)) continue;
    const suggestion = nearestKey(key, TOP_LEVEL_KEYS);
    diagnostics.push(
      suggestion
        ? `${key}: ignoring an unknown top-level option; did you mean "${suggestion}"?`
        : `${key}: ignoring an unknown top-level option`
    );
  }
  return diagnostics;
}

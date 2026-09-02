// The keys a card configuration may carry at its top level, and what to say about one
// it may not. An unknown top-level key warns rather than refusing (a nested object
// still throws) — full rationale, the two contract tests, and the FRAMEWORK_KEYS
// ageing concern in interne Doku §3 „#### Der Schlüsselvertrag der obersten Ebene".
//
// The two lists differ in kind:
//   TOP_LEVEL_KEYS   what the card OWNS: every key normalizeConfig() reads. Held in
//                    lockstep with the product-surface manifest by a contract test.
//   FRAMEWORK_KEYS   what the card is HANDED: `LovelaceCardConfig` bookkeeping plus
//                    `card_mod`. Not owned, not read here, so not warned about.

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

// Max edit distance for a suggestion: 2 covers a dropped/doubled character, a
// transposition, or a separator written the other way (`tap-action`, `tapAction`).
const SUGGESTION_LIMIT = 2;

// Levenshtein distance, abandoned as soon as it cannot come in under `limit`. The
// early exits bound the cost for an arbitrarily long key pasted in by accident.
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

// The one allowed key a written one was probably meant to be, or null — only when it
// is the single closest one (a tie is ambiguous, so it stays silent). Case-insensitive
// match; the suggestion is spelled the way the option really is.
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

// One diagnostic per unknown key, not one naming them all: the suggestion belongs to
// the key it is about.
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

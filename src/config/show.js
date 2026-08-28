// Normalizing the `show:` block: which PARTS of the card are drawn.
//
// One rule decides what belongs in here and what does not: a part is in the block if
// leaving it out changes the card's LAYOUT — the icon, the two header lines, the status
// pill, the caption over the headline, the middle panel, the room chips, the bar across
// the top. What a view draws INSIDE itself is that view's own option and stays there.
//
// Like views.js, this file is deliberately NON-DESTRUCTIVE and never throws. Two reasons,
// and the second is the harder one:
//
//   - the block is cosmetic, and cosmetic configuration must not be able to break a card;
//   - Home Assistant's YAML editor calls setConfig() on every keystroke, so `show:` alone,
//     `show: {ic`, and `show: {icon:` all arrive as real configurations on the way to a
//     valid one. A normalizer that threw would paint the dashboard red on every other
//     character typed.
//
// Every fallback records a diagnostic instead, and the element surfaces those once per
// config change. Printing is not this module's job: a pure normalizer must not write to
// the console, and the deduplication needs state only the caller has.
//
// WHAT THIS MODULE RETURNS is what the user actually ASKED FOR, not the finished answer —
// only the keys they wrote. That is what lets normalize-config.js give the block
// precedence over the older spelling of the same decision (`show_rooms`,
// `unavailable_values`, `accent_line`) without a written `show:` block silently resetting
// the decisions it says nothing about.

import { isPlainObject } from "./primitives.js";

// The parts that are simply on or off, with the value each one has when nobody says
// otherwise. Every default is `true`: the card as it is drawn without a `show:` block is
// the card with everything visible.
export const SHOW_SWITCHES = Object.freeze({
  accent_line: true,
  icon: true,
  title: true,
  subtitle: true,
  entity_label: true,
  pill: true,
  panel: true,
  unavailable_rooms: true,
});

// The one part that is not a switch. Chips have a third answer — "show them unless they
// would only repeat the headline" — and that answer is the default, so it cannot be
// expressed as a boolean. The vocabulary is the one downstream already reads.
export const SHOW_ROOMS_STATES = Object.freeze({ true: "always", false: "never", auto: "auto" });

export const SHOW_KEYS = Object.freeze([...Object.keys(SHOW_SWITCHES), "rooms"]);

// The finished block, with everything the user did not ask about at its default.
export function resolveShowConfig(requested) {
  return { ...SHOW_SWITCHES, rooms: "auto", ...requested };
}

export function normalizeShowConfig(value) {
  if (value === undefined || value === null) return { show: {}, diagnostics: [] };
  if (!isPlainObject(value)) {
    return { show: {}, diagnostics: [`show: expected an object, got ${JSON.stringify(value)}`] };
  }

  const show = {};
  const diagnostics = [];
  const unknownKeys = [];

  for (const key of Object.keys(value)) {
    if (!SHOW_KEYS.includes(key)) {
      unknownKeys.push(key);
      continue;
    }
    const raw = value[key];
    // An explicitly absent value is the same as not writing the key at all. YAML produces
    // this for `icon:` with nothing after it, which is what a half-typed block looks like.
    if (raw === undefined || raw === null) continue;

    if (key === "rooms") {
      const word = raw === true || raw === false ? String(raw) : typeof raw === "string" ? raw.trim().toLowerCase() : null;
      const state = word === null ? undefined : SHOW_ROOMS_STATES[word];
      if (state === undefined) {
        diagnostics.push(`show.rooms: expected auto, true or false, got ${JSON.stringify(raw)}, falling back to the default`);
        continue;
      }
      show.rooms = state;
      continue;
    }

    // Strict about the type, unlike the tolerant `!== false` reading the older top-level
    // keys use. Those had to stay tolerant because they were already published; a new key
    // can say what it means, and a value that is neither true nor false is far more likely
    // to be a mistake than an intention.
    if (raw !== true && raw !== false) {
      diagnostics.push(`show.${key}: expected true or false, got ${JSON.stringify(raw)}, falling back to the default`);
      continue;
    }
    show[key] = raw;
  }

  if (unknownKeys.length) {
    diagnostics.push(`show: ignoring unknown "show" key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}`);
  }
  return { show, diagnostics };
}

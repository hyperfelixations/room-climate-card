// Normalizing the `show:` block: which PARTS of the card are drawn (a part belongs
// here iff leaving it out changes the card's LAYOUT; what a view draws inside itself
// is that view's own option).
//
// A key the block does not have refuses the configuration. A value that is not an object, and
// an invalid value of a part, each record a diagnostic and take the default. Returns only the
// keys the user wrote, not the finished answer — normalize-config.js layers the defaults and the
// older spellings underneath. See internal dev doc §3 "Der show:-Block".

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { assertKnownKeys, isPlainObject, isUnwritten, readBoolean } from "./primitives.js";

// The on/off parts. Every default is `true` — the card without a `show:` block is
// the card with everything visible. This is the ONE place these defaults are written.
export const SHOW_SWITCHES = Object.freeze({
  accent_line: true,
  icon: true,
  title: true,
  subtitle: true,
  entity_label: true,
  pill: true,
  warnings: true,
  panel: true,
  unavailable_rooms: true,
});

// The one part that is not a switch: chips default to "show unless they would only
// repeat the headline", which a boolean cannot express. Written values (in the two
// spellings YAML gives a boolean) map to the `true | false | "auto"` form that
// `views[].enabled` already carries for this kind of decision.
export const SHOW_ROOMS_STATES = Object.freeze({ true: true, false: false, auto: "auto" });
export const SHOW_ROOMS_DEFAULT = "auto";

export const SHOW_KEYS = Object.freeze([...Object.keys(SHOW_SWITCHES), "rooms"]);

// The finished block, with everything the user did not ask about at its default.
export function resolveShowConfig(requested) {
  return { ...SHOW_SWITCHES, rooms: SHOW_ROOMS_DEFAULT, ...requested };
}

// A written rooms decision. Shared with the older `show_rooms`, so a value means the same
// under both keys.
export function readRoomsState(value, path, diagnostics) {
  const word = value === true || value === false ? String(value) : typeof value === "string" ? value.trim().toLowerCase() : null;
  if (word !== null && Object.hasOwn(SHOW_ROOMS_STATES, word)) return SHOW_ROOMS_STATES[word];
  diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback: fallbackValue(SHOW_ROOMS_DEFAULT) }));
  return SHOW_ROOMS_DEFAULT;
}

export function normalizeShowConfig(value, diagnostics) {
  if (isUnwritten(value)) return {};
  if (!isPlainObject(value)) {
    diagnostics.push(createDiagnostic("value.invalid", { path: "show", value, fallback: FALLBACK.DEFAULTS }));
    return {};
  }
  assertKnownKeys(value, SHOW_KEYS, "show");

  const show = {};
  for (const [key, raw] of Object.entries(value)) {
    // An explicitly absent value is the same as not writing the key at all. YAML produces
    // this for `icon:` with nothing after it, which is what a half-typed block looks like.
    if (isUnwritten(raw)) continue;
    // A rejected value is recorded at the default its warning names, so that is what the card
    // shows, whatever an older spelling asks for.
    show[key] = key === "rooms" ? readRoomsState(raw, "show.rooms", diagnostics) : readBoolean(raw, `show.${key}`, diagnostics, SHOW_SWITCHES[key]);
  }
  return show;
}

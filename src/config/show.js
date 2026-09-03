// Normalizing the `show:` block: which PARTS of the card are drawn (a part belongs
// here iff leaving it out changes the card's LAYOUT; what a view draws inside itself
// is that view's own option).
//
// Non-destructive and never throws — the block is cosmetic, and HA's YAML editor
// calls setConfig() on every keystroke, so half-typed blocks arrive as real configs.
// Fallbacks record a diagnostic; the element surfaces them. Returns only the keys the
// user wrote, not the finished answer — normalize-config.js layers the defaults and
// the older spellings underneath. See internal dev doc §3 "Der show:-Block".

import { booleanOption, isPlainObject } from "./primitives.js";

// The on/off parts. Every default is `true` — the card without a `show:` block is
// the card with everything visible. This is the ONE place these defaults are written.
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

// The one part that is not a switch: chips default to "show unless they would only
// repeat the headline", which a boolean cannot express. Written keys (in the two
// spellings YAML gives a boolean) map to the `true | false | "auto"` form that
// `views[].enabled` already carries for this kind of decision.
export const SHOW_ROOMS_STATES = Object.freeze({ true: true, false: false, auto: "auto" });

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

    // The shared reader, so that a boolean means the same thing here and at the top
    // level. It answers `undefined` both for a value it rejected and for one that was
    // never written; neither is a request, so neither is recorded.
    const parsed = booleanOption(raw, `show.${key}`, diagnostics);
    if (parsed !== undefined) show[key] = parsed;
  }

  if (unknownKeys.length) {
    diagnostics.push(`show: ignoring unknown "show" key(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")}`);
  }
  return { show, diagnostics };
}

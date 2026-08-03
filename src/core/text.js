// Text primitives used at markup boundaries.
//
// escapeHtml() is the card's only HTML-escaping function. Every interpolation
// of entity names, room labels, units, titles, tooltips and ARIA text into a
// template string goes through it; keeping exactly one implementation is what
// makes the markup trust boundary reviewable.

// Hoisted so the replace() callback doesn't allocate a fresh object per
// matched character.
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// The one textual representation of a configured value that currently has no
// usable measurement. Renderers consume the ViewModel and never spell this
// sentinel independently.
export const UNAVAILABLE_TEXT = "--";

// HTML-escapes a value before it enters a template string.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESC_MAP[char]);
}

// Matches a room-chip label that is exactly two Unicode uppercase letters
// (e.g. "WZ", "KÜ") — the only case where a room's short code is guaranteed to
// never shrink/ellipsize. No global flag, so .test() stays stateless and the
// shared instance is safe to reuse.
const TWO_UPPER_LETTER_RE = /^\p{Lu}\p{Lu}$/u;

export function isTwoUpperLetterLabel(text) {
  return TWO_UPPER_LETTER_RE.test(text);
}

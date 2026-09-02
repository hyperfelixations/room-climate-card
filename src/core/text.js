// Text primitives used at markup boundaries.
//
// escapeHtml() is the card's only HTML-escaping function: every interpolation of entity
// names, labels, units, titles, tooltips and ARIA text into a template goes through it,
// so the markup trust boundary stays reviewable.

// Hoisted so the replace() callback allocates no object per matched character.
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// The one textual stand-in for a configured value with no usable measurement. Renderers
// consume the ViewModel and never spell this independently.
export const UNAVAILABLE_TEXT = "--";

// HTML-escapes a value before it enters a template string.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ESC_MAP[char]);
}

// A room-chip label of exactly two Unicode uppercase letters ("WZ", "KÜ") — the one case
// where a short code never shrinks/ellipsizes. No global flag, so .test() stays stateless.
const TWO_UPPER_LETTER_RE = /^\p{Lu}\p{Lu}$/u;

export function isTwoUpperLetterLabel(text) {
  return TWO_UPPER_LETTER_RE.test(text);
}

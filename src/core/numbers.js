// Numeric primitives: reading numbers out of untrusted input, and the small
// amount of arithmetic every layer above shares.
//
// Two distinct parsers live here on purpose, because they guard two different
// trust boundaries and must not be confused:
//
//   parseNumericState()  a Home Assistant entity state or attribute — arrives
//                        as a string, may use a comma decimal separator, and
//                        has a fixed set of "not a measurement" sentinels.
//   parseConfigNumber()  a YAML configuration value written by the dashboard
//                        owner — may legitimately already be a number, and
//                        must reject types that Number() would silently
//                        coerce.

// Home Assistant state values that never represent a usable measurement.
const INVALID_STATES = new Set(["", "unknown", "unavailable", "none", "null", "undefined"]);

// Shared numeric parser for entity states and attributes: accepts comma
// decimals, treats HA's non-numeric states as invalid, and handles attributes
// HA already delivers as a real number instead of a string. Validates the full
// (normalized) string against a strict numeric format before parsing, rather
// than handing it straight to parseFloat() — parseFloat() happily extracts a
// numeric prefix from garbage like "25 °C" or "12abc", which would silently
// legitimize a malformed/corrupted sensor value instead of treating it as
// invalid.
export function parseNumericState(raw) {
  if (raw === undefined || raw === null) return null;
  const rawString = String(raw).trim().toLowerCase();
  if (INVALID_STATES.has(rawString)) return null;
  const normalized = rawString.replace(",", ".");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Strict shared numeric parser for optional cosmetic/layout config fields:
// only an actual `number` or a numeric-looking string is accepted.
// Number(value) alone would silently coerce booleans (Number(true) === 1) and
// other unintended types through, letting a typo'd YAML value like
// `room_columns: true` or `decimals: true` pass as a valid 1 instead of being
// rejected. Returns null for anything else (including non-finite results);
// callers apply their own range checks on top.
export function parseConfigNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

// Clamps a value to a fixed range.
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Converts a value into a percentage position inside [min, max].
export function percentInRange(value, min, max) {
  if (max === min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

export function floorToStep(value, step) {
  return Math.floor(value / step) * step;
}

export function ceilToStep(value, step) {
  return Math.ceil(value / step) * step;
}

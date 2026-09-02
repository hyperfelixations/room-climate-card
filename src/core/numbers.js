// Numeric primitives: reading numbers out of untrusted input, and the arithmetic every
// layer above shares.
//
// Two distinct parsers, guarding two trust boundaries that must not be confused:
//
//   parseNumericState()  an HA entity state/attribute — a string, maybe with a comma
//                        decimal, with a fixed set of "not a measurement" sentinels.
//   parseConfigNumber()  a YAML value from the dashboard owner — may already be a number,
//                        and must reject types Number() would silently coerce.

// Home Assistant state values that never represent a usable measurement.
const UNAVAILABLE_STATES = new Set(["", "unknown", "unavailable", "none", "null", "undefined"]);

// Whether a raw Home Assistant state explicitly says "there is currently no
// measurement". Kept separate from parseNumericState() so EntityModel can
// distinguish an HA availability sentinel from arbitrary malformed text.
export function isUnavailableState(raw) {
  if (raw === undefined || raw === null) return true;
  return UNAVAILABLE_STATES.has(String(raw).trim().toLowerCase());
}

// Shared numeric parser for entity states and attributes: accepts comma decimals, treats
// HA's non-numeric states as invalid, handles attributes HA delivers as a real number.
// Validates the whole normalized string against a strict numeric format first — parseFloat()
// would extract a prefix from "25 °C" or "12abc" and legitimize a corrupted value.
export function parseNumericState(raw) {
  if (raw === undefined || raw === null) return null;
  const rawString = String(raw).trim().toLowerCase();
  if (UNAVAILABLE_STATES.has(rawString)) return null;
  const normalized = rawString.replace(",", ".");
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)(e[+-]?\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Strict parser for optional cosmetic/layout config fields: only an actual `number` or a
// numeric-looking string. Number() alone would coerce `room_columns: true` to a valid 1.
// Returns null for anything else (including non-finite); callers add their own range checks.
export function parseConfigNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(text)) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

// Whether a value falls OUTSIDE an interval; either bound may be null and each carries its
// own inclusive flag. One implementation shared by the built-in profiles, a user's
// `classification.valid_range`, and the projection of either into the display unit, so a
// single edge cannot be got wrong in only one of them. The range must carry all four fields.
export function isOutsideRange(value, range) {
  if (range.min !== null && (range.minInclusive ? value < range.min : value <= range.min)) return true;
  return range.max !== null && (range.maxInclusive ? value > range.max : value >= range.max);
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

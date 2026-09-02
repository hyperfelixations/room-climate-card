// The value-level building blocks every configuration field is built from.
//
// Two failure modes, fixed per field by the public contract (see each function):
// a structurally invalid required value throws; a malformed OPTIONAL value falls
// back to the built-in default. See interne Doku §4 „Config-Normalisierungsvertrag".

import { parseConfigNumber } from "../core/numbers.js";
import { pathError } from "./errors.js";

// Strict object check: arrays don't count as a config object.
export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Required entity id (currently used by rooms[i].entity).
export function requiredEntity(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid configuration: ${name} must be a non-empty entity id.`);
  }
  return value.trim();
}

// Optional entity id with a fixed fallback (range_entity/trend_entity use null).
export function optionalEntity(value, fallback, name) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid configuration: ${name} must be an entity id string.`);
  }
  return value.trim();
}

// Optional free-text override (title/icon); a non-string or empty value means "use the
// built-in default" rather than throwing.
export function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Optional label text where an explicit "" is a real answer ("show no label here"),
// distinct from null ("not configured, use the default"). Unlike optionalString(),
// every string including "" is kept as written.
export function optionalLabel(value) {
  return typeof value === "string" ? value.trim() : null;
}

// String helper for optional display names.
export function stringOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return String(fallback ?? "");
  }
  return String(value);
}

// ONE reader for every boolean option: strict (only true/false pass), any other
// value is diagnosed and the default applies. Returns `undefined` for a key that was
// not written; the caller decides whether that means "default" (top-level) or
// "stay silent" (the `show:` block). See interne Doku §3 „Konfigurationsvertrag".
export function booleanOption(value, path, diagnostics) {
  if (value === undefined || value === null) return undefined;
  if (value === true || value === false) return value;
  diagnostics.push(`${path}: expected true or false, got ${JSON.stringify(value)}, falling back to the default`);
  return undefined;
}

// Generic closed-set config value: an unrecognized value silently falls back to
// defaultValue, the same non-warning convention every other optional top-level
// field uses — a typo degrades to "use the default" rather than breaking the
// card.
export function normalizeEnum(value, allowedValues, defaultValue) {
  return allowedValues.includes(value) ? value : defaultValue;
}

// Optional decimals override (0-2); anything else means "use the mode's
// default".
export function decimalsOverride(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = parseConfigNumber(value);
  return num !== null && Number.isInteger(num) && num >= 0 && num <= 2 ? num : null;
}

// Optional room_columns/room_rows override; anything invalid — not a positive
// integer, or an unreasonably large value that couldn't possibly be a
// deliberate layout choice — means "decide the grid automatically" rather than
// throwing or building an absurdly large grid.
export function positiveInteger(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = parseConfigNumber(value);
  return num !== null && Number.isInteger(num) && num >= 1 && num <= 20 ? num : null;
}

// rotation_seconds/slide_seconds: an invalid, missing, or out-of-range value
// falls back to the built-in default instead of throwing — this only affects
// cosmetic timing, not correctness. min/max are practical per-field bounds:
// without an upper bound, an extreme value could overflow the
// animation-duration/setTimeout millisecond math it feeds into.
export function positiveSeconds(value, fallback, min, max) {
  const num = parseConfigNumber(value);
  return num !== null && num >= min && num <= max ? num : fallback;
}

// A number at a named config path. Unlike the optional fields above, a
// malformed value here throws: it appears inside classification blocks, where
// silently substituting a default would produce a profile the user never asked
// for and cannot see.
export function numberAtPath(value, path) {
  const parsed = parseConfigNumber(value);
  if (parsed === null) pathError(path, "must be a finite number");
  return parsed;
}

// Rejects any key the schema does not know. Unknown keys are an error rather
// than being ignored, because a typo'd classification key would otherwise
// silently produce a different profile than intended.
export function assertAllowedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) pathError(`${path}.${key}`, "is not a supported option");
  }
}

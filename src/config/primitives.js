// The value-level building blocks every configuration field is built from.
//
// Two deliberately different failure modes run through this file, and the split
// is a product decision rather than an implementation detail:
//
//   throw    a structurally invalid value the card cannot work around — a
//            missing required or malformed entity id, a malformed classification block.
//   fall back  a malformed OPTIONAL value — a typo in `decimals` or
//            `room_columns` degrades to the built-in default instead of taking
//            the whole dashboard card down with it.
//
// Which fields belong to which category is fixed by the public contract; see
// each function.

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

// Optional label text, where an EXPLICIT empty string is a real answer.
//
// The difference from optionalString() is the whole point: for a label, "" means "show
// no label here", which is not the same as "not configured, use the default". Collapsing
// the two — as optionalString() does — makes it impossible to ask for a bare number.
// null therefore means only "absent", and every other string, including "", is honoured
// as written.
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

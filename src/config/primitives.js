// The readers every configuration value is read with, and the check every object's keys pass.
//
// Three answers, fixed per option by the contract (internal dev doc §3 "Konfigurationsvertrag"):
//   refuse     a key the object does not have, a source entity that is not an entity id:
//              setConfig() throws a ConfigError
//   fall back  an invalid value of any other option: the reader returns what the card uses
//              instead and records one diagnostic naming it
//   reject     an invalid value inside a definition object (custom profile, written-out
//              palette): a ConfigValueError, answered by the option that holds it
// Not written (the key missing, or its value null) is always silent and means the default.

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { parseConfigNumber } from "../core/numbers.js";
import { rejectConfiguration, rejectValue } from "./errors.js";
import { nearestKey } from "./suggest.js";

// Strict object check: arrays don't count as a config object.
export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isUnwritten(value) {
  return value === undefined || value === null;
}

// Records what the card uses instead of `value`, and returns it.
function fallBack(diagnostics, path, value, instead, answer) {
  diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback: instead }));
  return answer;
}

// Refuses the first key `object` does not have, naming the option it was probably meant to be.
export function assertKnownKeys(object, allowed, path) {
  const known = allowed instanceof Set ? allowed : new Set(allowed);
  for (const key of Object.keys(object)) {
    if (known.has(key)) continue;
    const nearest = nearestKey(key, known);
    rejectConfiguration("config.unknown_key", { key: `${path}.${key}`, suggestion: nearest === null ? null : `${path}.${nearest}` });
  }
}

// A room's entity: the one value a room cannot do without.
export function requiredEntity(value, path) {
  if (typeof value !== "string" || !value.trim()) rejectConfiguration("config.must_be_entity_id", { key: path });
  return value.trim();
}

// The card's own `entity`: may be left empty when rooms carry the card, but not malformed.
export function readSourceEntity(value, path) {
  if (isUnwritten(value) || value === "") return null;
  return requiredEntity(value, path);
}

export function readBoolean(value, path, diagnostics, fallback) {
  if (isUnwritten(value)) return fallback;
  if (value === true || value === false) return value;
  return fallBack(diagnostics, path, value, fallbackValue(fallback), fallback);
}

// A closed set of words, matched as written.
export function readEnum(value, path, diagnostics, allowed, fallback) {
  if (isUnwritten(value)) return fallback;
  if (allowed.includes(value)) return value;
  return fallBack(diagnostics, path, value, fallbackValue(fallback), fallback);
}

// A number, from YAML or quoted, within [min, max]. Outside them the card uses `fallback`, not
// the nearer bound: an extreme value is a mistake, not a request for the limit. `instead` names
// the fallback when it is not a value of its own (null: decided automatically).
export function readNumber(value, path, diagnostics, { min, max, integer = false, fallback, instead = fallbackValue(fallback) }) {
  if (isUnwritten(value)) return fallback;
  const number = parseConfigNumber(value);
  if (number !== null && number >= min && number <= max && (!integer || Number.isInteger(number))) return number;
  return fallBack(diagnostics, path, value, instead, fallback);
}

// A text that replaces an automatic one (`icon`); empty is not a text.
export function readText(value, path, diagnostics) {
  if (isUnwritten(value)) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallBack(diagnostics, path, value, FALLBACK.AUTOMATIC, null);
}

// A caption where "" is a real answer, "no caption here", distinct from null, "not written".
export function readLabel(value, path, diagnostics) {
  if (isUnwritten(value)) return null;
  if (typeof value === "string") return value.trim();
  return fallBack(diagnostics, path, value, FALLBACK.AUTOMATIC, null);
}

// range_entity/trend_entity: "" turns one off like leaving it out; a value that is not an entity
// id is ignored.
export function readOptionalEntity(value, path, diagnostics) {
  if (isUnwritten(value) || value === "") return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallBack(diagnostics, path, value, FALLBACK.IGNORED, null);
}

// A number inside a definition object.
export function readNumberAtPath(value, path) {
  const number = parseConfigNumber(value);
  if (number === null) rejectValue(path, value);
  return number;
}

// Normalizing the `views:` list. A key an entry or its options do not have refuses the
// configuration; any other malformed entry degrades to "ignored" or "auto" and records a
// diagnostic. The view types and their option schemas are INJECTED, because the registry that
// owns them also owns render callbacks and config/ may not import it.

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { assertKnownKeys, isPlainObject, isUnwritten } from "./primitives.js";

export const VIEW_ENTRY_KEYS = Object.freeze(["type", "enabled", "options"]);

function invalid(diagnostics, path, value, fallback) {
  diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback }));
}

// `undefined`/`null` is the normal "not configured" case (resolves to one auto entry per
// registered view) and is not diagnosed; any other non-array value is diagnosed and
// normalizes to the same null sentinel. An unknown or repeated view type is dropped here, so
// the list that leaves this file names each registered type at most once.
export function normalizeViewsConfig(value, { optionSchemaForView, viewTypes }, diagnostics) {
  if (isUnwritten(value)) return null;
  if (!Array.isArray(value)) {
    invalid(diagnostics, "views", value, FALLBACK.AUTOMATIC);
    return null;
  }
  const views = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const entryPath = `views[${index}]`;
    const named = readViewType(entry, entryPath, viewTypes, diagnostics);
    if (!named) return;
    // A repeated type is reported once, as a repetition; its own options are never read.
    if (seen.has(named.type)) {
      invalid(diagnostics, named.path, named.type, FALLBACK.IGNORED);
      return;
    }
    seen.add(named.type);
    views.push(normalizeViewRequest(entry, named.type, entryPath, optionSchemaForView(named.type) || {}, diagnostics));
  });
  return views;
}

// The registered type one entry names, with the path it was written at, or null (diagnosed).
// A string is shorthand for {type, enabled: true}; an object's own keys are checked first.
function readViewType(entry, entryPath, viewTypes, diagnostics) {
  if (typeof entry === "string") {
    const type = entry.trim();
    if (viewTypes.includes(type)) return { type, path: entryPath };
    invalid(diagnostics, entryPath, entry, FALLBACK.IGNORED);
    return null;
  }
  if (!isPlainObject(entry)) {
    invalid(diagnostics, entryPath, entry, FALLBACK.IGNORED);
    return null;
  }
  assertKnownKeys(entry, VIEW_ENTRY_KEYS, entryPath);
  const type = typeof entry.type === "string" ? entry.type.trim() : "";
  if (viewTypes.includes(type)) return { type, path: `${entryPath}.type` };
  invalid(diagnostics, `${entryPath}.type`, entry.type, FALLBACK.IGNORED);
  return null;
}

// `enabled`: not written means true (listing a view is itself a request), "auto" delegates
// to the view's own default, and any other value is diagnosed and falls back to "auto".
function normalizeViewRequest(entry, type, entryPath, schema, diagnostics) {
  if (typeof entry === "string") return { type, enabled: true, options: {} };
  let enabled = true;
  if (entry.enabled === true || entry.enabled === false || entry.enabled === "auto") {
    enabled = entry.enabled;
  } else if (!isUnwritten(entry.enabled)) {
    enabled = "auto";
    invalid(diagnostics, `${entryPath}.enabled`, entry.enabled, fallbackValue("auto"));
  }
  return { type, enabled, options: normalizeViewOptions(entry.options, `${entryPath}.options`, schema, diagnostics) };
}

// views[i].options against the view's own schema: only keys the view implements are accepted —
// a renderer must never trust an arbitrary user key. A known key's value is validated when its
// schema entry declares a validate(); an invalid value is diagnosed and dropped, so the schema
// default applies. A key with nothing after it is not a request.
function normalizeViewOptions(rawOptions, path, schema, diagnostics) {
  if (isUnwritten(rawOptions)) return {};
  if (!isPlainObject(rawOptions)) {
    invalid(diagnostics, path, rawOptions, FALLBACK.DEFAULTS);
    return {};
  }
  assertKnownKeys(rawOptions, Object.keys(schema), path);
  const options = {};
  for (const [key, value] of Object.entries(rawOptions)) {
    if (isUnwritten(value)) continue;
    const { validate, default: defaultValue } = schema[key];
    if (typeof validate === "function" && !validate(value)) {
      invalid(diagnostics, `${path}.${key}`, value, fallbackValue(defaultValue));
      continue;
    }
    options[key] = value;
  }
  return options;
}

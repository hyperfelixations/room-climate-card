// Normalizing the `views:` list. Non-destructive and never throws: a malformed entry degrades
// to "ignored" or "auto" and records a diagnostic. The view types and their option schemas are
// INJECTED, because the registry that owns them also owns render callbacks and config/ may not
// import it.

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { isPlainObject, optionalString } from "./primitives.js";

function invalid(path, value, fallback) {
  return createDiagnostic("value.invalid", { path, value, fallback });
}

// `undefined`/`null` is the normal "not configured" case (resolves to one auto entry per
// registered view) and is not diagnosed; any other non-array value is diagnosed and
// normalizes to the same null sentinel. An unknown or repeated view type is dropped here, so
// the list that leaves this file names each registered type at most once.
export function normalizeViewsConfig(value, { optionSchemaForView, viewTypes }) {
  if (!Array.isArray(value)) {
    if (value === undefined || value === null) return { views: null, diagnostics: [] };
    return { views: null, diagnostics: [invalid("views", value, FALLBACK.AUTOMATIC)] };
  }
  const views = [];
  const diagnostics = [];
  const seen = new Set();
  value.forEach((entry, index) => {
    const { request, typePath, diagnostics: entryDiagnostics } = normalizeViewRequest(entry, index, {
      optionSchemaForView,
      viewTypes,
    });
    // A repeated type is reported once, as a repetition; its own options are never read.
    if (request && seen.has(request.type)) {
      diagnostics.push(invalid(typePath, request.type, FALLBACK.IGNORED));
      return;
    }
    diagnostics.push(...entryDiagnostics);
    if (!request) return;
    seen.add(request.type);
    views.push(request);
  });
  return { views, diagnostics };
}

// One views: list entry. A string naming a registered view type is shorthand for {type,
// enabled: true}; an object needs such a `type`, else it is ignored with a diagnostic.
// `enabled`: not written means true (listing a view is itself a request), "auto" delegates
// to the view's own default, and any other value is diagnosed and falls back to "auto".
// `typePath` is where the type was written, for the caller's repetition check.
export function normalizeViewRequest(entry, index, { optionSchemaForView, viewTypes }) {
  const entryPath = `views[${index}]`;
  if (typeof entry === "string") {
    const type = entry.trim();
    if (!viewTypes.includes(type)) return { request: null, typePath: entryPath, diagnostics: [invalid(entryPath, entry, FALLBACK.IGNORED)] };
    return { request: { type, enabled: true, options: {} }, typePath: entryPath, diagnostics: [] };
  }
  if (!isPlainObject(entry)) {
    return { request: null, typePath: entryPath, diagnostics: [invalid(entryPath, entry, FALLBACK.IGNORED)] };
  }
  const typePath = `${entryPath}.type`;
  const type = optionalString(entry.type);
  if (!type || !viewTypes.includes(type)) {
    return { request: null, typePath, diagnostics: [invalid(typePath, entry.type, FALLBACK.IGNORED)] };
  }
  const diagnostics = [];
  let enabled;
  if (entry.enabled === true || entry.enabled === false) {
    enabled = entry.enabled;
  } else if (entry.enabled === undefined || entry.enabled === null) {
    enabled = true;
  } else if (entry.enabled === "auto") {
    enabled = "auto";
  } else {
    enabled = "auto";
    diagnostics.push(invalid(`${entryPath}.enabled`, entry.enabled, fallbackValue("auto")));
  }
  const { options, diagnostics: optionsDiagnostics } = normalizeViewOptions(type, entry.options, index, { optionSchemaForView });
  diagnostics.push(...optionsDiagnostics);
  return { request: { type, enabled, options }, typePath, diagnostics };
}

// views:[i].options against the requested view's own schema. Only keys the view implements
// survive — a renderer must never trust an arbitrary user key. A known key's value is
// validated when its schema entry declares a validate(); an invalid value is diagnosed and
// dropped, so the schema default applies. A key with nothing after it is not a request.
export function normalizeViewOptions(type, rawOptions, index, { optionSchemaForView }) {
  const schema = optionSchemaForView(type) || {};
  if (rawOptions === undefined || rawOptions === null) return { options: {}, diagnostics: [] };
  const optionsPath = `views[${index}].options`;
  if (!isPlainObject(rawOptions)) {
    return { options: {}, diagnostics: [invalid(optionsPath, rawOptions, FALLBACK.DEFAULTS)] };
  }
  const result = {};
  const diagnostics = [];
  for (const key of Object.keys(rawOptions)) {
    const path = `${optionsPath}.${key}`;
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      diagnostics.push(createDiagnostic("config.foreign_key", { path }));
      continue;
    }
    const value = rawOptions[key];
    if (value === undefined || value === null) continue;
    const validate = schema[key].validate;
    if (typeof validate === "function" && !validate(value)) {
      diagnostics.push(invalid(path, value, fallbackValue(schema[key].default)));
      continue;
    }
    result[key] = value;
  }
  return { options: result, diagnostics };
}

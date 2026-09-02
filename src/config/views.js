// Normalizing the `views:` list. Non-destructive and never throws: a malformed
// entry degrades to "ignored" or "auto" and records a diagnostic for the element to
// surface. The view types and their option schemas are INJECTED, because the registry
// that owns them also owns render callbacks and config/ may not import it.

import { isPlainObject, optionalString } from "./primitives.js";

// A non-array views: value. `undefined`/`null` is the normal "not configured" case
// (resolves to one auto entry per registered view) and is not diagnosed; any other
// non-array value is diagnosed and normalizes to the same null sentinel.
export function normalizeViewsConfig(value, { optionSchemaForView }) {
  if (!Array.isArray(value)) {
    if (value === undefined || value === null) return { views: null, diagnostics: [] };
    return { views: null, diagnostics: [`views: expected an array, got ${JSON.stringify(value)}`] };
  }
  const views = [];
  const diagnostics = [];
  value.forEach((entry, index) => {
    const { request, diagnostics: entryDiagnostics } = normalizeViewRequest(entry, index, { optionSchemaForView });
    diagnostics.push(...entryDiagnostics);
    if (request) views.push(request);
  });
  return { views, diagnostics };
}

// One views: list entry. A bare non-empty string is shorthand for {type,
// enabled:true}; an object needs a non-empty `type`, else it is dropped with a
// diagnostic. `enabled`: omitted normalizes to true (listing a view is itself a
// request), "auto" delegates to the view's own default, and any other value is
// diagnosed but falls back to "auto" rather than dropping the entry.
export function normalizeViewRequest(entry, index, { optionSchemaForView }) {
  if (typeof entry === "string") {
    const type = entry.trim();
    if (!type) return { request: null, diagnostics: [`views[${index}]: expected a non-empty string or an object`] };
    return { request: { type, enabled: true, options: {} }, diagnostics: [] };
  }
  if (!isPlainObject(entry)) {
    return { request: null, diagnostics: [`views[${index}]: expected a string or an object, got ${JSON.stringify(entry)}`] };
  }
  const type = optionalString(entry.type);
  if (!type) {
    return { request: null, diagnostics: [`views[${index}]: missing or invalid "type"`] };
  }
  const diagnostics = [];
  let enabled;
  if (entry.enabled === true || entry.enabled === false) {
    enabled = entry.enabled;
  } else if (entry.enabled === undefined) {
    enabled = true;
  } else if (entry.enabled === "auto") {
    enabled = "auto";
  } else {
    enabled = "auto";
    diagnostics.push(`views[${index}] ("${type}"): invalid "enabled" value ${JSON.stringify(entry.enabled)}, falling back to "auto"`);
  }
  const { options, diagnostics: optionsDiagnostics } = normalizeViewOptions(type, entry.options, index, { optionSchemaForView });
  diagnostics.push(...optionsDiagnostics);
  return { request: { type, enabled, options }, diagnostics };
}

// views:[i].options against the requested view's own schema. Only keys the view
// implements survive — a renderer must never trust an arbitrary user key. A known
// key's value is validated when its schema entry declares a validate(); an invalid
// value is diagnosed and dropped, so the schema default applies.
export function normalizeViewOptions(type, rawOptions, index, { optionSchemaForView }) {
  const schema = optionSchemaForView(type) || {};
  if (rawOptions === undefined || rawOptions === null) return { options: {}, diagnostics: [] };
  if (!isPlainObject(rawOptions)) {
    return { options: {}, diagnostics: [`views[${index}] ("${type}"): invalid "options" value ${JSON.stringify(rawOptions)}, expected an object`] };
  }
  const result = {};
  const unknownKeys = [];
  const diagnostics = [];
  for (const key of Object.keys(rawOptions)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      unknownKeys.push(key);
      continue;
    }
    const value = rawOptions[key];
    const validate = schema[key].validate;
    if (typeof validate === "function" && !validate(value)) {
      diagnostics.push(`views[${index}] ("${type}"): invalid "${key}" value ${JSON.stringify(value)}, falling back to default`);
      continue;
    }
    result[key] = value;
  }
  if (unknownKeys.length) {
    diagnostics.push(`views[${index}] ("${type}"): ignoring unknown "options" key(s) ${unknownKeys.map((k) => JSON.stringify(k)).join(", ")}`);
  }
  return { options: result, diagnostics };
}

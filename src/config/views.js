// Normalizing the `views:` list.
//
// This whole file is deliberately NON-DESTRUCTIVE and never throws: a malformed
// views: config degrades to "ignored" or "auto" rather than breaking the card.
// But it no longer does so invisibly — every fallback records a diagnostic
// string, which the orchestrating element surfaces exactly once per config
// change. Printing them is not this module's job: a pure normalizer must not
// write to the console, and the deduplication needs state that only the caller
// has.
//
// The view types and their option schemas are INJECTED. The registry that owns
// them also owns render/update callbacks, so importing it here would drag the
// rendering layer into the configuration layer.

import { isPlainObject, optionalString } from "./primitives.js";

// A non-array views: value. `undefined`/`null` (genuinely omitted from the YAML)
// is NOT diagnosed — that is the normal "not configured" case, and it resolves
// to "one auto entry per registered view". Any OTHER non-array value (a string,
// number, plain object, ...) is a real misconfiguration and IS diagnosed, then
// normalizes to the same null sentinel.
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

// One views: list entry. A bare non-empty string is shorthand for
// {type, enabled:true}; an object needs at least a non-empty `type`. An entry
// with no resolvable type at all is dropped WITH a diagnostic.
//
// `enabled`: listing a view is itself an explicit request, regardless of which
// syntax was used, so an omitted field normalizes to true; only an explicitly
// written "auto" delegates to the view's own default. Any other value (a typo
// like "yes", a stray 1, explicit null) is diagnosed but still falls back to
// "auto" rather than dropping the entry — a typo in enabled: must not make a
// view disappear as completely as an unknown type would.
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
// actually implements survive — a renderer must never end up trusting an
// arbitrary user-supplied key. A known key's VALUE is validated too when its
// schema entry declares a validate(); an invalid value is diagnosed and dropped,
// so the schema default applies instead.
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

// Semantic view registry and config resolution, independent of render callbacks. Each view is
// one presentation module in view-content/: its definition and its content builder.
// Declaration order defines both carousel position and automatic slide order.

import { rangeViewDefinition } from "./view-content/range.js";
import { rangeScaleViewDefinition } from "./view-content/range-scale.js";
import { scaleViewDefinition } from "./view-content/scale.js";
import { extremesViewDefinition } from "./view-content/extremes.js";

const DEFINITION_FUNCTIONS = ["condition", "defaultEnabled", "buildContent"];

// Validates a definition list once, so drift fails at load instead of as an empty slot.
export function defineViews(definitions) {
  const seen = new Set();
  for (const definition of definitions) {
    if (seen.has(definition.key)) throw new Error(`view definitions: duplicate key "${definition.key}"`);
    seen.add(definition.key);
    for (const name of DEFINITION_FUNCTIONS) {
      if (typeof definition[name] !== "function") throw new Error(`view definitions: "${definition.key}" needs a ${name} function`);
    }
    if (typeof definition.optionsSchema !== "object" || definition.optionsSchema === null) {
      throw new Error(`view definitions: "${definition.key}" needs an optionsSchema object`);
    }
  }
  return Object.freeze([...definitions]);
}

export const VIEW_DEFINITIONS = defineViews([
  rangeViewDefinition,
  rangeScaleViewDefinition,
  scaleViewDefinition,
  extremesViewDefinition,
]);

export function optionSchemaForView(type) {
  return VIEW_DEFINITIONS.find((definition) => definition.key === type)?.optionsSchema;
}

// An explicit `views` list is authoritative, including an empty list; otherwise
// definitions resolve as `auto` in declaration order. Entries retain requested,
// available and active independently; `keys` contains active views in order. An unknown
// or repeated type is skipped: normalizeViewsConfig() has already reported and dropped it.
export function resolveActiveViews(definitions, availability, config) {
  const requests = Array.isArray(config?.views)
    ? config.views
    : definitions.map((definition) => ({ type: definition.key, enabled: "auto", options: {} }));
  const seen = new Set();
  const entries = [];
  for (const request of requests) {
    const definition = definitions.find((candidate) => candidate.key === request.type);
    if (!definition || seen.has(request.type)) continue;
    seen.add(request.type);
    const available = definition.condition(availability);
    const requested = request.enabled === "auto" ? definition.defaultEnabled(availability) : request.enabled === true;
    entries.push({ type: request.type, requested, available, active: requested && available, options: request.options });
  }

  return { keys: entries.filter((entry) => entry.active).map((entry) => entry.type), entries };
}

// Resolves every schema option to its validated value or default.
export function resolveViewOptions(definition, providedOptions) {
  const schema = definition?.optionsSchema || {};
  const resolved = {};
  for (const key of Object.keys(schema)) {
    const provided = providedOptions ? providedOptions[key] : undefined;
    resolved[key] = provided === undefined ? schema[key].default : provided;
  }
  return resolved;
}

// Empty-by-configuration collapses the view area; requested-but-unavailable views
// keep it open for a diagnostic hint.
export function buildViewState({ availability, config }, definitions = VIEW_DEFINITIONS) {
  const { keys, entries } = resolveActiveViews(definitions, availability, config);

  // Resolve inactive definitions too so consumers need no special case.
  const options = {};
  for (const definition of definitions) {
    const entry = entries.find((candidate) => candidate.type === definition.key);
    options[definition.key] = resolveViewOptions(definition, entry?.options);
  }

  const anyRequestedButUnavailable = entries.some((entry) => entry.requested && !entry.available);
  return {
    keys,
    entries,
    options,
    collapsed: keys.length === 0 && !anyRequestedButUnavailable,
  };
}

// Content per view in declaration order; an inactive view stays null and builds nothing.
export function buildViewContent({ shared, viewState }, definitions = VIEW_DEFINITIONS) {
  const byKey = {};
  for (const definition of definitions) {
    byKey[definition.key] = viewState.keys.includes(definition.key) ? definition.buildContent(shared, viewState.options[definition.key]) : null;
  }
  return byKey;
}

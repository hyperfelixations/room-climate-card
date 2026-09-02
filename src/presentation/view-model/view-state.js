// Semantic view registry and config resolution, independent of render callbacks.
// Declaration order defines both carousel position and automatic slide order.

import { boolOption, enumOption } from "../../config/option-schemas.js";

export const VIEW_DEFINITIONS = [
  {
    key: "range",
    // Available with a usable daily range.
    condition: (availability) => availability.hasRange,
    // `auto` mirrors availability except for range_scale.
    defaultEnabled: (availability) => availability.hasRange,
    // `show_time` affects timestamps only.
    optionsSchema: { show_time: boolOption(true) },
  },
  {
    key: "range_scale",
    // Availability and user activation remain separate.
    condition: (availability) => availability.rangeScaleAvailable,
    // The only view disabled by default because it mirrors the main scale shape.
    defaultEnabled: () => false,
    // Band toggles suppress both band and label. `show_footer` controls presence;
    // `footer` selects compact/detailed form. Legacy `footer: false` is folded below.
    optionsSchema: {
      show_comfort_band: boolOption(true),
      show_optimal_band: boolOption(true),
      show_footer: boolOption(true),
      footer: enumOption("detailed", ["compact", "detailed", false]),
    },
  },
  {
    key: "scale",
    condition: () => true,
    // An explicit `views` list may still omit the otherwise-default scale.
    defaultEnabled: () => true,
    // Band toggles are visual only. Marker modes select average, extrema or all rooms.
    optionsSchema: {
      show_comfort_band: boolOption(true),
      show_optimal_band: boolOption(true),
      show_footer: boolOption(true),
      // Legacy spelling of `show_footer`; this view has no footer mode.
      footer: boolOption(true),
      markers: enumOption("extremes", ["average", "extremes", "all"]),
    },
  },
  {
    key: "extremes",
    condition: (availability) => availability.roomsComparable,
    defaultEnabled: (availability) => availability.roomsComparable,
    // `show_value` hides only the numeric value.
    optionsSchema: { show_value: boolOption(true) },
  },
];

export function optionSchemaForView(type) {
  return VIEW_DEFINITIONS.find((definition) => definition.key === type)?.optionsSchema;
}

// An explicit `views` list is authoritative, including an empty list; otherwise
// definitions resolve as `auto` in declaration order. Entries retain requested,
// available and active independently; `keys` contains active views in order.
export function resolveActiveViews(definitions, availability, config) {
  const requests = Array.isArray(config?.views)
    ? config.views
    : definitions.map((definition) => ({ type: definition.key, enabled: "auto", options: {} }));
  const diagnostics = [];
  const seen = new Set();
  const entries = [];
  for (const request of requests) {
    const definition = definitions.find((candidate) => candidate.key === request.type);
    if (!definition) {
      diagnostics.push(`views: unknown view type "${request.type}"`);
      continue;
    }
    if (seen.has(request.type)) {
      diagnostics.push(`views: duplicate view type "${request.type}"`);
      continue;
    }
    seen.add(request.type);
    const available = definition.condition(availability);
    const requested = request.enabled === "auto" ? definition.defaultEnabled(availability) : request.enabled === true;
    entries.push({ type: request.type, requested, available, active: requested && available, options: request.options });
  }

  return { keys: entries.filter((entry) => entry.active).map((entry) => entry.type), entries, diagnostics };
}

// Resolves every schema option to its validated value or default.
export function resolveViewOptions(definition, providedOptions) {
  const schema = definition?.optionsSchema || {};
  const resolved = {};
  for (const key of Object.keys(schema)) {
    const provided = providedOptions ? providedOptions[key] : undefined;
    resolved[key] = provided === undefined ? schema[key].default : provided;
  }

  // Fold legacy `footer: false` here because option meaning belongs to the registry,
  // not schema parsing. Explicit `show_footer` wins; `footer` then regains its mode default.
  if (Object.prototype.hasOwnProperty.call(schema, "show_footer") && resolved.footer === false) {
    if (!providedOptions || providedOptions.show_footer === undefined) resolved.show_footer = false;
    resolved.footer = schema.footer.default;
  }
  return resolved;
}

// Empty-by-configuration collapses the view area; requested-but-unavailable views
// keep it open for a diagnostic hint.
export function buildViewState({ availability, config }) {
  const { keys, entries } = resolveActiveViews(VIEW_DEFINITIONS, availability, config);

  // Resolve inactive definitions too so consumers need no special case.
  const options = {};
  for (const definition of VIEW_DEFINITIONS) {
    const entry = entries.find((candidate) => candidate.type === definition.key);
    options[definition.key] = resolveViewOptions(definition, entry?.options);
  }

  const anyRequestedButUnavailable = entries.some((entry) => entry.requested && !entry.available);
  return {
    keys,
    entries,
    options,
    collapsed: keys.length === 0 && !anyRequestedButUnavailable,
    hasRangeScale: keys.includes("range_scale"),
  };
}

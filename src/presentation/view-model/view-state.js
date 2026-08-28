// What the carousel shows: the view DEFINITIONS and the resolution of a
// configuration against them.
//
// A definition here is purely semantic — a key, when the view CAN be shown, whether
// it is on by default, and which options it accepts. It carries no render or update
// callback. Those are wired separately by the composition root, which is what lets
// this file be reasoned about (and tested) without any rendering code, and what
// will let the eventual views layer consume the same definitions.
//
// Declaration order is the only thing that decides on-screen left-to-right order.
// The resolved list is also the auto-slide order, so adding a view means adding an
// entry in the position it should appear — nothing else.

import { boolOption, enumOption } from "../../config/option-schemas.js";

export const VIEW_DEFINITIONS = [
  {
    key: "range",
    // Available whenever the daily-range entity reports a usable width.
    condition: (availability) => availability.hasRange,
    // "auto" mirrors availability for every view except range_scale.
    defaultEnabled: (availability) => availability.hasRange,
    // show_time toggles whether the daily min/max cards show their timestamp; the
    // value itself is unaffected either way.
    optionsSchema: { show_time: boolOption(true) },
  },
  {
    key: "range_scale",
    // Pure availability: whether an available range_scale view is actually wanted
    // is a configuration decision, not a data one.
    condition: (availability) => availability.rangeScaleAvailable,
    // The one view that is off unless explicitly listed. It duplicates the main
    // scale's shape with different markers, so showing it unasked would be noise.
    defaultEnabled: () => false,
    // The band toggles suppress both the coloured band and its descriptive label,
    // independently per view.
    //
    // The footer is two questions, and it takes two keys because they are two questions:
    // show_footer says WHETHER this view draws one, footer says WHICH FORM it takes —
    // "detailed" with the min/max timestamps, "compact" without them. `footer: false` is the
    // older way of writing show_footer: false and still works; resolveViewOptions() folds it
    // over. Both are ANDed with the global hide_footer.
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
    // Unconditionally true only because condition() is: there is no special
    // protection against a views: list that omits scale, and omitting it genuinely
    // omits it.
    defaultEnabled: () => true,
    // The band toggles are purely visual — the comfort/optimal bounds, the
    // classification, the footer text and the marker colours are all computed
    // independently and never read them. markers:"extremes" is the established
    // coldest+warmest+average set; "average" leaves only the average; "all" adds
    // every valid room.
    optionsSchema: {
      show_comfort_band: boolOption(true),
      show_optimal_band: boolOption(true),
      show_footer: boolOption(true),
      // The older spelling of show_footer, kept for the cards that already use it and
      // folded over by resolveViewOptions(). This view's footer has only one form, so
      // unlike range_scale's there is no mode left for the word to carry.
      footer: boolOption(true),
      markers: enumOption("extremes", ["average", "extremes", "all"]),
    },
  },
  {
    key: "extremes",
    condition: (availability) => availability.roomsComparable,
    defaultEnabled: (availability) => availability.roomsComparable,
    // show_value toggles the numeric value on the coldest/warmest cards; the
    // label, room name and colour stay regardless.
    optionsSchema: { show_value: boolOption(true) },
  },
];

export function optionSchemaForView(type) {
  return VIEW_DEFINITIONS.find((definition) => definition.key === type)?.optionsSchema;
}

// Resolves the final ordered list of active views.
//
// views: is the single public view-composition surface and is fully AUTHORITATIVE
// the moment it is present — even as an explicit empty list. Only listed types can
// appear, in exactly the listed order; a type the list does not mention is simply
// never shown. There is no "append whatever is missing" fallback.
//
// Without views: configured (the null sentinel), the request list defaults to one
// "auto" entry per definition, in declaration order.
//
// Each request stays separated along three axes, because the null-view state needs
// to tell them apart: `requested` (did the configuration ask for it), `available`
// (could it show), `active` (both). `keys` is the ordered list of active ones.
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

// One view's fully resolved options: every schema key gets either the
// already-validated configured value or its default. Callers never need to know
// which keys exist, so a future option flows through here with no changes.
export function resolveViewOptions(definition, providedOptions) {
  const schema = definition?.optionsSchema || {};
  const resolved = {};
  for (const key of Object.keys(schema)) {
    const provided = providedOptions ? providedOptions[key] : undefined;
    resolved[key] = provided === undefined ? schema[key].default : provided;
  }

  // THE ONE LEGACY FOLD, and the reason it lives here rather than in config/views.js: that
  // module is deliberately schema-driven and knows nothing about what any option MEANS,
  // which is what keeps the view registry out of the configuration layer. This does know,
  // because the definitions above are right here.
  //
  // `footer: false` said "no footer in this view" before the question was split into whether
  // and which form. It still says that — unless show_footer was written too, in which case
  // the newer key decides, exactly as the show: block outranks its own older spellings. The
  // word then falls back to its default so that nothing downstream reads `false` as a form.
  if (Object.prototype.hasOwnProperty.call(schema, "show_footer") && resolved.footer === false) {
    if (!providedOptions || providedOptions.show_footer === undefined) resolved.show_footer = false;
    resolved.footer = schema.footer.default;
  }
  return resolved;
}

// The complete view state for one render.
//
// The two null-view states are deliberately different: a configuration that
// genuinely asks for nothing collapses the view area entirely, while a view that
// WAS requested but is systemically unavailable shows a hint instead — so the user
// can tell "nothing to show by design" from "something is misconfigured".
export function buildViewState({ availability, config }) {
  const { keys, entries } = resolveActiveViews(VIEW_DEFINITIONS, availability, config);

  // Resolved for every definition, not just the active ones: it is cheap, and a
  // consumer checking an inactive view's would-be options needs no special case.
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

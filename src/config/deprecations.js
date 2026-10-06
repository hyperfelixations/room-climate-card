// The older YAML spellings the card still recognizes, each at one stage on its way out. The stage
// decides how the card answers an occurrence; whether the spelling still takes effect is the
// normalizer's own code, which tests hold to the stage. Two places recognize them: the top-level
// key check (top-level-keys.js) and the view options (views.js). Full contract: see internal dev
// doc §4 "Deprecation-Register".

import { createDiagnostic } from "../core/diagnostics.js";
import { parseRoomsState } from "./show.js";

//   PREFERRED  both spellings take effect, the newer one wins; silent
//   WARNED     both take effect, the newer one wins; the older one is warned about
//   REMOVED    only the newer one takes effect; the older one is warned about and ignored
// Past REMOVED the entry is deleted, and the key contract answers the spelling like any other.
export const DEPRECATION_STAGE = Object.freeze({ PREFERRED: 1, WARNED: 2, REMOVED: 3 });

const DIAGNOSTIC_FOR_STAGE = Object.freeze({
  [DEPRECATION_STAGE.PREFERRED]: null,
  [DEPRECATION_STAGE.WARNED]: "config.deprecated",
  [DEPRECATION_STAGE.REMOVED]: "config.removed",
});

const asBoolean = (value) => (typeof value === "boolean" ? value : undefined);

// The spellings the show: block and per-view show_footer replaced in 2.39.0; one switch for all.
const SHOW_BLOCK_SPELLINGS = DEPRECATION_STAGE.REMOVED;

// One entry per place: a top-level `key`, or a `view` and its `option`. `matches` narrows an entry
// to some values (default: every written value); `replacement` is a path, relative to the entry's
// `views[i].options` for a view option; `equivalent` maps a written value to the replacement's
// value, or undefined when there is none.
export const DEPRECATIONS = Object.freeze([
  { key: "show_rooms", replacement: "show.rooms", equivalent: parseRoomsState, stage: SHOW_BLOCK_SPELLINGS },
  {
    key: "unavailable_values",
    replacement: "show.unavailable_rooms",
    equivalent: (value) => (value === "show" ? true : value === "hide" ? false : undefined),
    stage: SHOW_BLOCK_SPELLINGS,
  },
  {
    key: "hide_footer",
    replacement: "views[].options.show_footer",
    equivalent: (value) => (typeof value === "boolean" ? !value : undefined),
    stage: SHOW_BLOCK_SPELLINGS,
  },
  { view: "scale", option: "footer", replacement: "show_footer", equivalent: asBoolean, stage: SHOW_BLOCK_SPELLINGS },
  // range_scale keeps `footer` as its form (compact/detailed); only `false` is retired.
  {
    view: "range_scale",
    option: "footer",
    matches: (value) => value === false,
    replacement: "show_footer",
    equivalent: asBoolean,
    stage: SHOW_BLOCK_SPELLINGS,
  },
].map(Object.freeze));

function placeOf(entry) {
  return entry.key !== undefined ? entry.key : `${entry.view}.${entry.option}`;
}

function assertEntry(entry) {
  const named = JSON.stringify(entry);
  const topLevel = typeof entry.key === "string" && entry.key !== "";
  const viewOption = typeof entry.view === "string" && entry.view !== "" && typeof entry.option === "string" && entry.option !== "";
  const anyViewPart = entry.view !== undefined || entry.option !== undefined;
  if (topLevel === anyViewPart || (anyViewPart && !viewOption)) {
    throw new Error(`deprecations: ${named} must name a top-level key or a view and its option`);
  }
  if (!Object.hasOwn(DIAGNOSTIC_FOR_STAGE, entry.stage) || typeof entry.stage !== "number") {
    throw new Error(`deprecations: ${named} has no known stage`);
  }
  if (typeof entry.replacement !== "string" || entry.replacement === "") {
    throw new Error(`deprecations: ${named} must name its replacement`);
  }
  for (const hook of ["matches", "equivalent"]) {
    if (entry[hook] !== undefined && typeof entry[hook] !== "function") throw new Error(`deprecations: ${named}.${hook} must be a function`);
  }
}

// Validated once, at module load, into lookups by place.
export function createDeprecationRegister(entries) {
  const topLevel = new Map();
  const viewOptions = new Map();
  for (const entry of entries) {
    assertEntry(entry);
    const lookup = entry.key !== undefined ? topLevel : viewOptions;
    const place = placeOf(entry);
    if (lookup.has(place)) throw new Error(`deprecations: two entries for ${place}`);
    lookup.set(place, entry);
  }
  return Object.freeze({
    topLevel: (key) => topLevel.get(key) ?? null,
    viewOption(type, option, value) {
      const entry = viewOptions.get(`${type}.${option}`);
      return entry && (entry.matches === undefined || entry.matches(value)) ? entry : null;
    },
    // Options a view accepts beside its schema: those whose every written value is removed.
    toleratedViewOptions: (type) =>
      [...viewOptions.values()].filter((entry) => entry.view === type && isIneffective(entry)).map((entry) => entry.option),
  });
}

const REGISTER = createDeprecationRegister(DEPRECATIONS);
export const topLevelDeprecation = REGISTER.topLevel;
export const viewOptionDeprecation = REGISTER.viewOption;
export const toleratedViewOptions = REGISTER.toleratedViewOptions;

export function isIneffective(entry) {
  return entry.stage >= DEPRECATION_STAGE.REMOVED;
}

// A value with an equivalent is a known short word, so it is shown; any other is not quoted back.
function spelled(path, value) {
  return value === undefined ? path : `${path}: ${typeof value === "string" ? value.trim() : String(value)}`;
}

// The warning one occurrence gets at the entry's stage, or null.
export function deprecationDiagnostic(entry, path, value, replacementPath = entry.replacement) {
  const code = DIAGNOSTIC_FOR_STAGE[entry.stage];
  if (!code) return null;
  const equivalent = entry.equivalent ? entry.equivalent(value) : undefined;
  return createDiagnostic(code, {
    path,
    params: {
      written: spelled(path, equivalent === undefined ? undefined : value),
      replacement: spelled(replacementPath, equivalent),
    },
  });
}

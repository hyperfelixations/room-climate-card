// The whole `setConfig()` contract, as one pure function. normalizeConfig() returns the
// normalized config or throws a ConfigError from the closed catalog in errors.js; every other
// invalid value records a diagnostic on _configDiagnostics instead, which the card shows as a
// warning. Transaction semantics: see internal dev doc §3 "setConfig() und YAML-Normalisierung".
//
// Injected collaborators, because config/ must not import the domain, i18n or view
// registries. This list is authoritative:
//   classificationZones   the accepted zone vocabulary
//   paletteForName        a palette by name, or the default for null
//   paletteForColor       a ramp derived from one named colour
//   paletteForGradient    a ramp derived from two or three colours joined by hyphens
//   assertPalette         what makes a written-out palette usable
//   completePalette       fills a validated palette's missing wings
//   isSupportedLanguage   whether a language code has translations
//   optionSchemaForView   a view type's option schema, or undefined
//   viewTypes             every registered view type, for views and start_view
//   metricKindForUnit     a unit string -> metric kind
//   unitProfileForUnit    a metric kind + unit string -> unit profile

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import { normalizeAction } from "./actions.js";
import { rejectConfiguration } from "./errors.js";
import { normalizeRooms } from "./rooms.js";
import { normalizeViewsConfig } from "./views.js";
import { normalizeShowConfig, readRoomsState, resolveShowConfig, SHOW_ROOMS_DEFAULT } from "./show.js";
import { checkTopLevelKeys } from "./top-level-keys.js";
import { normalizeClassificationConfig } from "./classification/normalize.js";
import { normalizePalette } from "./classification/palette.js";
import {
  assertKnownKeys,
  isPlainObject,
  isUnwritten,
  readBoolean,
  readEnum,
  readLabel,
  readNumber,
  readOptionalEntity,
  readSourceEntity,
  readText,
} from "./primitives.js";

const ROOM_SORTS = ["configured", "name", "value_asc", "value_desc"];
const ROOM_LABELS = ["auto", "short", "name"];
// room_columns/room_rows: a larger grid cannot be a deliberate layout; null decides automatically.
const ROOM_GRID = { min: 1, max: 20, integer: true, fallback: null, instead: FALLBACK.AUTOMATIC };

// Optional language override; "auto" keeps the automatic hass-based detection. Only a language
// that actually has a translation block is accepted, so an override can never select one that
// would just fall back to English anyway.
export function normalizeLanguage(value, isSupportedLanguage, diagnostics) {
  if (isUnwritten(value)) return "auto";
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (code === "auto" || (code && isSupportedLanguage(code))) return code;
  diagnostics.push(createDiagnostic("value.invalid", { path: "language", value, fallback: fallbackValue("auto") }));
  return "auto";
}

// The two older spellings of a `show:` decision, read WITHOUT a default of their own, so
// SHOW_SWITCHES stays the one place these defaults live: each speaks only where it asks for
// something other than the default. An invalid value is a warning and asks for nothing. See
// internal dev doc §3 "Der show:-Block".
export function legacyShowRequests(userConfig, diagnostics) {
  const requests = {};
  if (!isUnwritten(userConfig.show_rooms)) {
    const rooms = readRoomsState(userConfig.show_rooms, "show_rooms", diagnostics);
    if (rooms !== SHOW_ROOMS_DEFAULT) requests.rooms = rooms;
  }
  if (readEnum(userConfig.unavailable_values, "unavailable_values", diagnostics, ["show", "hide"], "show") === "hide") {
    requests.unavailable_rooms = false;
  }
  return requests;
}

// Title and subtitle take one shape carrying both what the line says and how it
// behaves when too wide, in four spellings: `text`, a bare `clip`/`wrap` (overflow
// only), `""` (no line), or `{text, overflow}`. A bare `clip`/`wrap` is read as the
// overflow mode, so those two words cannot be the text — escape via `{text: wrap}`.
// Defaults differ and are measured from the stylesheet: title wraps, subtitle clips.
// See internal dev doc §3 "Konfigurationsvertrag" (Kopfzeilen).
export const HEADER_LINE_OVERFLOWS = ["clip", "wrap"];

export function normalizeHeaderLine(value, defaultOverflow, path, diagnostics) {
  if (isUnwritten(value)) return { text: null, overflow: defaultOverflow };
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (HEADER_LINE_OVERFLOWS.includes(word)) return { text: null, overflow: word };
    // "" here means "show no line", which is a real answer and not the same as "not written".
    return { text: readLabel(value, path, diagnostics), overflow: defaultOverflow };
  }
  if (!isPlainObject(value)) {
    diagnostics.push(createDiagnostic("value.invalid", { path, value, fallback: FALLBACK.AUTOMATIC }));
    return { text: null, overflow: defaultOverflow };
  }
  assertKnownKeys(value, ["text", "overflow"], path);
  const text = readLabel(value.text, `${path}.text`, diagnostics);
  if (isUnwritten(value.overflow)) return { text, overflow: defaultOverflow };
  const overflow = typeof value.overflow === "string" ? value.overflow.trim().toLowerCase() : null;
  if (HEADER_LINE_OVERFLOWS.includes(overflow)) return { text, overflow };
  diagnostics.push(createDiagnostic("value.invalid", { path: `${path}.overflow`, value: value.overflow, fallback: fallbackValue(defaultOverflow) }));
  return { text, overflow: defaultOverflow };
}

// Which view the card opens on. Not written, and a value that names no registered view type,
// both mean "the first available one", the latter with a diagnostic. View types are injected,
// because config/ must not import the view registry.
export function normalizeStartView(value, viewTypes, diagnostics) {
  if (isUnwritten(value)) return null;
  const requested = typeof value === "string" ? value.trim() : "";
  if (viewTypes.includes(requested)) return requested;
  diagnostics.push(createDiagnostic("value.invalid", { path: "start_view", value, fallback: FALLBACK.FIRST_VIEW }));
  return null;
}

// The older spellings due for removal at the next major, and what replaces each. Silent while
// DEPRECATION_LEVEL is null; at "warning" each one written is named. See internal dev doc §3
// "Konfigurationsvertrag".
export const DEPRECATION_LEVEL = null;

export const DEPRECATED_SPELLINGS = Object.freeze([
  Object.freeze({ key: "show_rooms", replacement: "show.rooms" }),
  Object.freeze({ key: "unavailable_values", replacement: "show.unavailable_rooms" }),
  Object.freeze({ key: "hide_footer", replacement: "views[].options.show_footer" }),
]);

export function deprecationDiagnostics(userConfig, level) {
  if (level !== "warning") return [];
  const deprecated = (path, written, replacement) => createDiagnostic("config.deprecated", { path, params: { written, replacement } });
  const found = DEPRECATED_SPELLINGS.filter(({ key }) => !isUnwritten(userConfig[key])).map(({ key, replacement }) =>
    deprecated(key, key, replacement)
  );
  // `footer: false` in a view's options is the older spelling of `show_footer: false`.
  (Array.isArray(userConfig.views) ? userConfig.views : []).forEach((entry, index) => {
    if (!isPlainObject(entry) || !isPlainObject(entry.options) || entry.options.footer !== false) return;
    const path = `views[${index}].options.footer`;
    found.push(deprecated(path, `${path}: false`, `views[${index}].options.show_footer: false`));
  });
  return found;
}

// Diagnostics in the order their top-level keys are written, so a list of warnings reads
// like the YAML it describes. The sort is stable: within one key, reading order stays.
function inWrittenOrder(diagnostics, userConfig) {
  const position = new Map(Object.keys(userConfig).map((key, index) => [key, index]));
  const rank = (diagnostic) => position.get(diagnostic.path.match(/^[^.[]+/)[0]) ?? position.size;
  return [...diagnostics].sort((one, other) => rank(one) - rank(other));
}

export function normalizeConfig(config, collaborators) {
  const { isSupportedLanguage, optionSchemaForView, viewTypes } = collaborators;
  const userConfig = config ?? {};
  if (!isPlainObject(userConfig)) rejectConfiguration("config.not_object");

  // Before any value is read: a typo of an option refuses the card, a foreign key is noted.
  const diagnostics = [];
  checkTopLevelKeys(userConfig, diagnostics);

  // `entity` is OPTIONAL and read before the requirement below: absent/empty is legitimate
  // (rooms can carry the card), present-but-malformed refuses.
  const entity = readSourceEntity(userConfig.entity, "entity");

  // rooms is optional too; every entry is fully validated (keys, entity, uniqueness) before
  // the combined requirement is judged.
  const rooms = isUnwritten(userConfig.rooms) ? [] : normalizeRooms(userConfig.rooms, diagnostics);

  // THE requirement: a current-value source must exist. `range_entity`/`trend_entity`
  // describe a value rather than being one, so neither satisfies it.
  if (!entity && rooms.length === 0) rejectConfiguration("config.no_source");

  // The other objects the card owns, each with its keys checked before its values.
  const views = normalizeViewsConfig(userConfig.views, { optionSchemaForView, viewTypes }, diagnostics);
  const classification = normalizeClassificationConfig(userConfig.classification, collaborators, diagnostics);
  // The resolved palette object, not its name: resolving once here keeps the domain
  // registry out of the render path.
  const palette = normalizePalette(userConfig.palette, collaborators, diagnostics);

  // WHICH PARTS THE CARD DRAWS, resolved here and nowhere else. The block wins WHERE IT
  // SPEAKS — per decision, not per block — over the two older top-level spellings, which
  // are on their way out (backlog, next major). Everything downstream sees `config.show`
  // only. See internal dev doc §3 "Der show:-Block".
  const requestedShow = normalizeShowConfig(userConfig.show, diagnostics);
  const show = resolveShowConfig({ ...legacyShowRequests(userConfig, diagnostics), ...requestedShow });

  // The two header lines; see normalizeHeaderLine() above.
  const title = normalizeHeaderLine(userConfig.title, "wrap", "title", diagnostics);
  const subtitle = normalizeHeaderLine(userConfig.subtitle, "clip", "subtitle", diagnostics);

  const normalized = {
    entity,
    // entity_label keeps an explicit "" as "no caption" (see buildAverage()).
    entity_label: readLabel(userConfig.entity_label, "entity_label", diagnostics),
    title,
    subtitle,
    icon: readText(userConfig.icon, "icon", diagnostics),
    // WHETHER each part is drawn; "" on the part's key and `show.<part>: false` are two
    // roads to the same absent node.
    show,
    // null: the measurement's own precision, which only the view model knows.
    decimals: readNumber(userConfig.decimals, "decimals", diagnostics, { min: 0, max: 2, integer: true, fallback: null, instead: FALLBACK.METRIC_DECIMALS }),
    language: normalizeLanguage(userConfig.language, isSupportedLanguage, diagnostics),
    // The one global footer switch: turns every view's footer off at once. Backlog
    // removal at the next major, leaving per-view `show_footer` as the only spelling.
    hide_footer: readBoolean(userConfig.hide_footer, "hide_footer", diagnostics, DEFAULT_CONFIG.hide_footer),
    // The bounds keep an extreme value out of the animation-duration/setTimeout
    // millisecond maths it feeds into.
    rotation_seconds: readNumber(userConfig.rotation_seconds, "rotation_seconds", diagnostics, { min: 1, max: 3600, fallback: DEFAULT_CONFIG.rotation_seconds }),
    slide_seconds: readNumber(userConfig.slide_seconds, "slide_seconds", diagnostics, { min: 0.1, max: 10, fallback: DEFAULT_CONFIG.slide_seconds }),
    hold_seconds: DEFAULT_CONFIG.hold_seconds,
    // Independent: auto_slide gates the automatic rotation timer, swipe gates the
    // manual drag gesture. Both default true.
    auto_slide: readBoolean(userConfig.auto_slide, "auto_slide", diagnostics, DEFAULT_CONFIG.auto_slide),
    swipe: readBoolean(userConfig.swipe, "swipe", diagnostics, DEFAULT_CONFIG.swipe),
    tap_action: normalizeAction(userConfig.tap_action, "tap_action", diagnostics, DEFAULT_CONFIG.tap_action),
    hold_action: normalizeAction(userConfig.hold_action, "hold_action", diagnostics, DEFAULT_CONFIG.hold_action),
    // Optional room-chip grid override; null means "decide automatically".
    room_columns: readNumber(userConfig.room_columns, "room_columns", diagnostics, ROOM_GRID),
    room_rows: readNumber(userConfig.room_rows, "room_rows", diagnostics, ROOM_GRID),
    // Presentation only: room_sort reorders the rendered chips, never the value-sorted
    // list calculations use; room_label picks between the short/name pair.
    room_sort: readEnum(userConfig.room_sort, "room_sort", diagnostics, ROOM_SORTS, "value_asc"),
    room_label: readEnum(userConfig.room_label, "room_label", diagnostics, ROOM_LABELS, "auto"),
    // null = "not configured", resolving to one auto entry per registered view; a
    // present array is authoritative even when empty.
    views,
    start_view: normalizeStartView(userConfig.start_view, viewTypes, diagnostics),
    classification,
    palette,
    rooms,
    range_entity: readOptionalEntity(userConfig.range_entity, "range_entity", diagnostics),
    trend_entity: readOptionalEntity(userConfig.trend_entity, "trend_entity", diagnostics),
  };
  diagnostics.push(...deprecationDiagnostics(userConfig, DEPRECATION_LEVEL));

  // Internal-only (underscore = not a YAML key): every value the normalizer replaced and
  // every foreign key, as diagnostics in the order the YAML writes them. The view model
  // shows them as warnings.
  return { ...normalized, _configDiagnostics: inWrittenOrder(diagnostics, userConfig) };
}

// The whole `setConfig()` contract, as one pure function. normalizeConfig() returns
// the normalized config or throws the error the user needs; a malformed views: entry
// or show: key records a diagnostic on _configDiagnostics instead, and the element
// decides when to surface it. Transaction semantics: interne Doku §3
// „setConfig() und YAML-Normalisierung".
//
// Injected collaborators, because config/ must not import the domain, i18n or view
// registries. This list is authoritative:
//   classificationZones   the accepted zone vocabulary
//   paletteForName        a palette by name, or the default for null
//   paletteForColor       a ramp derived from one named colour
//   paletteForGradient    a ramp derived from two or three colours joined by hyphens
//   paletteGradientLimit  how many colours such a palette may name, for the error message
//   paletteKeys           every word a palette option may be, for the error message
//   assertPalette         what makes a written-out palette usable
//   completePalette       fills a validated palette's missing wings
//   isSupportedLanguage   whether a language code has translations
//   optionSchemaForView   a view type's option schema, or undefined
//   viewTypes             every registered view type, for start_view
//   metricKindForUnit     a unit string -> metric kind
//   unitProfileForUnit    a metric kind + unit string -> unit profile

import { DEFAULT_CONFIG } from "./defaults.js";
import { normalizeAction } from "./actions.js";
import { normalizeRooms } from "./rooms.js";
import { normalizeViewsConfig } from "./views.js";
import { normalizeShowConfig, resolveShowConfig } from "./show.js";
import { unknownTopLevelKeys } from "./top-level-keys.js";
import { normalizeClassificationConfig } from "./classification/normalize.js";
import { normalizePalette } from "./classification/palette.js";
import {
  booleanOption,
  decimalsOverride,
  isPlainObject,
  optionalEntity,
  optionalLabel,
  optionalString,
  normalizeEnum,
  positiveInteger,
  positiveSeconds,
} from "./primitives.js";

// Optional language override; "auto" (the default for anything invalid or
// missing) keeps the automatic hass-based detection. Only a language that
// actually has a translation block is accepted, so an override can never
// silently select one that would just fall back to English anyway.
export function normalizeLanguage(value, isSupportedLanguage) {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "auto") return "auto";
  return isSupportedLanguage(normalized) ? normalized : "auto";
}

// The two older spellings of a `show:` decision, read WITHOUT a default of their own,
// so SHOW_SWITCHES stays the one place these defaults live. `show_rooms` speaks only
// for YAML's real booleans; `unavailable_values` only for the literal `hide`. Every
// other value means what the absent key means. See interne Doku §3 „Der show:-Block".
export function legacyShowRequests(userConfig) {
  const requests = {};
  if (userConfig.show_rooms === true) requests.rooms = true;
  if (userConfig.show_rooms === false) requests.rooms = false;
  if (userConfig.unavailable_values === "hide") requests.unavailable_rooms = false;
  return requests;
}

// Title and subtitle take one shape carrying both what the line says and how it
// behaves when too wide, in four spellings: `text`, a bare `clip`/`wrap` (overflow
// only), `""` (no line), or `{text, overflow}`. A bare `clip`/`wrap` is read as the
// overflow mode, so those two words cannot be the text — escape via `{text: wrap}`.
// Defaults differ and are measured from the stylesheet: title wraps, subtitle clips.
// Malformed values fall back. See interne Doku §3 „Konfigurationsvertrag" (Kopfzeilen).
export const HEADER_LINE_OVERFLOWS = ["clip", "wrap"];

export function normalizeHeaderLine(value, defaultOverflow) {
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (HEADER_LINE_OVERFLOWS.includes(word)) return { text: null, overflow: word };
    // optionalLabel() rather than optionalString(), because "" here means "show no line",
    // which is a real answer and not the same as "not configured".
    return { text: optionalLabel(value), overflow: defaultOverflow };
  }
  if (!isPlainObject(value)) return { text: null, overflow: defaultOverflow };
  return {
    text: optionalLabel(value.text),
    overflow: normalizeEnum(
      typeof value.overflow === "string" ? value.overflow.trim().toLowerCase() : value.overflow,
      HEADER_LINE_OVERFLOWS,
      defaultOverflow
    ),
  };
}

// Which view the card opens on. `null` and a name that is not a registered view type
// both mean "the first available one", the latter with a diagnostic. View types are
// injected, because config/ must not import the view registry.
export function normalizeStartView(value, viewTypes, diagnostics) {
  const requested = optionalString(value);
  if (requested === null || viewTypes.includes(requested)) return requested;
  diagnostics.push(
    `start_view: expected one of ${viewTypes.join(", ")}, got ${JSON.stringify(value)}, falling back to the first available view`
  );
  return null;
}

export function normalizeConfig(config, collaborators) {
  const { isSupportedLanguage, optionSchemaForView, viewTypes } = collaborators;
  const userConfig = config ?? {};
  if (!isPlainObject(userConfig)) {
    throw new Error("Invalid configuration: card configuration must be an object.");
  }

  // `entity` is OPTIONAL and normalized before the requirement below: absent/empty is
  // legitimate (rooms can carry the card), present-but-malformed is a hard path error.
  const entity = optionalEntity(userConfig.entity, null, "entity");

  // rooms is optional too; every entry is fully validated (unique, each with its own
  // entity) before the combined requirement is judged.
  const rooms = normalizeRooms(userConfig.rooms === undefined ? [] : userConfig.rooms);

  // THE requirement: a current-value source must exist. `range_entity`/`trend_entity`
  // describe a value rather than being one, so neither satisfies it.
  if (!entity && rooms.length === 0) {
    throw new Error(
      "Invalid configuration: at least one current-value source is required — set entity, or add at least one entry to rooms."
    );
  }

  // Optional daily-range/trend entities, as produced by a template sensor.
  const rangeEntity = optionalEntity(userConfig.range_entity, null, "range_entity");
  const trendEntity = optionalEntity(userConfig.trend_entity, null, "trend_entity");

  const { views, diagnostics: viewsDiagnostics } = normalizeViewsConfig(userConfig.views, { optionSchemaForView });
  const classification = normalizeClassificationConfig(userConfig.classification, collaborators);
  const palette = normalizePalette(userConfig.palette, collaborators);

  // WHICH PARTS THE CARD DRAWS, resolved here and nowhere else. The block wins WHERE IT
  // SPEAKS — per decision, not per block — over the two older top-level spellings, which
  // are on their way out (backlog, next major). Everything downstream sees `config.show`
  // only. See interne Doku §3 „Der show:-Block".
  const { show: requestedShow, diagnostics: showDiagnostics } = normalizeShowConfig(userConfig.show);
  const show = resolveShowConfig({ ...legacyShowRequests(userConfig), ...requestedShow });

  // Top-level options that fall back with a diagnostic. The three booleans use the same
  // reader as the `show:` block. Resolved before the returned object so the diagnostics
  // exist when the list below is built.
  const optionDiagnostics = [];
  const autoSlide = booleanOption(userConfig.auto_slide, "auto_slide", optionDiagnostics) ?? DEFAULT_CONFIG.auto_slide;
  const swipe = booleanOption(userConfig.swipe, "swipe", optionDiagnostics) ?? DEFAULT_CONFIG.swipe;
  const hideFooter = booleanOption(userConfig.hide_footer, "hide_footer", optionDiagnostics) ?? DEFAULT_CONFIG.hide_footer;
  const startView = normalizeStartView(userConfig.start_view, viewTypes, optionDiagnostics);

  return {
    entity,
    // Cosmetic/optional overrides fall back rather than throwing. entity_label uses
    // optionalLabel() so an explicit "" survives as "no caption" (see buildAverage()).
    entity_label: optionalLabel(userConfig.entity_label),
    // The two header lines; see normalizeHeaderLine() above.
    title: normalizeHeaderLine(userConfig.title, "wrap"),
    subtitle: normalizeHeaderLine(userConfig.subtitle, "clip"),
    icon: optionalString(userConfig.icon),
    // WHETHER each part is drawn; "" on the part's key and `show.<part>: false` are two
    // roads to the same absent node.
    show,
    decimals: decimalsOverride(userConfig.decimals),
    language: normalizeLanguage(userConfig.language, isSupportedLanguage),
    // The one global footer switch: turns every view's footer off at once. Backlog
    // removal at the next major, leaving per-view `show_footer` as the only spelling.
    hide_footer: hideFooter,
    rotation_seconds: positiveSeconds(userConfig.rotation_seconds, DEFAULT_CONFIG.rotation_seconds, 1, 3600),
    slide_seconds: positiveSeconds(userConfig.slide_seconds, DEFAULT_CONFIG.slide_seconds, 0.1, 10),
    hold_seconds: DEFAULT_CONFIG.hold_seconds,
    // Independent: auto_slide gates the automatic rotation timer, swipe gates the
    // manual drag gesture. Both default true.
    auto_slide: autoSlide,
    swipe,
    tap_action: normalizeAction(userConfig.tap_action, DEFAULT_CONFIG.tap_action),
    hold_action: normalizeAction(userConfig.hold_action, DEFAULT_CONFIG.hold_action),
    // Optional room-chip grid override; null means "decide automatically".
    room_columns: positiveInteger(userConfig.room_columns),
    room_rows: positiveInteger(userConfig.room_rows),
    // Presentation only: room_sort reorders the rendered chips, never the value-sorted
    // list calculations use; room_label picks between the short/name pair.
    room_sort: normalizeEnum(userConfig.room_sort, ["configured", "name", "value_asc", "value_desc"], "value_asc"),
    room_label: normalizeEnum(userConfig.room_label, ["auto", "short", "name"], "auto"),
    // null = "not configured", resolving to one auto entry per registered view; a
    // present array is authoritative even when empty. Invalid entries degrade to
    // "ignored" via the diagnostics below.
    views,
    // Internal-only (underscore = not a YAML key): the one channel carrying every
    // cosmetic fallback forward for the element to surface once per config change.
    // Unknown top-level keys first — read before any report about the keys that exist.
    _configDiagnostics: [...unknownTopLevelKeys(userConfig), ...optionDiagnostics, ...showDiagnostics, ...viewsDiagnostics],
    start_view: startView,
    classification,
    // The resolved palette object, not its name: resolving once here keeps the domain
    // registry out of the render path.
    palette,
    rooms,
    range_entity: rangeEntity,
    trend_entity: trendEntity,
  };
}

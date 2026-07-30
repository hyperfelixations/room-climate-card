// The whole `setConfig()` contract, as one pure function.
//
// normalizeConfig(userConfig, collaborators) either returns the normalized
// config or throws exactly the error the user needs to see. It has no `this`, no
// hass, no DOM and no console output: a malformed views: entry records a
// diagnostic string on the returned config (_viewsDiagnostics) and the caller
// decides when and how often to surface it. That separation is what lets the
// element deduplicate warnings per config change without the normalizer knowing
// anything about it.
//
// Injected collaborators, because the configuration layer must not import the
// domain, i18n or view registries:
//   classificationZones   the accepted zone vocabulary
//   isSupportedLanguage   whether a language code has translations
//   optionSchemaForView   a view type's option schema, or undefined
//   metricKindForUnit     a unit string -> metric kind
//   unitProfileForUnit    a metric kind + unit string -> unit profile

import { DEFAULT_CONFIG } from "./defaults.js";
import { normalizeAction } from "./actions.js";
import { normalizeRooms } from "./rooms.js";
import { normalizeViewsConfig } from "./views.js";
import { normalizeClassificationConfig } from "./classification/normalize.js";
import {
  decimalsOverride,
  isPlainObject,
  optionalEntity,
  optionalString,
  normalizeEnum,
  positiveInteger,
  positiveSeconds,
  requiredEntity,
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

export function normalizeConfig(config, collaborators) {
  const { isSupportedLanguage, optionSchemaForView } = collaborators;
  const userConfig = config ?? {};
  if (!isPlainObject(userConfig)) {
    throw new Error("Invalid configuration: card configuration must be an object.");
  }

  // entity (average value) is the only required config field.
  const entity = requiredEntity(userConfig.entity, "entity");

  // rooms is optional; below two valid room values the card stays in minimal
  // mode.
  const rooms = normalizeRooms(userConfig.rooms === undefined ? [] : userConfig.rooms);

  // Optional daily-range/trend entities, as produced by a template sensor.
  const rangeEntity = optionalEntity(userConfig.range_entity, null, "range_entity");
  const trendEntity = optionalEntity(userConfig.trend_entity, null, "trend_entity");

  const { views, diagnostics: viewsDiagnostics } = normalizeViewsConfig(userConfig.views, { optionSchemaForView });
  const classification = normalizeClassificationConfig(userConfig.classification, collaborators);

  return {
    entity,
    // Cosmetic/optional overrides: a malformed value falls back to the previous
    // default rather than throwing, so a typo in an optional field can't break
    // the whole card the way a bad entity id would.
    avg_label: optionalString(userConfig.avg_label),
    title: optionalString(userConfig.title),
    icon: optionalString(userConfig.icon),
    decimals: decimalsOverride(userConfig.decimals),
    language: normalizeLanguage(userConfig.language, isSupportedLanguage),
    hide_footer: userConfig.hide_footer === true,
    rotation_seconds: positiveSeconds(userConfig.rotation_seconds, DEFAULT_CONFIG.rotation_seconds, 1, 3600),
    slide_seconds: positiveSeconds(userConfig.slide_seconds, DEFAULT_CONFIG.slide_seconds, 0.1, 10),
    hold_seconds: DEFAULT_CONFIG.hold_seconds,
    // Independent of each other: auto_slide only gates the automatic rotation
    // timer, swipe only gates the manual horizontal drag gesture. Both default
    // true; either can be turned off without affecting the other.
    auto_slide: userConfig.auto_slide !== false,
    swipe: userConfig.swipe !== false,
    tap_action: normalizeAction(userConfig.tap_action, DEFAULT_CONFIG.tap_action),
    hold_action: normalizeAction(userConfig.hold_action, DEFAULT_CONFIG.hold_action),
    // Optional room-chip grid override; null means "decide automatically".
    room_columns: positiveInteger(userConfig.room_columns),
    room_rows: positiveInteger(userConfig.room_rows),
    // Purely presentation decisions: room_sort only reorders the rendered chips,
    // never the value-sorted list every calculation uses; room_label picks
    // between the existing short/name pair; show_rooms hides the chip grid only,
    // rooms stay full data sources either way.
    room_sort: normalizeEnum(userConfig.room_sort, ["configured", "name", "value_asc", "value_desc"], "value_asc"),
    room_label: normalizeEnum(userConfig.room_label, ["auto", "short", "name"], "auto"),
    show_rooms: userConfig.show_rooms !== false,
    // views: is the single public view-composition surface. null is the "not
    // configured at all" sentinel, which resolves to one auto entry per
    // registered view; a present-but-possibly-empty array is authoritative even
    // when empty. Unknown or duplicate view types are not rejected here — a YAML
    // typo degrades to "ignored" and is reported through the diagnostics below.
    views,
    // Internal-only field (the underscore signals "not a YAML key") carrying the
    // diagnostics forward to whoever is responsible for surfacing them once per
    // config change.
    _viewsDiagnostics: viewsDiagnostics,
    start_view: optionalString(userConfig.start_view),
    classification,
    rooms,
    range_entity: rangeEntity,
    trend_entity: trendEntity,
  };
}

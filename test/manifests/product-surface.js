"use strict";

// The product surface, written out by hand. Every list below is what the Room Climate Card
// is supposed to support, stated independently of the code — nothing here is imported from
// src/. A test iterating Object.keys(TRANSLATIONS) proves self-consistency, not that the
// card supports Ukrainian: a forgotten language leaves the expectation the moment it leaves
// the product. This file is the expectation; product-surface.test.js compares the two.
// Generic matrices import from here; a curated subset (narrow-width-overflow.spec.js picks
// five typographically extreme languages) stays local and says so.

// The fifteen languages the card ships translations for. English is the reference every
// other language is key-checked against.
const LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "uk", "ko", "ja", "zh", "nb", "sv", "lv"];
const DEFAULT_LANGUAGE = "en";

// The four things the card can measure, with the units each one accepts. `canonicalUnit`
// is the unit the card computes in; the others are converted on the way in.
const METRICS = {
  temperature: { deviceClass: "temperature", canonicalUnit: "°C", unitProfiles: ["celsius", "fahrenheit", "kelvin"] },
  humidity: { deviceClass: "humidity", canonicalUnit: "%", unitProfiles: ["percent"] },
  co2: { deviceClass: "carbon_dioxide", canonicalUnit: "ppm", unitProfiles: ["ppm"] },
  pm25: { deviceClass: "pm25", canonicalUnit: "µg/m³", unitProfiles: ["microgram_per_m3"] },
};
const METRIC_KINDS = Object.keys(METRICS);

// The views, in the order they appear on screen and therefore in the carousel. The order
// is part of the surface: it decides auto-slide direction and keyboard traversal.
const VIEWS = ["range", "range_scale", "scale", "extremes"];

// Every word that reaches a palette, aliases included. `protan-deutan`, `protan`, `deutan`
// and `tritan` all resolve to the one colour-vision palette.
const PALETTE_KEYS = ["pastel", "vivid", "color-vision", "protan-deutan", "protan", "deutan", "tritan", "signal"];
const SHIPPED_PALETTE_IDS = ["pastel", "vivid", "color-vision", "signal"];
const DEFAULT_PALETTE_ID = "pastel";

// The zones a classification can land in. `invalid` is not a point on the ramp — it is the
// absence of one.
const CLASSIFICATION_ZONES = ["optimal", "comfort", "outside", "invalid"];

// Public YAML shapes, independent of the normalizers: the generator consumes them and the
// architecture suite blocks a second complete copy.
const TOP_LEVEL_CONFIG_KEYS = [
  "entity", "rooms", "range_entity", "trend_entity", "classification", "palette",
  "title", "subtitle", "entity_label", "icon", "decimals", "language", "room_sort",
  "room_label", "show", "room_columns", "room_rows",
  "auto_slide", "swipe", "rotation_seconds", "slide_seconds",
  "tap_action", "hold_action", "views", "start_view",
  // Older spellings the card still accepts; each is outranked by its show: block entry and
  // listed for removal at the next major. hide_footer is the exception: not in the block
  // (the footer is a view's business) and the only way to turn every view's footer off at once.
  "show_rooms", "unavailable_values", "hide_footer",
];

// Which parts the card draws: all switches except `rooms`, whose default third answer (auto) is not a boolean.
const SHOW_KEYS = {
  accent_line: "bool",
  icon: "bool",
  title: "bool",
  subtitle: "bool",
  entity_label: "bool",
  pill: "bool",
  panel: "bool",
  rooms: ["auto", true, false],
  unavailable_rooms: "bool",
};
const ROOM_KEYS = ["entity", "name", "short", "tap_action", "hold_action"];
const VIEW_ENTRY_KEYS = ["type", "enabled", "options"];
const VIEW_OPTIONS = {
  range: { show_time: "bool" },
  range_scale: {
    show_comfort_band: "bool",
    show_optimal_band: "bool",
    show_footer: "bool",
    // Two questions, two keys: show_footer says whether, footer says which form. `false` is
    // the older spelling of show_footer: false and is still accepted.
    footer: ["compact", "detailed", false],
  },
  scale: { show_comfort_band: "bool", show_optimal_band: "bool", show_footer: "bool", footer: "bool", markers: ["average", "extremes", "all"] },
  extremes: { show_value: "bool" },
};
const ACTION_TYPES = ["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"];
const CUSTOM_CLASSIFICATION_KEYS = ["source", "unit", "comparison", "bands", "scale", "tiers", "valid_range", "icons"];

module.exports = {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  METRICS,
  METRIC_KINDS,
  VIEWS,
  PALETTE_KEYS,
  SHIPPED_PALETTE_IDS,
  DEFAULT_PALETTE_ID,
  CLASSIFICATION_ZONES,
  TOP_LEVEL_CONFIG_KEYS,
  SHOW_KEYS,
  ROOM_KEYS,
  VIEW_ENTRY_KEYS,
  VIEW_OPTIONS,
  ACTION_TYPES,
  CUSTOM_CLASSIFICATION_KEYS,
};

"use strict";

// THE PRODUCT SURFACE, WRITTEN OUT BY HAND.
//
// Every list below is what the Room Climate Card is supposed to support, stated
// independently of the code that supports it. Nothing here is imported from src/ — that is
// the entire point. A test that iterates `Object.keys(TRANSLATIONS)` proves that the card
// is self-consistent; it cannot prove that the card supports Ukrainian, because a
// forgotten language disappears from the expectation at the same moment it disappears from
// the product.
//
// So this file is the expectation, and product-surface.test.js is the one place the two
// are compared. Adding a language means changing exactly two things: the card, and this
// file. Before this existed the same fifteen codes were written out in six test files, and
// the git history shows what that costs — Ukrainian had to be chased through several
// commits, and one list (range-and-spread) was still at eleven languages afterwards.
//
// USING IT. Generic matrices — "do this in every language", "for each metric" — import
// from here. A CURATED subset does not: narrow-width-overflow.spec.js deliberately picks
// five typographically extreme languages, and widening it to fifteen would quadruple a
// slow browser spec to prove nothing new. Such a list stays local and says so.

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
};

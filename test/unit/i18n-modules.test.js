"use strict";

// Direct unit tests for src/i18n/* — the translation subsystem, tested
// without a card instance.
//
// These contracts are tested through their owning modules; key parity
// could only be observed by spying on console.warn during script load (see
// i18n.test.js, which keeps doing exactly that as an end-to-end check of the
// built artifact). These tests assert the same contracts against the modules
// themselves, where a failure names the actual function.
//
// TZ is pinned before anything constructs an Intl formatter: formatTimeOfDay()
// renders in local time, so an unpinned zone would make assertions
// machine-dependent. node:test runs each file in its own process.
process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");

const EXPECTED_LANGUAGES = ["en", "de", "nl", "fr", "it", "es", "ru", "pl", "ko", "ja", "zh", "nb", "sv", "lv"];

let locales;
let formatters;
let registry;
let integrity;
let translateModule;

test.before(async () => {
  locales = await import("../../src/i18n/locales.js");
  formatters = await import("../../src/i18n/formatters.js");
  registry = await import("../../src/i18n/registry.js");
  integrity = await import("../../src/i18n/integrity.js");
  translateModule = await import("../../src/i18n/translate.js");
});

// --------------------------------------------------------------- registry --

test("every supported language is registered, with English as the reference", () => {
  assert.equal(locales.DEFAULT_LANGUAGE, "en");
  assert.deepEqual(Object.keys(registry.TRANSLATIONS).sort(), [...EXPECTED_LANGUAGES].sort());
  assert.ok(registry.TRANSLATIONS.en, "the reference language must exist");
});

test("every registered language has an Intl locale", () => {
  for (const language of Object.keys(registry.TRANSLATIONS)) {
    assert.equal(
      typeof locales.NUMBER_LOCALE_BY_LANGUAGE[language],
      "string",
      `${language} has a translation block but no entry in NUMBER_LOCALE_BY_LANGUAGE`
    );
  }
  for (const language of Object.keys(locales.NUMBER_LOCALE_BY_LANGUAGE)) {
    assert.ok(
      registry.TRANSLATIONS[language],
      `${language} has an Intl locale but no translation block`
    );
  }
});

test("every language carries exactly the reference key set", () => {
  const reference = Object.keys(registry.TRANSLATIONS.en).sort();
  assert.ok(reference.length > 50, `sanity: expected a substantial key set, got ${reference.length}`);
  for (const [language, block] of Object.entries(registry.TRANSLATIONS)) {
    assert.deepEqual(Object.keys(block).sort(), reference, `language "${language}"`);
  }
});

test("a value is always either a string or a function of the interpolation vars", () => {
  for (const [language, block] of Object.entries(registry.TRANSLATIONS)) {
    for (const [key, value] of Object.entries(block)) {
      const type = typeof value;
      assert.ok(type === "string" || type === "function", `${language}/${key} is ${type}`);
    }
  }
});

test("a key that is a function in the reference language is a function everywhere", () => {
  // A language that hardcodes a plural form as a plain string would silently
  // drop its interpolated variables.
  for (const [key, referenceValue] of Object.entries(registry.TRANSLATIONS.en)) {
    for (const [language, block] of Object.entries(registry.TRANSLATIONS)) {
      assert.equal(
        typeof block[key],
        typeof referenceValue,
        `${language}/${key}: expected ${typeof referenceValue}, got ${typeof block[key]}`
      );
    }
  }
});

// -------------------------------------------------------------- integrity --

test("the key-parity check stays silent for a consistent table", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    integrity.verifyTranslationKeyParity({ en: { a: "1", b: "2" }, de: { a: "1", b: "2" } }, "en");
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

test("the key-parity check names both missing and extra keys", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    integrity.verifyTranslationKeyParity(
      { en: { a: "1", b: "2" }, de: { a: "1", c: "3" } },
      "en"
    );
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /TRANSLATIONS\["de"\] is out of sync with "en"/);
  assert.match(warnings[0], /missing: b/);
  assert.match(warnings[0], /extra: c/);
});

test("the real registry passes its own parity check", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    integrity.verifyTranslationKeyParity(registry.TRANSLATIONS, locales.DEFAULT_LANGUAGE);
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, [], `shipped translations must be in sync:\n${warnings.join("\n")}`);
});

// -------------------------------------------------------------- translate --

test("translate() resolves plain and function-valued keys", () => {
  const { translate } = translateModule;
  assert.equal(translate("en", "avg.label"), "Home avg.");
  assert.equal(translate("de", "avg.label"), "Ø Wohnung");
  assert.equal(
    translate("en", "footer.spread", { value: "2.0 °C" }),
    "Spread 2.0 °C",
    "function values receive the interpolation vars"
  );
});

test("translate() falls back to English, then to the key itself", () => {
  const { translate } = translateModule;
  assert.equal(
    translate("xx", "avg.label"),
    "Home avg.",
    "an unregistered language falls back to the reference language"
  );
  assert.equal(
    translate("de", "this.key.does.not.exist"),
    "this.key.does.not.exist",
    "an unknown key returns itself rather than undefined"
  );
});

test("translate() tolerates a function value called without vars", () => {
  const { translate } = translateModule;
  const result = translate("en", "footer.spread");
  assert.equal(typeof result, "string");
  assert.doesNotThrow(() => translate("en", "subtitle.aboveComfort"));
});

test("isSupportedLanguage() only accepts languages that have their own block", () => {
  const { isSupportedLanguage } = translateModule;
  for (const language of EXPECTED_LANGUAGES) assert.equal(isSupportedLanguage(language), true, language);
  for (const other of ["xx", "EN", "de-AT", "", "toString", "constructor"]) {
    assert.equal(isSupportedLanguage(other), false, JSON.stringify(other));
  }
});

test("resolveLanguage() prefers an explicit config override", () => {
  const { resolveLanguage } = translateModule;
  const hass = { locale: { language: "de" }, language: "de" };
  assert.equal(resolveLanguage("fr", hass), "fr");
  assert.equal(resolveLanguage("auto", hass), "de", '"auto" defers to Home Assistant');
  assert.equal(resolveLanguage(null, hass), "de");
  assert.equal(resolveLanguage(undefined, hass), "de");
});

test("resolveLanguage() reads Home Assistant's settings in priority order", () => {
  const { resolveLanguage } = translateModule;
  assert.equal(
    resolveLanguage(null, { locale: { language: "it" }, language: "de", selectedLanguage: "fr" }),
    "it",
    "locale.language is the most granular, explicitly user-selectable setting"
  );
  assert.equal(resolveLanguage(null, { language: "de", selectedLanguage: "fr" }), "de");
  assert.equal(resolveLanguage(null, { selectedLanguage: "fr" }), "fr");
});

test("resolveLanguage() reduces a regional locale to its base language", () => {
  const { resolveLanguage } = translateModule;
  for (const [locale, expected] of [["de-AT", "de"], ["es-MX", "es"], ["ZH-Hans", "zh"], ["nb-NO", "nb"]]) {
    assert.equal(resolveLanguage(null, { locale: { language: locale } }), expected, locale);
  }
});

test("resolveLanguage() falls back to English for anything unusable", () => {
  const { resolveLanguage } = translateModule;
  assert.equal(resolveLanguage(null, { locale: { language: "xx-YY" } }), "en");
  assert.equal(resolveLanguage(null, {}), "en");
  assert.equal(resolveLanguage(null, null), "en");
  assert.equal(resolveLanguage(null, undefined), "en");
});

// ------------------------------------------------------------- formatters --

test("formatNumber() follows each language's own decimal and group separators", () => {
  const { formatNumber } = formatters;
  assert.equal(formatNumber("en", 1234.5, 1), "1,234.5");
  assert.equal(formatNumber("de", 1234.5, 1), "1.234,5");
  assert.equal(formatNumber("es", 1234.5, 1), "1234,5");
  assert.equal(formatNumber("ru", 1234.5, 1), "1 234,5");
});

test("formatNumber() honours the requested digit count exactly", () => {
  const { formatNumber } = formatters;
  assert.equal(formatNumber("en", 21, 0), "21");
  assert.equal(formatNumber("en", 21, 1), "21.0", "trailing zeros are kept");
  assert.equal(formatNumber("en", 21.456, 2), "21.46", "rounds, never truncates");
  assert.equal(formatNumber("en", "21.5", 1), "21.5", "numeric strings are coerced");
});

test("formatTimeOfDay() renders 24-hour local time and rejects unusable input", () => {
  const { formatTimeOfDay } = formatters;
  // TZ is pinned to UTC above, so the rendered time equals the ISO time.
  assert.equal(formatTimeOfDay("en", "2026-07-24T06:12:00Z"), "06:12");
  assert.equal(formatTimeOfDay("de", "2026-07-24T18:41:00Z"), "18:41", "never 6:41 PM");
  assert.equal(formatTimeOfDay("en", "not a timestamp"), null);
  assert.equal(formatTimeOfDay("en", ""), null);
  assert.equal(formatTimeOfDay("en", "   "), null);
  assert.equal(formatTimeOfDay("en", null), null);
  assert.equal(formatTimeOfDay("en", 1750000000000), null, "a raw epoch is not an ISO string");
});

test("getPluralCategory() reports the real CLDR categories for complex languages", () => {
  const { getPluralCategory } = formatters;
  assert.equal(getPluralCategory("ru", 1), "one");
  assert.equal(getPluralCategory("ru", 2), "few");
  assert.equal(getPluralCategory("ru", 5), "many");
  assert.equal(getPluralCategory("ru", 21), "one", "21 governs a singular noun in Russian");
  assert.equal(getPluralCategory("pl", 2), "few");
  assert.equal(getPluralCategory("pl", 5), "many");
  assert.equal(getPluralCategory("lv", 0), "zero");
  assert.equal(getPluralCategory("lv", 11), "zero");
  assert.equal(getPluralCategory("lv", 21), "one");
  assert.equal(getPluralCategory("en", 1), "one");
  assert.equal(getPluralCategory("en", 2), "other");
});

test("selectPlural() picks the matching form and falls back to `other`", () => {
  const { selectPlural } = formatters;
  const forms = { one: "komnata", few: "komnaty", many: "komnat", other: "komnaty" };
  assert.equal(selectPlural("ru", 1, forms), "komnata");
  assert.equal(selectPlural("ru", 2, forms), "komnaty");
  assert.equal(selectPlural("ru", 5, forms), "komnat");
  assert.equal(
    selectPlural("lv", 0, { one: "telpa", other: "telpas" }),
    "telpas",
    "a missing category falls back to `other` instead of undefined"
  );
});

test("the Intl formatters are cached, not rebuilt per call", () => {
  const { getNumberFormat, getTimeFormat } = formatters;
  assert.equal(getNumberFormat("en-US", 1), getNumberFormat("en-US", 1), "same locale+digits reuses one instance");
  assert.notEqual(getNumberFormat("en-US", 1), getNumberFormat("en-US", 2), "digits are part of the cache key");
  assert.notEqual(getNumberFormat("en-US", 1), getNumberFormat("de-DE", 1), "locale is part of the cache key");
  assert.equal(getTimeFormat("en-US"), getTimeFormat("en-US"));
});

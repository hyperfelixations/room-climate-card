"use strict";

// Direct unit tests for src/i18n/* — the translation subsystem, tested without a card
// instance, where a failure names the actual function. Boundary: the built-artifact
// end-to-end check that spies on console.warn during script load is i18n.test.js.
// TZ is pinned to UTC before any Intl formatter is built, since formatTimeOfDay() renders
// in local time; node:test runs each file in its own process.
process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");

// From the manifest. The manifest-vs-registry comparison is product-surface.test.js's job;
// this file asks the translation modules about each language in turn.
const { LANGUAGES: EXPECTED_LANGUAGES } = require("../../manifests/product-surface.js");

let locales;
let formatters;
let registry;
let integrity;
let translateModule;

test.before(async () => {
  locales = await import("../../../src/i18n/locales.js");
  formatters = await import("../../../src/i18n/formatters.js");
  registry = await import("../../../src/i18n/registry.js");
  integrity = await import("../../../src/i18n/integrity.js");
  translateModule = await import("../../../src/i18n/translate.js");
});

// --------------------------------------------------------------- registry --

// This module's own business: the reference language it key-checks everything else against
// exists.
test("the reference language exists and is the default", () => {
  assert.equal(locales.DEFAULT_LANGUAGE, "en");
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
  // A language that hardcodes a plural form as a plain string would drop its interpolated
  // variables.
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

// The variable contract of every function-valued translation, with a representative value.
// A translation that reads a name missing here, or a name here that no translation reads,
// fails by that name. See internal dev doc §6 "i18n und sprachabhängige Formatierung".
const INTERPOLATION_VARS = Object.freeze({
  label: "Test label",
  value: "22.0 °C",
  diff: "2.0 °C",
  count: 2,
  entities: "sensor.one, sensor.two",
  entity: "sensor.one",
  total: 4,
  adjective: "test adjective",
  name: "Test room",
  direction: "rising",
  range: "20–24 °C",
  span: "5.0 °C",
  min: "18.0 °C",
  minTime: "06:00",
  max: "23.0 °C",
  maxTime: "15:00",
  time: "06:00",
  key: "show.rooms",
  instead: "Using the defaults.",
});

test("every function-valued translation reads exactly the documented variables, in every language", () => {
  const reference = registry.TRANSLATIONS.en;
  const functionKeys = Object.keys(reference).filter((key) => typeof reference[key] === "function");
  assert.ok(functionKeys.length > 0, "the reference language has function-valued keys");
  const readAnywhere = new Set();
  for (const language of Object.keys(registry.TRANSLATIONS)) {
    for (const key of functionKeys) {
      const missing = new Set();
      const vars = new Proxy(INTERPOLATION_VARS, {
        get(target, property, receiver) {
          if (typeof property === "string") {
            readAnywhere.add(property);
            if (!Object.hasOwn(target, property)) missing.add(property);
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const text = translateModule.translate(language, key, vars);
      const where = `${language}/${key}`;
      assert.deepEqual([...missing], [], `${where} reads variables the contract does not supply`);
      assert.equal(typeof text, "string", `${where} must return a string`);
      assert.ok(text.length > 0, `${where} must not be empty`);
      assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, `${where}: every variable must resolve`);
    }
  }
  const unread = Object.keys(INTERPOLATION_VARS).filter((name) => !readAnywhere.has(name));
  assert.deepEqual(unread, [], "the contract names variables no translation reads");
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
  assert.equal(translate("en", "value.homeAverage"), "Home avg.");
  assert.equal(translate("de", "value.homeAverage"), "Ø Wohnung");
  assert.equal(
    translate("en", "footer.spread", { value: "2.0 °C" }),
    "Spread 2.0 °C",
    "function values receive the interpolation vars"
  );
});

test("translate() falls back to English, then to the key itself", () => {
  const { translate } = translateModule;
  assert.equal(
    translate("xx", "value.homeAverage"),
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

test("formatNumber() never prints a negative zero", () => {
  const { formatNumber } = formatters;
  // Math.round(-0.4) is -0, and Intl renders that as "-0". Nothing the card displays may
  // read as a signed nothing, whatever produced the value.
  assert.equal(formatNumber("en", -0, 0), "0");
  assert.equal(formatNumber("de", -0, 1), "0,0");
  assert.equal(formatNumber("en", Math.round(-0.4), 0), "0", "the projection rounds -0.4 °F to -0");
  // A value that is genuinely below zero keeps its sign; only the signless -0 is normalized.
  assert.equal(formatNumber("en", -0.4, 1), "-0.4");
});

test("formatNumber() can force an explicit sign on positive values", () => {
  const { formatNumber } = formatters;
  assert.equal(formatNumber("en", 4, 0, "exceptZero"), "+4");
  assert.equal(formatNumber("en", -5, 0, "exceptZero"), "-5");
  assert.equal(formatNumber("en", 0, 0, "exceptZero"), "0", "zero stays unsigned");
  assert.equal(formatNumber("en", -0, 0, "exceptZero"), "0");
  assert.equal(formatNumber("de", 4, 0, "exceptZero"), "+4");
  assert.equal(formatNumber("en", 4, 0), "4", "the default keeps the plain form");
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

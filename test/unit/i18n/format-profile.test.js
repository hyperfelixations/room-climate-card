"use strict";

// The number, time and time-zone format: resolveFormatProfile() against Home Assistant's own
// rules (frontend numberFormatToLocale(), useAmPm(), resolveTimeZone()) and the card's options
// over them. See internal dev doc §5 "Profilformate". Boundary: how the card reads the options
// and re-renders on a change is config-normalize-modules.test.js's and format-profile-change.test.js's.
process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LANGUAGES } = require("../../manifests/product-surface.js");

let profiles;
let formatters;
let locales;

test.before(async () => {
  profiles = await import("../../../src/i18n/format-profile.js");
  formatters = await import("../../../src/i18n/formatters.js");
  locales = await import("../../../src/i18n/locales.js");
});

const hassWith = (locale, timeZone) => ({ language: locale.language, locale, config: timeZone === undefined ? {} : { time_zone: timeZone } });
const resolve = (hass, card = {}) =>
  profiles.resolveFormatProfile({ language: card.language ?? "en", configLanguage: card.configLanguage ?? "auto", ...card.options }, hass);
const AT_0612 = "2026-07-24T06:12:00Z";
const AT_1841 = "2026-07-24T18:41:00Z";

// ------------------------------------------------------------ vocabularies --

// Which values they are is product-surface.test.js's to pin.
test("the vocabularies cannot be changed at run time", () => {
  for (const list of [profiles.NUMBER_FORMATS, profiles.TIME_FORMATS, profiles.TIME_ZONES]) assert.ok(Object.isFrozen(list));
});

// ------------------------------------------------------------------ numbers --

test("each profile number format writes the separators Home Assistant writes", () => {
  const cases = {
    language: "1,234.5",
    comma_decimal: "1,234.5",
    decimal_comma: "1.234,5",
    space_comma: "1 234,5",
    // ICU writes the Swiss group mark as ' (Node) or ’ (some browsers).
    quote_decimal: /^1['’]234\.5$/,
    none: "1234.5",
  };
  for (const [numberFormat, expected] of Object.entries(cases)) {
    const profile = resolve(hassWith({ language: "en", number_format: numberFormat }));
    const written = formatters.formatNumber(profile, 1234.5, 1).replace(/\s/g, " ");
    if (expected instanceof RegExp) assert.match(written, expected, numberFormat);
    else assert.equal(written, expected, numberFormat);
  }
  const system = resolve(hassWith({ language: "de", number_format: "system" }));
  assert.equal(system.numberLocale, undefined, "system: the runtime's own locale");
  assert.equal(formatters.formatNumber(system, 1234.5, 1), new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5));
});

test("number_format: none drops grouping in every form, the compact one included", () => {
  const profile = resolve(hassWith({ language: "de", number_format: "none" }));
  assert.equal(formatters.formatNumber(profile, -12345.25, 2, "exceptZero"), "-12345.25");
  assert.equal(formatters.formatBoundary(profile, 12345, 1), "12345");
  assert.equal(formatters.formatCompact(profile, 3435), "3.4K");
});

test("profile value `language` writes numbers in Home Assistant's full language tag", () => {
  assert.match(formatters.formatNumber(resolve(hassWith({ language: "de-CH", number_format: "language" }), { language: "de" }), 1234.5, 1), /^1['’]234\.5$/);
  assert.equal(formatters.formatNumber(resolve(hassWith({ language: "pt-BR" })), 1234.5, 1), "1.234,5", "a language the card has no words for still sets the numbers");
  assert.equal(formatters.formatNumber(resolve(hassWith({ language: "not a tag!" })), 1234.5, 1), "1,234.5", "an unusable tag falls back to the card language");
});

test("missing or unknown profile values read as Home Assistant's default, `language`", () => {
  for (const locale of [{ language: "de" }, { language: "de", number_format: "bogus", time_format: 7, time_zone: "moon" }]) {
    const profile = resolve(hassWith(locale), { language: "de" });
    assert.equal(formatters.formatNumber(profile, 1234.5, 1), "1.234,5");
    assert.equal(formatters.formatTimeOfDay(profile, AT_1841), "18:41");
    assert.equal(profile.timeZone, undefined);
  }
  assert.equal(formatters.formatNumber(resolve(undefined), 1234.5, 1), "1,234.5", "no hass at all: the card language");
});

// -------------------------------------------------------------------- times --

test("each profile time format picks the clock Home Assistant picks", () => {
  const at = (locale, card) => formatters.formatTimeOfDay(resolve(hassWith(locale), card), AT_1841);
  assert.equal(at({ language: "en", time_format: "language" }), "6:41 PM");
  assert.equal(at({ language: "en-GB", time_format: "language" }), "18:41");
  assert.equal(at({ language: "de", time_format: "12" }, { language: "de" }), "6:41 PM");
  assert.equal(at({ language: "en", time_format: "24" }), "18:41");
  assert.equal(at({ language: "ko", time_format: "language" }, { language: "ko" }), "오후 6:41");
});

test("a 24-hour clock writes two-digit hours in every language", () => {
  const twoDigit = (tag) => new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hour12: false });
  for (const language of LANGUAGES) {
    const profile = resolve(hassWith({ language, time_format: "24" }), { language });
    for (const iso of [AT_0612, AT_1841, "2026-07-24T00:05:00Z"]) {
      assert.equal(formatters.formatTimeOfDay(profile, iso), twoDigit(locales.NUMBER_LOCALE_BY_LANGUAGE[language]).format(new Date(iso)), `${language} ${iso}`);
    }
  }
});

// Home Assistant's useAmPm(): 22:00 printed by toLocaleString() contains "10" on a 12-hour clock.
test("`language` and `system` agree with Home Assistant's 12-hour probe", () => {
  const usesAmPm = (tag) => new Date("January 1, 2023 22:00:00").toLocaleString(tag).includes("10");
  for (const tag of [...LANGUAGES, "en-GB", "en-US", "en-AU", "de-CH", "pt-BR", "zh-Hans", "zh-Hant"]) {
    const profile = resolve(hassWith({ language: tag, time_format: "language" }));
    assert.equal(profile.hourCycle, usesAmPm(tag) ? "h12" : "h23", tag);
  }
  const system = resolve(hassWith({ language: "de", time_format: "system" }), { language: "de" });
  assert.equal(system.hourCycle, usesAmPm(undefined) ? "h12" : "h23");
  assert.equal(system.timeLocale, "de", "the clock follows the system; the words around it stay the language's");
});

test("time_zone: server uses the Home Assistant zone, local and anything unusable the runtime's", () => {
  const at = (locale, zone, card) => formatters.formatTimeOfDay(resolve(hassWith({ language: "de", ...locale }, zone), { language: "de", ...card }), AT_0612);
  assert.equal(at({ time_zone: "server" }, "America/New_York"), "02:12");
  assert.equal(at({ time_zone: "local" }, "America/New_York"), "06:12");
  assert.equal(at({ time_zone: "server" }, "Not/A_Zone"), "06:12", "a zone Intl refuses");
  assert.equal(at({ time_zone: "server" }, undefined), "06:12", "no server zone known");
});

// ------------------------------------------------------- card over profile --

test("a card option other than auto overrides the profile value", () => {
  const hass = hassWith({ language: "en", number_format: "comma_decimal", time_format: "12", time_zone: "local" }, "Asia/Tokyo");
  const profile = resolve(hass, { options: { numberFormat: "decimal_comma", timeFormat: "24", timeZone: "server" } });
  assert.equal(formatters.formatNumber(profile, 1234.5, 1), "1.234,5");
  assert.equal(formatters.formatTimeOfDay(profile, AT_0612), "15:12");
  const auto = resolve(hass, { options: { numberFormat: "auto", timeFormat: "auto", timeZone: "auto" } });
  assert.equal(formatters.formatNumber(auto, 1234.5, 1), "1,234.5");
  assert.equal(formatters.formatTimeOfDay(auto, AT_0612), "6:12 AM");
});

test("with `language` set on the card, profile value `language` means the card language", () => {
  const hass = hassWith({ language: "en", number_format: "language", time_format: "language" });
  const german = resolve(hass, { language: "de", configLanguage: "de" });
  assert.equal(formatters.formatNumber(german, 1234.5, 1), "1.234,5");
  assert.equal(formatters.formatTimeOfDay(german, AT_1841), "18:41");
  const explicit = resolve(hassWith({ language: "en", number_format: "comma_decimal", time_format: "12" }), { language: "de", configLanguage: "de" });
  assert.equal(formatters.formatNumber(explicit, 1234.5, 1), "1,234.5", "an explicit profile value still applies");
  assert.equal(formatters.formatTimeOfDay(explicit, AT_1841), "6:41 PM");
});

// ------------------------------------------------------------------ the key --

test("the key changes exactly when the written output can change", () => {
  const key = (locale, zone, card) => resolve(hassWith(locale, zone), card).key;
  const base = key({ language: "en" });
  assert.equal(key({ language: "en", number_format: "language", time_format: "language", time_zone: "local" }), base);
  assert.equal(key({ language: "en" }, "Europe/Berlin"), base, "a server zone nobody asked for");
  assert.notEqual(key({ language: "en", number_format: "decimal_comma" }), base);
  assert.notEqual(key({ language: "en", number_format: "none" }), key({ language: "en", number_format: "comma_decimal" }));
  assert.notEqual(key({ language: "en", time_format: "24" }), base);
  assert.notEqual(key({ language: "en", time_zone: "server" }, "Europe/Berlin"), base);
  assert.notEqual(key({ language: "en-GB" }), base);
  const profile = resolve(hassWith({ language: "en" }));
  assert.ok(Object.isFrozen(profile));
});

// Language codes and their Intl locales.
//
// Separate from registry.js on purpose: the language files themselves need the
// plural helpers in formatters.js, and formatters.js needs these locale
// mappings. Keeping the mappings here breaks what would otherwise be a cycle
// (languages -> formatters -> registry -> languages).

// Card default, and the fallback for any key a translation is missing.
export const DEFAULT_LANGUAGE = "en";

// Base language code -> an Intl-compatible locale, used for number, time and
// plural-rule formatting. A new language needs an entry here as well as its
// own file under languages/.
export const NUMBER_LOCALE_BY_LANGUAGE = {
  de: "de-DE",
  en: "en-US",
  nl: "nl-NL",
  fr: "fr-FR",
  it: "it-IT",
  es: "es",
  ru: "ru",
  pl: "pl",
  uk: "uk",
  ko: "ko",
  ja: "ja",
  zh: "zh",
  nb: "nb-NO",
  sv: "sv-SE",
  lv: "lv-LV",
};

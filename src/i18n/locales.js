// Language codes and their Intl locales. Separate from registry.js to break the
// cycle languages -> formatters -> registry -> languages (formatters.js needs
// these mappings; the language files need formatters.js).

// Card default, and the fallback for any key a translation is missing.
export const DEFAULT_LANGUAGE = "en";

// Base language code -> an Intl-compatible locale, for number, time and
// plural-rule formatting. A new language needs an entry here and a file under
// languages/ (see internal dev doc §6 "Neue Sprache").
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

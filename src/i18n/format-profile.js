// How numbers, times of day and their time zone are written: the Home Assistant profile
// (hass.locale) as the frontend applies it — numberFormatToLocale(), useAmPm(),
// resolveTimeZone() — and the card's `number_format`, `time_format` and `time_zone` over it.
// Plural rules stay with the card language. See internal dev doc §5 "Profilformate".

import { NUMBER_LOCALE_BY_LANGUAGE } from "./locales.js";

// Home Assistant's own values; the card options take these plus "auto".
export const NUMBER_FORMATS = Object.freeze(["language", "system", "comma_decimal", "decimal_comma", "quote_decimal", "space_comma", "none"]);
export const TIME_FORMATS = Object.freeze(["language", "system", "12", "24"]);
export const TIME_ZONES = Object.freeze(["local", "server"]);

// The frontend's locale lists, fallbacks included; "none" is en-US without grouping.
const NUMBER_LOCALES = {
  comma_decimal: ["en-US", "en"],
  decimal_comma: ["de", "es", "it"],
  space_comma: ["fr", "sv", "cs"],
  quote_decimal: ["de-CH"],
  none: "en-US",
};

const HOUR_CYCLE_CACHE = new Map();

// The card option unless "auto", else the profile value, else Home Assistant's default.
function choose(option, profileValue, allowed, fallback) {
  if (option && option !== "auto") return option;
  return allowed.includes(profileValue) ? profileValue : fallback;
}

// A language set on the card is written in its own locale; otherwise Home Assistant's full tag
// ("de-CH", "pt-BR"), as long as Intl accepts it.
function languageTag(language, configLanguage, hass) {
  const card = NUMBER_LOCALE_BY_LANGUAGE[language];
  if (configLanguage && configLanguage !== "auto") return card;
  const raw = hass?.locale?.language || hass?.language || hass?.selectedLanguage;
  if (typeof raw !== "string" || !raw.trim()) return card;
  try {
    return Intl.getCanonicalLocales(raw.trim())[0] ?? card;
  } catch {
    return card;
  }
}

// useAmPm(): "language" and "system" ask the locale (undefined: the runtime's) for its clock.
function hourCycleOf(timeFormat, tag) {
  if (timeFormat === "12") return "h12";
  if (timeFormat === "24") return "h23";
  const probeTag = timeFormat === "language" ? tag : undefined;
  if (!HOUR_CYCLE_CACHE.has(probeTag)) {
    const probed = new Intl.DateTimeFormat(probeTag, { hour: "numeric" }).resolvedOptions().hourCycle;
    HOUR_CYCLE_CACHE.set(probeTag, probed === "h11" || probed === "h12" ? "h12" : "h23");
  }
  return HOUR_CYCLE_CACHE.get(probeTag);
}

// "server" is Home Assistant's configured zone when Intl knows it; undefined is the runtime's.
function timeZoneOf(choice, hass) {
  const zone = hass?.config?.time_zone;
  if (choice !== "server" || typeof zone !== "string" || !zone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

// `key` names everything the written output depends on: equal keys write equal text.
export function resolveFormatProfile({ language, configLanguage, numberFormat, timeFormat, timeZone }, hass) {
  const tag = languageTag(language, configLanguage, hass);
  const locale = hass?.locale;
  const numbers = choose(numberFormat, locale?.number_format, NUMBER_FORMATS, "language");
  const clock = choose(timeFormat, locale?.time_format, TIME_FORMATS, "language");
  const zone = choose(timeZone, locale?.time_zone, TIME_ZONES, "local");

  const numberLocale = numbers === "language" ? tag : numbers === "system" ? undefined : NUMBER_LOCALES[numbers];
  const grouping = numbers !== "none";
  const hourCycle = hourCycleOf(clock, tag);
  const resolvedZone = timeZoneOf(zone, hass);
  return Object.freeze({
    numberLocale,
    grouping,
    timeLocale: tag,
    hourCycle,
    timeZone: resolvedZone,
    key: JSON.stringify([numberLocale ?? null, grouping, tag, hourCycle, resolvedZone ?? null]),
  });
}

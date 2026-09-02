// Locale-aware formatting, plus the plural helpers the language files use. One Intl
// formatter is cached per locale/digits combination: a multi-room render formats a
// dozen-plus numbers, and a fresh Intl instance per call would be built each time.

import { NUMBER_LOCALE_BY_LANGUAGE } from "./locales.js";

const NUMBER_FORMAT_CACHE = new Map();
const TIME_FORMAT_CACHE = new Map();
const PLURAL_RULES_CACHE = new Map();

export function getNumberFormat(locale, digits) {
  const key = `${locale}|${digits}`;
  let fmt = NUMBER_FORMAT_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    NUMBER_FORMAT_CACHE.set(key, fmt);
  }
  return fmt;
}

export function getTimeFormat(locale) {
  let fmt = TIME_FORMAT_CACHE.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    TIME_FORMAT_CACHE.set(locale, fmt);
  }
  return fmt;
}

// Languages with more than two plural categories (Russian, Polish, Latvian)
// use these instead of hand-written one-vs-other rules.
export function getPluralCategory(language, count) {
  let rules = PLURAL_RULES_CACHE.get(language);
  if (!rules) {
    rules = new Intl.PluralRules(NUMBER_LOCALE_BY_LANGUAGE[language] || language);
    PLURAL_RULES_CACHE.set(language, rules);
  }
  return rules.select(Number(count));
}

export function selectPlural(language, count, forms) {
  return forms[getPluralCategory(language, count)] ?? forms.other;
}

// Formats a number in the given language. The digit count is decided by the
// caller (config override, then the metric's own default), because that is a
// presentation decision this module has no way to resolve.
export function formatNumber(language, value, digits) {
  return getNumberFormat(NUMBER_LOCALE_BY_LANGUAGE[language], digits).format(Number(value));
}

// Formats an ISO timestamp as local "HH:MM" (hour12:false keeps this
// consistent across languages); null for a missing/invalid timestamp.
export function formatTimeOfDay(language, isoString) {
  if (typeof isoString !== "string" || !isoString.trim()) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return getTimeFormat(NUMBER_LOCALE_BY_LANGUAGE[language]).format(date);
}

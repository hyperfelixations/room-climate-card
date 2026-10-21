// Locale-aware formatting, plus the plural helpers the language files use. One Intl
// formatter is cached per locale and option combination: a multi-room render formats a
// dozen-plus numbers, and a fresh Intl instance per call would be built each time.

import { withoutNegativeZero } from "../core/numbers.js";
import { NUMBER_LOCALE_BY_LANGUAGE } from "./locales.js";

const NUMBER_FORMAT_CACHE = new Map();
const TIME_FORMAT_CACHE = new Map();
const PLURAL_RULES_CACHE = new Map();

export function getNumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, signDisplay = "auto", notation = "standard" }) {
  const key = `${locale}|${minimumFractionDigits}|${maximumFractionDigits}|${signDisplay}|${notation}`;
  let fmt = NUMBER_FORMAT_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, signDisplay, notation });
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
// presentation decision this module has no way to resolve. `signDisplay` follows
// Intl; "exceptZero" is what a signed band range uses to mark its positive bound.
export function formatNumber(language, value, digits, signDisplay) {
  return format(language, value, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay });
}

// A band or axis boundary: up to `maxDigits` decimals, without trailing zeros, so a boundary
// reads exactly as it applies. See internal dev doc §5 "Grenzbeschriftungen".
export function formatBoundary(language, value, maxDigits, signDisplay) {
  return format(language, value, { minimumFractionDigits: 0, maximumFractionDigits: maxDigits, signDisplay });
}

// The language's short scale ("3.4K", "1 Mio."): the form a label falls back to when the
// full number does not fit.
export function formatCompact(language, value, signDisplay) {
  return format(language, value, { minimumFractionDigits: 0, maximumFractionDigits: 1, signDisplay, notation: "compact" });
}

function format(language, value, options) {
  const number = withoutNegativeZero(Number(value));
  return getNumberFormat(NUMBER_LOCALE_BY_LANGUAGE[language], options).format(number);
}

// Formats an ISO timestamp as local "HH:MM" (hour12:false keeps this
// consistent across languages); null for a missing/invalid timestamp.
export function formatTimeOfDay(language, isoString) {
  if (typeof isoString !== "string" || !isoString.trim()) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return getTimeFormat(NUMBER_LOCALE_BY_LANGUAGE[language]).format(date);
}

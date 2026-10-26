// Locale-aware formatting, plus the plural helpers the language files use. Numbers and times
// are written by a format profile (format-profile.js); plurals by the card language. One Intl
// formatter is cached per locale and option combination: a multi-room render formats a
// dozen-plus numbers, and a fresh Intl instance per call would be built each time.

import { withoutNegativeZero } from "../core/numbers.js";
import { NUMBER_LOCALE_BY_LANGUAGE } from "./locales.js";

const NUMBER_FORMAT_CACHE = new Map();
const TIME_FORMAT_CACHE = new Map();
const PLURAL_RULES_CACHE = new Map();

// `locale` is a tag, a fallback list or undefined (the runtime's). Grouping is only ever
// switched off: the compact notation has its own default grouping, which "on" would override.
export function getNumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, signDisplay = "auto", notation = "standard", grouping = true }) {
  const key = JSON.stringify([locale ?? null, minimumFractionDigits, maximumFractionDigits, signDisplay, notation, grouping]);
  let fmt = NUMBER_FORMAT_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits, signDisplay, notation, ...(grouping ? {} : { useGrouping: false }) });
    NUMBER_FORMAT_CACHE.set(key, fmt);
  }
  return fmt;
}

// A 12-hour clock writes the hour as the locale does ("6:12 AM"), a 24-hour one with two digits ("06:12").
export function getTimeFormat({ timeLocale, hourCycle, timeZone }) {
  const key = `${timeLocale}|${hourCycle}|${timeZone ?? ""}`;
  let fmt = TIME_FORMAT_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(timeLocale, { hour: hourCycle === "h12" ? "numeric" : "2-digit", minute: "2-digit", hourCycle, timeZone });
    TIME_FORMAT_CACHE.set(key, fmt);
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

// Formats a number in the given format profile. The digit count is decided by the
// caller (config override, then the metric's own default), because that is a
// presentation decision this module has no way to resolve. `signDisplay` follows
// Intl; "exceptZero" is what a signed band range uses to mark its positive bound.
export function formatNumber(profile, value, digits, signDisplay) {
  return format(profile, value, { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay });
}

// A band or axis boundary: up to `maxDigits` decimals, without trailing zeros, so a boundary
// reads exactly as it applies. See internal dev doc §5 "Grenzbeschriftungen".
export function formatBoundary(profile, value, maxDigits, signDisplay) {
  return format(profile, value, { minimumFractionDigits: 0, maximumFractionDigits: maxDigits, signDisplay });
}

// The locale's short scale ("3.4K", "1 Mio."): the form a label falls back to when the
// full number does not fit.
export function formatCompact(profile, value, signDisplay) {
  return format(profile, value, { minimumFractionDigits: 0, maximumFractionDigits: 1, signDisplay, notation: "compact" });
}

function format(profile, value, options) {
  const number = withoutNegativeZero(Number(value));
  return getNumberFormat(profile.numberLocale, { ...options, grouping: profile.grouping }).format(number);
}

// Formats an ISO timestamp as a time of day in the profile's clock and time zone; null for a
// missing/invalid timestamp.
export function formatTimeOfDay(profile, isoString) {
  if (typeof isoString !== "string" || !isoString.trim()) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  return getTimeFormat(profile).format(date);
}

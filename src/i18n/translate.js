// Language resolution and key lookup — the two pure decisions behind every
// translated string on the card.
//
// Neither function caches: the card memoizes the resolved language per
// hass/config identity at the call site, where the identities that invalidate
// it are actually known.

import { DEFAULT_LANGUAGE } from "./locales.js";
import { TRANSLATIONS } from "./registry.js";

// A configured language override is valid only when that base code has its own
// translation block; silently accepting an English fallback would hide a typo.
export function isSupportedLanguage(code) {
  return Object.prototype.hasOwnProperty.call(TRANSLATIONS, code);
}

// Base language code (e.g. "de" from "de-AT"). An explicit config override
// wins outright; otherwise locale.language takes priority as Home Assistant's
// most granular, explicitly user-selectable setting, then language, then
// selectedLanguage.
export function resolveLanguage(configLanguage, hass) {
  if (configLanguage && configLanguage !== "auto") return configLanguage;
  const raw = hass?.locale?.language || hass?.language || hass?.selectedLanguage || DEFAULT_LANGUAGE;
  const base = String(raw).toLowerCase().split("-")[0];
  return TRANSLATIONS[base] ? base : DEFAULT_LANGUAGE;
}

// Translates key in the given language, falling back to DEFAULT_LANGUAGE and
// finally the key itself; values may be functions (interpolation, plurals) or
// plain strings.
export function translate(language, key, vars) {
  const entry = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE]?.[key] ?? key;
  return typeof entry === "function" ? entry(vars || {}) : entry;
}

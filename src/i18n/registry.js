// The translation registry: one entry per supported language.
//
// Adding a language (including community contributions):
//   1. Add its base code to NUMBER_LOCALE_BY_LANGUAGE in locales.js, mapped
//      to an Intl-compatible locale.
//   2. Copy languages/en.js, rename the file and its exported constant to the
//      new base code, and translate every value — including the function
//      values (they interpolate variables and handle plural branching; keep
//      the same variable names). For languages with more than two plural
//      categories, use getPluralCategory()/selectPlural() from formatters.js
//      rather than hand-written one-vs-other rules.
//   3. Import it below and add it to TRANSLATIONS.
//   4. Reload the card once — the self-check below lists any key that is
//      missing or extra compared to the reference language.
//
// No other code changes are needed: language resolution and lookup (see
// translate.js) read this table generically by key.

import { DEFAULT_LANGUAGE } from "./locales.js";
import { verifyTranslationKeyParity } from "./integrity.js";
import { en } from "./languages/en.js";
import { de } from "./languages/de.js";
import { nl } from "./languages/nl.js";
import { fr } from "./languages/fr.js";
import { it } from "./languages/it.js";
import { es } from "./languages/es.js";
import { ru } from "./languages/ru.js";
import { pl } from "./languages/pl.js";
import { ko } from "./languages/ko.js";
import { ja } from "./languages/ja.js";
import { zh } from "./languages/zh.js";
import { nb } from "./languages/nb.js";
import { sv } from "./languages/sv.js";
import { lv } from "./languages/lv.js";

export const TRANSLATIONS = { en, de, nl, fr, it, es, ru, pl, ko, ja, zh, nb, sv, lv };

// Load-time only, exactly as before the source split: the check has to run
// where the assembled table first exists.
verifyTranslationKeyParity(TRANSLATIONS, DEFAULT_LANGUAGE);

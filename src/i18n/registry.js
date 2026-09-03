// The translation registry: one entry per supported language.
//
// Adding a language: see internal dev doc §6 "Neue Sprache". The load-time self-check
// below lists any key a new file has missing or extra vs the reference language;
// resolution and lookup (translate.js) read this table generically by key.

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
import { uk } from "./languages/uk.js";
import { ko } from "./languages/ko.js";
import { ja } from "./languages/ja.js";
import { zh } from "./languages/zh.js";
import { nb } from "./languages/nb.js";
import { sv } from "./languages/sv.js";
import { lv } from "./languages/lv.js";

export const TRANSLATIONS = { en, de, nl, fr, it, es, ru, pl, uk, ko, ja, zh, nb, sv, lv };

// Load-time only: the check has to run where the assembled table first exists.
verifyTranslationKeyParity(TRANSLATIONS, DEFAULT_LANGUAGE);

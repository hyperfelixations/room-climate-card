// Module-load self-check for translation key parity.
//
// Runs once, when the card is loaded, and warns if a language's key set
// differs from the reference language. A missing or extra key in a new or
// edited translation is therefore caught immediately — by whoever loads the
// card, including a community contributor testing their own translation —
// instead of silently falling back to English at runtime, where nobody would
// notice which key was actually missing.
//
// Cheap: a set difference over ~80 keys per language, once per page load.

export function verifyTranslationKeyParity(translations, referenceLanguage) {
  const referenceKeys = new Set(Object.keys(translations[referenceLanguage]));
  for (const lang of Object.keys(translations)) {
    if (lang === referenceLanguage) continue;
    const keys = new Set(Object.keys(translations[lang]));
    const missing = [...referenceKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !referenceKeys.has(k));
    if (missing.length || extra.length) {
      console.warn(
        `Room Climate Card: TRANSLATIONS["${lang}"] is out of sync with "${referenceLanguage}"` +
          (missing.length ? ` — missing: ${missing.join(", ")}` : "") +
          (extra.length ? ` — extra: ${extra.join(", ")}` : "")
      );
    }
  }
}

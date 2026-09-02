// Module-load self-check for translation key parity: warns (console) once per page
// load when a language's key set differs from the reference language, so a missing
// or extra key surfaces at load instead of as a silent English fallback at runtime.

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

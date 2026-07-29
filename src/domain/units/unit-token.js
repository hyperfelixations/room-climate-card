// Normalizes a unit string to a comparison token.
//
// Unit strings arrive from integrations and template sensors, so semantically
// identical spellings can differ at the Unicode/text level — notably PM2.5:
// micro sign `µ` vs. Greek mu `μ`, superscript `³` vs. plain `3`, and optional
// `^`/whitespace.
//
// This normalizes REPRESENTATION only. The resulting token must still match an
// explicitly registered unit profile, which preserves the strict "an unknown
// unit is unusable" safety boundary: a spelling variant is accepted, an
// unregistered unit never is.

export function normalizeUnitToken(unit) {
  if (typeof unit !== "string") return "";
  return unit
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[µμ]/g, "u")
    .replace(/\^3\b/g, "3");
}

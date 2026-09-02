// Normalizes a unit string to a comparison token.
//
// Unit strings arrive from integrations, so identical spellings can differ at the
// Unicode/text level — notably PM2.5: micro sign `µ` vs. Greek mu `μ`, superscript `³`
// vs. `3`, optional `^`/whitespace. This normalizes REPRESENTATION only; the token must
// still match a registered unit profile, so an unregistered unit is never accepted.

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

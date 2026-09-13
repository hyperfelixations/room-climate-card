// What a configuration or a data source got wrong, as data: a code, where (a YAML path or an
// entity id), the written value and what the card uses instead. The wording belongs to
// presentation/view-model/notices.js. See internal dev doc §4 "Diagnosevertrag".

export const SEVERITY = Object.freeze({ WARNING: "warning", HINT: "hint" });

// Every code the card emits, with its level. A code missing here is a programming error.
export const DIAGNOSTIC_SEVERITY = Object.freeze({
  "value.invalid": SEVERITY.WARNING,
  "config.foreign_key": SEVERITY.WARNING,
  "config.deprecated": SEVERITY.WARNING,
  "sources.mixed": SEVERITY.WARNING,
  "classification.profile_unavailable": SEVERITY.WARNING,
  "classification.unit_mismatch": SEVERITY.WARNING,
  "classification.not_representable": SEVERITY.WARNING,
});

// What the card does instead of an invalid value, where that is not a value of its own.
// METRIC_DECIMALS is the measurement's own precision, which only the view model knows.
export const FALLBACK = Object.freeze({
  AUTOMATIC: Object.freeze({ phrase: "automatic" }),
  IGNORED: Object.freeze({ phrase: "ignored" }),
  FIRST_VIEW: Object.freeze({ phrase: "firstView" }),
  CARD_ACTION: Object.freeze({ phrase: "cardAction" }),
  DEFAULTS: Object.freeze({ phrase: "defaults" }),
  METRIC_DECIMALS: Object.freeze({ phrase: "metricDecimals" }),
});

export function fallbackValue(value) {
  return Object.freeze({ value });
}

// The value a whole option falls back to when one value inside it is invalid: `palette.above[2]`
// is named, `palette` is what changes.
export function fallbackOption(key, value) {
  return Object.freeze({ key, value });
}

export function createDiagnostic(code, { path = null, entity = null, value = undefined, fallback = null, params = null } = {}) {
  const severity = DIAGNOSTIC_SEVERITY[code];
  if (!severity) throw new Error(`diagnostics: unknown code "${code}"`);
  return Object.freeze({
    code,
    severity,
    path,
    entity,
    value,
    fallback,
    params: params ? Object.freeze({ ...params }) : null,
  });
}

// Identity for deduplication; the value takes part in its displayed form.
export function diagnosticKey(diagnostic) {
  const { code, path, entity, value, fallback, params } = diagnostic;
  return JSON.stringify([code, path, entity, formatConfigValue(value), fallback, params]);
}

const MAX_VALUE_CHARACTERS = 32;

// A written value as a message shows it: a string quoted, on one line and cut to 32
// characters; a number or boolean as written; a list or object as [...] / {...}. null when
// nothing was written.
export function formatConfigValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const characters = Array.from(value.replace(/\s+/g, " ").trim());
    if (characters.length === 0) return null;
    const text =
      characters.length > MAX_VALUE_CHARACTERS
        ? `${characters.slice(0, MAX_VALUE_CHARACTERS - 1).join("")}…`
        : characters.join("");
    return `"${text}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? "[…]" : "[]";
  return Object.keys(value).length ? "{…}" : "{}";
}

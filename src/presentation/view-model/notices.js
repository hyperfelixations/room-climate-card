// The one place a diagnostic becomes words: the warnings block that shows them, and the
// subtitle line beside it. A message stays data ({key, vars}) until renderMessage() is handed a
// translator, so the card's language and the console's English come from the same message.
// See internal dev doc §4 "Diagnosevertrag".

import { SEVERITY, formatConfigValue } from "../../core/diagnostics.js";
import { metricMetaFor } from "./metric-meta.js";

function message(key, vars = null) {
  return vars ? { key, vars } : { key };
}

function writtenValue(value) {
  const shown = formatConfigValue(value);
  return shown === null ? message("value.empty") : shown;
}

// What the card uses instead: another option's value, a value, or a phrase. The decimals of
// the measurement are the precision the card formats with, so they follow `metricKind`.
function instead(fallback, { metricKind }) {
  if (Object.hasOwn(fallback, "key")) return message("fallback.option", { key: fallback.key, value: String(fallback.value) });
  if (Object.hasOwn(fallback, "value")) return message("fallback.value", { value: String(fallback.value) });
  if (fallback.phrase === "metricDecimals") return message("fallback.value", { value: String(metricMetaFor(metricKind).decimals) });
  return message(`fallback.${fallback.phrase}`);
}

// A classification that fell back names the profile the card uses instead.
function defaultProfile(diagnostic) {
  return message("fallback.value", { value: diagnostic.params.fallback });
}

// A source that stays unusable is named by its entity.
const entityWarning = (key) => (diagnostic) => message(key, { entity: diagnostic.entity });

const MESSAGE_FOR_CODE = {
  "value.invalid": (diagnostic, context) =>
    message("warning.invalidValue", {
      value: writtenValue(diagnostic.value),
      key: diagnostic.path,
      instead: instead(diagnostic.fallback, context),
    }),
  "config.foreign_key": (diagnostic) => message("warning.foreignKey", { key: diagnostic.path }),
  "config.deprecated": (diagnostic) =>
    message("warning.deprecated", { written: diagnostic.params.written, replacement: diagnostic.params.replacement }),
  "sources.mixed": () => message("warning.mixedMeasurements"),
  "entity.not_found": entityWarning("warning.entityNotFound"),
  "entity.unit_ambiguous": entityWarning("warning.unitAmbiguous"),
  "entity.unidentified": entityWarning("warning.unidentified"),
  "entity.unit_unreadable": entityWarning("warning.unitUnreadable"),
  "entity.other_measurement": entityWarning("warning.otherMeasurement"),
  "hint.rooms_unavailable": (diagnostic) => message("hint.roomsUnavailable", { count: diagnostic.params.count }),
  "hint.primary_unavailable": () => message("hint.primaryUnavailable"),
  "hint.range_unavailable": () => message("hint.rangeUnavailable"),
  "hint.trend_unavailable": () => message("hint.trendUnavailable"),
  "classification.profile_unavailable": (diagnostic) =>
    message("warning.profileUnavailable", {
      profile: writtenValue(diagnostic.value),
      measurement: message(`title.${diagnostic.params.measurement}`),
      instead: defaultProfile(diagnostic),
    }),
  "classification.unit_mismatch": (diagnostic) =>
    message("warning.profileUnitMismatch", {
      unit: writtenValue(diagnostic.value),
      measurement: message(`title.${diagnostic.params.measurement}`),
      instead: defaultProfile(diagnostic),
    }),
  "classification.not_representable": (diagnostic) =>
    message("warning.profileNotRepresentable", { unit: diagnostic.params.unit, instead: defaultProfile(diagnostic) }),
};

// `context.metricKind` is the card's measurement, where the wording depends on it.
export function messageForDiagnostic(diagnostic, context = {}) {
  const build = MESSAGE_FOR_CODE[diagnostic.code];
  if (!build) throw new Error(`notices: no message for "${diagnostic.code}"`);
  return build(diagnostic, { metricKind: context.metricKind ?? null });
}

// A variable that is itself a message is rendered first, in the same language.
export function renderMessage(entry, t) {
  if (!entry.vars) return t(entry.key);
  const vars = {};
  for (const [name, value] of Object.entries(entry.vars)) {
    vars[name] = value !== null && typeof value === "object" ? renderMessage(value, t) : value;
  }
  return t(entry.key, vars);
}

// Configuration first, in the order the YAML writes it, then the sources.
export function buildNotices({ configDiagnostics, domainDiagnostics, metricKind = null }) {
  const all = [...configDiagnostics, ...domainDiagnostics.warnings, ...domainDiagnostics.hints];
  const worded = (severity) =>
    all.filter((diagnostic) => diagnostic.severity === severity).map((diagnostic) => messageForDiagnostic(diagnostic, { metricKind }));
  return { warnings: worded(SEVERITY.WARNING), hints: worded(SEVERITY.HINT) };
}

// One warning is shown in full; several are counted, and the console lists them.
export function warningText(warnings, t) {
  if (warnings.length === 0) return null;
  if (warnings.length === 1) return renderMessage(warnings[0], t);
  return t("warning.several", { count: warnings.length });
}

// The block between header and panel: shown while a warning exists, unless show.warnings is off.
export function buildWarningBlock({ config, warnings, t }) {
  const text = warningText(warnings, t);
  return { visible: text !== null && config.show.warnings, text: text ?? "", label: t("warning.label") };
}

// One hint is shown in full; several are counted by the sources behind them.
export function hintText(hints, t) {
  if (hints.length === 0) return null;
  if (hints.length === 1) return renderMessage(hints[0], t);
  return t("hint.several", { count: hints.reduce((sum, hint) => sum + (hint.vars?.count ?? 1), 0) });
}

// A hint follows the line's own sentence: after a stop with a space, after a full-width stop
// without one, and after a separator where the line has no sentence end.
function appendHint(line, hint) {
  if (/[.!?]$/.test(line)) return `${line} ${hint}`;
  if (/[。！？]$/.test(line)) return `${line}${hint}`;
  return `${line} · ${hint}`;
}

// Subtitle precedence: the no-data reason, then the card's own text or the automatic sentence,
// with a hint appended. A no-data reason is shown whatever show.subtitle and `subtitle: ""` ask
// for; a hint never brings back a line that is switched off or empty, and wraps the line while
// it is there, so it is read in full.
export function composeSubtitle({ config, automatic, noDataReason = null, hintText: hint = null }) {
  const overflow = config.subtitle?.overflow || "clip";
  if (noDataReason !== null) return { subtitle: noDataReason, hasSubtitle: true, subtitleOverflow: overflow };
  const own = config.subtitle?.text;
  const line = (own === null || own === undefined ? automatic : own) ?? "";
  const hasSubtitle = line !== "" && config.show.subtitle;
  if (!hasSubtitle || !hint) return { subtitle: line, hasSubtitle, subtitleOverflow: overflow };
  return { subtitle: appendHint(line, hint), hasSubtitle, subtitleOverflow: "wrap" };
}

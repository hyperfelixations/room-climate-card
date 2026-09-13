// The accepted Home Assistant action types for tap_action/hold_action: a name
// allowlist, not full payload validation. Trust model: see internal dev doc §4
// "Sicherheits- und HTML-Escaping-Vertrag".

import { createDiagnostic, fallbackValue, FALLBACK } from "../core/diagnostics.js";
import { isPlainObject, isUnwritten } from "./primitives.js";

const ACTION_ALLOWLIST = new Set(["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"]);

export function isAllowedActionType(action) {
  return ACTION_ALLOWLIST.has(action);
}

// Exposed for documentation/diagnostics that need to name the accepted set.
export function allowedActionTypes() {
  return [...ACTION_ALLOWLIST];
}

// A tap_action/hold_action object with an allowlisted `action`; its other keys are Home
// Assistant's and are kept unchecked. An invalid value falls back to `fallback` — the card's
// default, or null for a room, which then uses the card's own action — and the warning names
// `action` itself when the object was there. The object is copied.
export function normalizeAction(value, path, diagnostics, fallback) {
  const answer = fallback ? { ...fallback } : null;
  if (isUnwritten(value)) return answer;
  if (isPlainObject(value) && typeof value.action === "string" && isAllowedActionType(value.action)) return { ...value };
  const [where, written] = isPlainObject(value) ? [`${path}.action`, value.action] : [path, value];
  const instead = fallback ? fallbackValue(fallback.action) : FALLBACK.CARD_ACTION;
  diagnostics.push(createDiagnostic("value.invalid", { path: where, value: written, fallback: instead }));
  return answer;
}

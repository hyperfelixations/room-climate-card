// The accepted Home Assistant action types for tap_action/hold_action: a name
// allowlist, not full payload validation. Trust model: see internal dev doc §4
// "Sicherheits- und HTML-Escaping-Vertrag".

import { isPlainObject } from "./primitives.js";

const ACTION_ALLOWLIST = new Set(["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"]);

export function isAllowedActionType(action) {
  return ACTION_ALLOWLIST.has(action);
}

// Exposed for documentation/diagnostics that need to name the accepted set.
export function allowedActionTypes() {
  return [...ACTION_ALLOWLIST];
}

// Validates a tap_action/hold_action object; an invalid or missing value falls
// back to `fallback` (a card-level default, or null for a per-room override that
// inherits the card-level action). The object is copied.
export function normalizeAction(value, fallback) {
  if (isPlainObject(value) && typeof value.action === "string" && isAllowedActionType(value.action)) {
    return { ...value };
  }
  return fallback ? { ...fallback } : null;
}

// The accepted Home Assistant action types for tap_action/hold_action.
//
// Trust model: the configuration comes from the dashboard owner, the same as
// for any other Lovelace card, and URL/navigate/service parameters stay
// dashboard-owner-trusted by design. The action NAME is nevertheless checked
// against this list, because it ends up in a dispatched `hass-action` event —
// an unknown or missing value has to fall back safely rather than being passed
// through raw. This is a name allowlist, not full payload validation.

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
// back to `fallback` (a card-level default, or null for a per-room override
// that should inherit the card-level action) instead of being passed through
// raw. The object is copied so a later mutation cannot reach back into the
// user's config or the defaults.
export function normalizeAction(value, fallback) {
  if (isPlainObject(value) && typeof value.action === "string" && isAllowedActionType(value.action)) {
    return { ...value };
  }
  return fallback ? { ...fallback } : null;
}

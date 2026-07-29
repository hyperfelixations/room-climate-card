// The accepted Home Assistant action types for tap_action/hold_action.
//
// Trust model: the configuration comes from the dashboard owner, the same as
// for any other Lovelace card, and URL/navigate/service parameters stay
// dashboard-owner-trusted by design. The action NAME is nevertheless checked
// against this list, because it ends up in a dispatched `hass-action` event —
// an unknown or missing value has to fall back safely rather than being passed
// through raw. This is a name allowlist, not full payload validation.

const ACTION_ALLOWLIST = new Set(["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"]);

export function isAllowedActionType(action) {
  return ACTION_ALLOWLIST.has(action);
}

// Exposed for documentation/diagnostics that need to name the accepted set.
export function allowedActionTypes() {
  return [...ACTION_ALLOWLIST];
}

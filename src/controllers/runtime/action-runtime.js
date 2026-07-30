// Handing a user action to Home Assistant.
//
// The card does not open a dialog, navigate or call a service itself. It dispatches one
// `hass-action` event with a config attached, and the dashboard does the rest — which is
// why the whole of this module is about assembling that config correctly and dispatching
// it into the right realm.
//
// It receives neither hass nor the element. `dispatch` is a single narrow callback, and
// the two configuration lookups return exactly what they say: the rooms array and the
// card-level action pair.

const MORE_INFO = "more-info";

// A clicked element carries its own entity, and a room chip additionally carries the
// index of the room it came from. A room's own action wins over the card-level one — a
// per-room override would otherwise be silently ignored on exactly the element it was
// configured for.
export function cloneAction(action, entityId) {
  const cloned = { ...(action || { action: MORE_INFO }) };
  // more-info without an entity would open nothing. Filling it in from the clicked
  // element is what makes `tap_action: more-info` work as a card-wide default.
  if (cloned.action === MORE_INFO && !cloned.entity) cloned.entity = entityId;
  return cloned;
}

export function createActionRuntime({ platform, getRooms, getCardActions, dispatch }) {
  function buildActionConfig(target, entityId) {
    const roomIndex = target?.dataset?.roomIndex;
    const room = roomIndex !== undefined ? (getRooms() || [])[Number(roomIndex)] : null;
    const cardActions = getCardActions() || {};
    return {
      entity: entityId,
      tap_action: cloneAction(room?.tap_action || cardActions.tap_action, entityId),
      hold_action: cloneAction(room?.hold_action || cardActions.hold_action, entityId),
    };
  }

  return {
    buildActionConfig,

    fire(target, action) {
      if (!target?.dataset?.entity) return;
      const entityId = target.dataset.entity;
      // Only these two exist; anything else is treated as a tap rather than dropped,
      // because a gesture the user made should never silently do nothing.
      const eventAction = action === "hold" ? "hold" : "tap";
      const actionConfig = buildActionConfig(target, entityId);
      const selectedAction = actionConfig[`${eventAction}_action`];
      // `none` is a deliberate configuration, not a missing one: it means "this gesture
      // does nothing here".
      if (!selectedAction || selectedAction.action === "none") return;

      // Constructed in the card's CURRENT realm (see browser-platform.js): an event from
      // a foreign realm fails the listener's own instanceof check, and the dashboard
      // would silently ignore it.
      const event = platform.createEvent("hass-action", { bubbles: true, composed: true });
      event.detail = { config: actionConfig, action: eventAction };
      dispatch(event);
    },
  };
}

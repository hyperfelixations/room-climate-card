// Builds one action config and dispatches one realm-correct `hass-action` event. It owns
// no state and receives neither hass nor the element. Contract: internal documentation
// §5 "Swipe-, Tap-, Hold- und Action-System".

const MORE_INFO = "more-info";

// Room actions override card actions; the target supplies its entity and room index.
export function cloneAction(action, entityId) {
  const cloned = { ...(action || { action: MORE_INFO }) };
  // `more-info` needs the clicked entity when none was configured explicitly.
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
      // Treat anything except the one explicit hold token as a tap.
      const eventAction = action === "hold" ? "hold" : "tap";
      const actionConfig = buildActionConfig(target, entityId);
      const selectedAction = actionConfig[`${eventAction}_action`];
      // `none` is an explicit no-op, not a missing action.
      if (!selectedAction || selectedAction.action === "none") return;

      // A foreign-realm event can fail the dashboard listener's instanceof check.
      const event = platform.createEvent("hass-action", { bubbles: true, composed: true });
      event.detail = { config: actionConfig, action: eventAction };
      dispatch(event);
    },
  };
}

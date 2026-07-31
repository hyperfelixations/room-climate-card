"use strict";

// Drives real gestures through the element's own pointer handlers.
//
// These tests used to assign a hand-built pointer object straight onto the element,
// which worked only because the element exposed a writable window onto the interaction
// runtime's private state. That window is gone: the runtime owns the gesture, and the
// only way in is the same one a browser uses. The helpers below are that way in.
//
// The upside is not only encapsulation. A hand-built pointer could describe a gesture
// the card can never actually produce — a confirmed drag with no recorded width, a
// frozen position the track was never at — and a test built on one of those proves
// nothing about the real card. Everything here goes through handlePointerDown/Move, so
// whatever state results is state the card can genuinely be in.

const ROTATOR_WIDTH_PX = 300;

// The 10px direction threshold is crossed; the 18% commit threshold (54px at 300px)
// deliberately is not, so a drag begun with this does not also decide a swipe.
const CONFIRM_DRAG_DX = -11;

function rotatorOf(el, widthPx = ROTATOR_WIDTH_PX) {
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  if (!rotator) throw new Error("the card has no .rtc-rotator — it needs at least two active views");
  // jsdom lays nothing out, so the one measurement the gesture reads is supplied here.
  rotator.getBoundingClientRect = () => ({ width: widthPx });
  return rotator;
}

function downEvent(rotator, { pointerId = 1, x = 0, y = 0 } = {}) {
  return { pointerId, button: 0, isPrimary: true, clientX: x, clientY: y, composedPath: () => [rotator] };
}

function moveEvent({ pointerId = 1, x = 0, y = 0 } = {}) {
  return { pointerId, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
}

// A pointerdown on the rotator that has NOT yet crossed the direction threshold: a
// gesture is in flight, but it is still a tap as far as the card is concerned.
function beginTouch(el, { pointerId = 1, widthPx = ROTATOR_WIDTH_PX } = {}) {
  el._handlePointerDown(downEvent(rotatorOf(el, widthPx), { pointerId }));
}

// A confirmed horizontal drag whose frozen start position is the given view index.
//
// The index is set BEFORE the pointerdown on purpose: the runtime asks the carousel to
// freeze the track and records whatever position it reports, exactly as it would after
// a synchronized slide had carried the track there. Setting it afterwards is what makes
// the value "stale", which several of these tests then do deliberately.
function beginConfirmedDrag(el, frozenViewIndex = 0, { pointerId = 1, widthPx = ROTATOR_WIDTH_PX } = {}) {
  el._activeView = frozenViewIndex;
  const rotator = rotatorOf(el, widthPx);
  el._handlePointerDown(downEvent(rotator, { pointerId }));
  el._handlePointerMove(moveEvent({ pointerId, x: CONFIRM_DRAG_DX }));
  if (!el._isDragging) throw new Error("the drag did not confirm — check the direction threshold");
}

// Releases a drag with a total horizontal delta of dx from where it started.
function endDrag(el, dx, { pointerId = 1 } = {}) {
  el._handlePointerUp(moveEvent({ pointerId, x: dx }));
}

function cancelDrag(el, { pointerId = 1 } = {}) {
  el._handlePointerCancel({ pointerId });
}

module.exports = {
  ROTATOR_WIDTH_PX,
  CONFIRM_DRAG_DX,
  rotatorOf,
  downEvent,
  moveEvent,
  beginTouch,
  beginConfirmedDrag,
  endDrag,
  cancelDrag,
};

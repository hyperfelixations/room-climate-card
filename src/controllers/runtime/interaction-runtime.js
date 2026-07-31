// The gesture controller: what the user's finger is doing, and what that means.
//
// It owns exactly three things and nothing else owns them: the in-flight pointer, the
// confirmed-drag flag, and the moment until which a synthesized click is ignored. Those
// three used to live on the custom element next to the configuration, the hass object
// and the render pipeline, which is why "is a swipe in progress" had answers in four
// places.
//
// What it does NOT get: hass, the configuration object, the domain model, the view
// model, a renderer, or the element. It receives a platform, the carousel controller,
// three narrow DOM ports and a handful of scalar pull-callbacks. Every threshold it
// applies comes from interaction-logic.js, where it is a named constant.
//
// The division of labour with the carousel is deliberate: this module decides WHAT the
// gesture means, the carousel decides how the track moves. Nothing here touches a class
// name or a transform.

import {
  CLICK_SUPPRESSION_MS,
  dragOffsetPct,
  isHorizontalSwipe,
  isTapCancelledByMovement,
  resolveSwipeTarget,
  resolveTapOrHold,
  viewIndexFromTranslate,
} from "./interaction-logic.js";

// How long after a completed swipe the card waits before rejoining the synchronized
// animation, and the shorter wait used when a gesture was aborted rather than completed.
const RESUME_AFTER_SWIPE_MS = 10000;
const RESUME_AFTER_CANCEL_MS = 1200;

export function createInteractionRuntime({
  platform,
  carousel,
  findInPath,
  getRotator,
  isSwipeEnabled,
  getHoldSeconds,
  fireAction,
  requestRender,
}) {
  let pointer = null;
  let dragging = false;
  let suppressClickUntil = 0;

  const maxIndex = () => Math.max(0, carousel.viewKeys.length - 1);

  function suppressNextClick() {
    suppressClickUntil = platform.now() + CLICK_SUPPRESSION_MS;
  }

  // A gesture that ends without a completed swipe must not schedule a resume unless the
  // track is genuinely detached — a plain tap never detaches it, and arming a resume for
  // a state that never applied would hand the track back mid-cycle.
  function resumeIfTrackIsManual(delayMs) {
    if (carousel.isTrackManual()) carousel.resumeAfterInteraction(delayMs);
  }

  // Where a confirmed-but-aborted drag should land.
  //
  // The active index was never updated during the drag itself, so snapping to it would
  // jump back to wherever the card was before the gesture started. The position the
  // track was actually FROZEN at is the only honest answer. Shared by the cancel path
  // and by the configuration-change abort, which have the same problem: a confirmed drag
  // with no reliable final delta to work from.
  function resolveAbortedIndex(startTranslate) {
    return viewIndexFromTranslate(startTranslate, carousel.viewWidthPct(), maxIndex());
  }

  return {
    // ---- owned state, exposed as read-only accessors ------------------------
    // No setters, deliberately. A gesture begins with a pointer event and ends with
    // one of the handlers below; there is no third way to be mid-swipe, and offering a
    // setter would invite one that the card itself can never produce.
    get pointer() {
      return pointer;
    },
    get isDragging() {
      return dragging;
    },
    get suppressClickUntil() {
      return suppressClickUntil;
    },
    isInteracting: () => dragging || Boolean(pointer),
    suppressNextClick,

    // ---- pointer ------------------------------------------------------------
    handlePointerDown(event) {
      // Deliberately does NOT pause the animation yet: a pointerdown in the rotator may
      // just be the start of vertical dashboard scrolling, and pausing here would cause
      // a visible jump on pointercancel.
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false) return;
      const rotator = getRotator(event);
      // swipe:false makes a pointerdown behave exactly like one that started outside the
      // rotator — no tracking, no preventDefault — without touching any of the
      // downstream logic. Tap and hold are unaffected: they never depend on the rotator.
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: platform.now(),
        rotator: Boolean(rotator) && isSwipeEnabled(),
        entityTarget: findInPath(event, "[data-entity]"),
        startTranslate: -(carousel.activeIndex || 0) * carousel.viewWidthPct(),
        dragging: false,
        width: rotator?.getBoundingClientRect().width || 1,
      };
    },

    handlePointerMove(event) {
      if (!pointer || pointer.id !== event.pointerId || !pointer.rotator) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (!pointer.dragging) {
        if (!isHorizontalSwipe(dx, dy)) return;
        // A real swipe just started: freeze the synchronized animation where it is, so
        // the handoff to manual dragging does not jump.
        pointer.dragging = true;
        dragging = true;
        pointer.startTranslate = carousel.freezeTrackAtCurrentPosition();
        // A resume from a PREVIOUS swipe may still be pending; it would hand the track
        // back mid-gesture. Cleared through its owner, which is the only thing that can.
        carousel.stop();
      }
      event.preventDefault();
      event.stopPropagation();
      const offsetPct = dragOffsetPct(dx, pointer.width, carousel.viewWidthPct());
      carousel.setTrackTranslate(pointer.startTranslate + offsetPct);
    },

    handlePointerUp(event) {
      if (!pointer || pointer.id !== event.pointerId) return;

      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      const elapsedSeconds = (platform.now() - pointer.time) / 1000;
      const entityTarget = findInPath(event, "[data-entity]") || pointer.entityTarget;

      if (pointer.rotator && pointer.dragging) {
        event.preventDefault();
        event.stopPropagation();
        const targetView = resolveSwipeTarget({
          dx,
          pointerWidthPx: pointer.width,
          startTranslate: pointer.startTranslate,
          viewWidthPct: carousel.viewWidthPct(),
          maxIndex: maxIndex(),
          maxTrackOffsetPct: carousel.maxTrackOffsetPct(),
        });
        const changed = targetView !== carousel.activeIndex;
        carousel.activeIndex = targetView;
        dragging = false;
        carousel.setTrackTransition(true);
        carousel.updateTrackTransform(true);
        carousel.scheduleAccessibilitySync();
        carousel.resumeWhenAligned(carousel.activeIndex, RESUME_AFTER_SWIPE_MS);
        requestRender({ viewChanged: changed });
        suppressNextClick();
        pointer = null;
        return;
      }

      if (isTapCancelledByMovement(dx, dy) && entityTarget) {
        // It moved too far to be a tap, but it also never became a swipe. Doing nothing
        // is the honest reading — and the click that follows must still be swallowed.
        suppressNextClick();
        pointer = null;
        return;
      }

      if (entityTarget) {
        event.preventDefault();
        event.stopPropagation();
        fireAction(entityTarget, resolveTapOrHold(elapsedSeconds, getHoldSeconds()));
        suppressNextClick();
      }

      if (pointer.rotator) resumeIfTrackIsManual(0);
      pointer = null;
    },

    handlePointerCancel(event) {
      // The browser or the dashboard aborted the gesture — a vertical scroll took over,
      // a stylus lifted, a system gesture won. Also used for pointerleave; both carry a
      // pointerId, so this only reacts to the pointer it is actually tracking.
      if (!pointer || pointer.id !== event.pointerId) return;
      const aborted = pointer;
      const wasRotator = Boolean(aborted.rotator);
      pointer = null;
      if (dragging) {
        carousel.activeIndex = resolveAbortedIndex(aborted.startTranslate);
        dragging = false;
        carousel.updateTrackTransform(true);
        carousel.scheduleAccessibilitySync();
        carousel.resumeAfterInteraction(RESUME_AFTER_CANCEL_MS);
        requestRender({ viewChanged: false });
        return;
      }
      if (!wasRotator) return;
      resumeIfTrackIsManual(0);
    },

    // The element has left the DOM.
    //
    // Unlike a cancel, there is nothing left to settle: the track the gesture was
    // manipulating is about to be replaced or is already unreachable, so snapping it or
    // scheduling a resume into it would be work on a node nobody will see — and the
    // resume would fire into a detached card. The gesture is simply ENDED.
    //
    // This has to happen, and it has to happen here. Home Assistant removes and
    // reinserts cards routinely, on the same element instance. Left alone, a pointer
    // that outlived the removal makes isInteracting() permanently true: the carousel
    // refuses to start on reconnect, and every hass update is deferred waiting for a
    // pointerup from a node that no longer exists. The card freezes on stale data.
    //
    // The click-suppression deadline is reset for the same reason: it was armed for a
    // click that will never be delivered, and leaving it would swallow the first real
    // action after the card comes back.
    //
    // Idempotent by construction — there is no state left to clear on a second call.
    disconnect() {
      pointer = null;
      dragging = false;
      suppressClickUntil = 0;
    },

    // The markup the gesture is anchored to is about to be replaced.
    //
    // A pointerdown that has NOT yet been classified as a drag holds DOM-derived
    // geometry — the rotator's width, the frozen track position, the entity element it
    // started on — and every one of those is about to stop being true. A later
    // pointermove or pointerup on the same gesture would compute a swipe from that
    // stale geometry and land on the wrong view; the listeners survive the rebuild
    // because they live on the shadow root itself.
    //
    // A CONFIRMED drag never reaches here — the render controller defers the whole
    // rebuild while one is in flight — so there is nothing to settle, only to abandon.
    // The existing "no pointer" guards in the move/up/cancel handlers then make the
    // rest of the gesture a clean no-op.
    abandonGestureForRebuild() {
      pointer = null;
      dragging = false;
    },

    // A configuration change can arrive mid-swipe — live editing in the dashboard
    // editor. A stale pointer (its width and frozen position computed against the
    // about-to-change view count) must not carry over. A CONFIRMED drag is settled first,
    // exactly like a cancel: without that the track stays frozen at whatever
    // intermediate position it had reached, with no resume ever scheduled.
    cancelForConfigChange() {
      if (dragging && pointer?.rotator) {
        carousel.activeIndex = resolveAbortedIndex(pointer.startTranslate);
        carousel.setTrackTransition(true);
        carousel.updateTrackTransform(true);
        carousel.scheduleAccessibilitySync();
        carousel.resumeWhenAligned(carousel.activeIndex, RESUME_AFTER_SWIPE_MS);
      }
      pointer = null;
      dragging = false;
    },

    // ---- click, keyboard, context menu --------------------------------------
    handleClick(event) {
      // Browsers synthesize a click after a pointerup. Without this lock the same action
      // would fire twice for one gesture.
      if (platform.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const entityTarget = findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
      event.stopPropagation();
      fireAction(entityTarget, "tap");
    },

    handleKeydown(event) {
      // Enter and Space activate a focused control, the same as a tap. `repeat` is
      // excluded so holding the key down does not fire the action once per repetition.
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      const entityTarget = findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
      event.stopPropagation();
      fireAction(entityTarget, "tap");
    },

    handleContextMenu(event) {
      // A long press is already a card action, so the browser's own menu would compete
      // with it.
      if (!findInPath(event, "[data-entity]")) return;
      event.preventDefault();
    },
  };
}

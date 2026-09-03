// Owns pointer/drag/click-suppression state and interprets gestures through narrow ports.
// Carousel owns movement; thresholds live in interaction-logic.js. See internal dev doc §5 "Carousel, Swipe und Accessibility".

import {
  CLICK_SUPPRESSION_MS,
  dragOffsetPct,
  isHorizontalSwipe,
  isTapCancelledByMovement,
  resolveSwipeTarget,
  resolveTapOrHold,
  viewIndexFromTranslate,
} from "./interaction-logic.js";

// Completed swipes wait longer to rejoin synchronization than aborted gestures.
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

  // Resume only a genuinely detached track; a plain tap never detached it.
  function resumeIfTrackIsManual(delayMs) {
    if (carousel.isTrackManual()) carousel.resumeAfterInteraction(delayMs);
  }

  // Aborted drags land from their frozen translate, not the never-updated active index.
  function resolveAbortedIndex(startTranslate) {
    return viewIndexFromTranslate(startTranslate, carousel.viewWidthPct(), maxIndex());
  }

  return {
    // Read-only owner state; only pointer handlers begin or end gestures.
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

    handlePointerDown(event) {
      // Do not pause yet: this may become vertical dashboard scrolling.
      if (event.button !== undefined && event.button !== 0) return;
      if (event.isPrimary === false) return;
      const rotator = getRotator(event);
      // `swipe:false` affects rotator tracking only; tap/hold remain available.
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
        // Freeze at the visible position before manual dragging takes over.
        pointer.dragging = true;
        dragging = true;
        pointer.startTranslate = carousel.freezeTrackAtCurrentPosition();
        // Clear an earlier resume through its carousel owner.
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
        // Neither tap nor swipe; still swallow the synthesized click.
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
      // Browser/dashboard cancellation and pointerleave affect only the tracked pointer.
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

    // End all gesture state on detach; settling/resume would target dead markup. Idempotent.
    // Reset suppression so reconnect does not lose its first real action.
    disconnect() {
      pointer = null;
      dragging = false;
      suppressClickUntil = 0;
    },

    // Drop pre-drag DOM geometry before rebuild; confirmed drags defer rebuild upstream.
    abandonGestureForRebuild() {
      pointer = null;
      dragging = false;
    },

    // Live config invalidates gesture geometry; settle confirmed drags before clearing it.
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

    handleClick(event) {
      // Ignore the synthetic click after an already-handled pointerup.
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
      // Enter/Space act as tap; exclude key repeat.
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      const entityTarget = findInPath(event, "[data-entity]");
      if (!entityTarget) return;
      event.preventDefault();
      event.stopPropagation();
      fireAction(entityTarget, "tap");
    },

    handleContextMenu(event) {
      // Entity long-press is a card action; suppress the competing browser menu.
      if (!findInPath(event, "[data-entity]")) return;
      event.preventDefault();
    },
  };
}

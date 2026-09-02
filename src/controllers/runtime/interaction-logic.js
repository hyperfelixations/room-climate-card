// Pure gesture arithmetic; named thresholds preserve the card's established interaction feel.

import { clamp } from "../../core/numbers.js";

// Require distance and horizontal dominance so diagonal dashboard scrolling remains vertical.
export const SWIPE_DIRECTION_MIN_PX = 10;
export const SWIPE_DIRECTION_RATIO = 1.25;

// Below this track fraction, snap to the nearest view instead of committing.
export const SWIPE_COMMIT_FRACTION = 0.18;

// Movement beyond this threshold cancels entity tap handling.
export const TAP_CANCEL_PX = 12;

// Suppress the synthetic post-pointerup click to prevent duplicate actions.
export const CLICK_SUPPRESSION_MS = 450;

export function isHorizontalSwipe(dx, dy) {
  const absX = Math.abs(dx);
  return absX >= SWIPE_DIRECTION_MIN_PX && absX > Math.abs(dy) * SWIPE_DIRECTION_RATIO;
}

// Follow the finger by at most one view in either direction.
export function dragOffsetPct(dx, pointerWidthPx, viewWidthPct) {
  return clamp((dx / pointerWidthPx) * viewWidthPct, -viewWidthPct, viewWidthPct);
}

// Derive from the frozen visible translate, never the auto-slide-stale active index.
export function viewIndexFromTranslate(translatePct, viewWidthPct, maxIndex) {
  return clamp(Math.round(-translatePct / viewWidthPct), 0, maxIndex);
}

// A committed swipe moves exactly one view; otherwise the nearest view wins.
export function resolveSwipeTarget({ dx, pointerWidthPx, startTranslate, viewWidthPct, maxIndex, maxTrackOffsetPct }) {
  const threshold = pointerWidthPx * SWIPE_COMMIT_FRACTION;
  const startView = viewIndexFromTranslate(startTranslate, viewWidthPct, maxIndex);
  if (dx <= -threshold) return clamp(startView + 1, 0, maxIndex);
  if (dx >= threshold) return clamp(startView - 1, 0, maxIndex);
  const projected = clamp(startTranslate + (dx / pointerWidthPx) * viewWidthPct, maxTrackOffsetPct, 0);
  return clamp(Math.round(-projected / viewWidthPct), 0, maxIndex);
}

export function isTapCancelledByMovement(dx, dy) {
  return Math.abs(dx) > TAP_CANCEL_PX || Math.abs(dy) > TAP_CANCEL_PX;
}

export function resolveTapOrHold(elapsedSeconds, holdSeconds) {
  return elapsedSeconds >= holdSeconds ? "hold" : "tap";
}

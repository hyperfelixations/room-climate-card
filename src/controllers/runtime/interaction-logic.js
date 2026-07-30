// The arithmetic of a gesture, as pure functions.
//
// Every threshold the card recognizes lives here as a named constant, and every
// decision derived from one is a function of numbers only — no event, no DOM, no
// element. That is what lets "does a 9-pixel drag start a swipe" be answered by a test
// that writes down two numbers instead of dispatching pointer events into a browser.
//
// The values themselves are not new and must not drift: they are what the card has
// always felt like.

import { clamp } from "../../core/numbers.js";

// A drag has to be BOTH long enough and clearly more horizontal than vertical before it
// counts as a swipe. The ratio is what keeps a diagonal flick during vertical dashboard
// scrolling from hijacking the page.
export const SWIPE_DIRECTION_MIN_PX = 10;
export const SWIPE_DIRECTION_RATIO = 1.25;

// How far across the rotator a drag must travel to commit to the next view. Below it,
// the track snaps back to whichever view is nearest.
export const SWIPE_COMMIT_FRACTION = 0.18;

// Beyond this much movement, a press is no longer a tap — it was a drag that happened
// to end on an entity, and firing its action would be a misread.
export const TAP_CANCEL_PX = 12;

// How long a click is ignored after a pointerup already handled the same gesture.
// Browsers synthesize a click after every pointerup, and without this the action would
// fire twice.
export const CLICK_SUPPRESSION_MS = 450;

export function isHorizontalSwipe(dx, dy) {
  const absX = Math.abs(dx);
  return absX >= SWIPE_DIRECTION_MIN_PX && absX > Math.abs(dy) * SWIPE_DIRECTION_RATIO;
}

// How far the track follows the finger, in percent of the track's own width, capped at
// one view in either direction so a fast flick cannot fling past the neighbour.
export function dragOffsetPct(dx, pointerWidthPx, viewWidthPct) {
  return clamp((dx / pointerWidthPx) * viewWidthPct, -viewWidthPct, viewWidthPct);
}

// Which view a translate percentage corresponds to.
//
// Always derived from where the track was actually FROZEN when the gesture began, never
// from the active index: that index only tracks completed swipes and structural resets,
// and during synchronized auto-slide it is stale relative to the visible position.
// Using it here could skip a view.
export function viewIndexFromTranslate(translatePct, viewWidthPct, maxIndex) {
  return clamp(Math.round(-translatePct / viewWidthPct), 0, maxIndex);
}

// Where a completed drag should land. A committed swipe always moves EXACTLY one view;
// below the commit threshold the nearest view wins instead.
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

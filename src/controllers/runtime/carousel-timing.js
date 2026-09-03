// Pure carousel arithmetic derived from view count, hold/slide durations and caller time.
// Wall-clock phase synchronizes independent cards; see internal dev doc §5 "Carousel, Swipe und Accessibility".

import { clamp } from "../../core/numbers.js";
import { A11Y_FLIP_TIME_FRACTION, SLIDE_EASING_CSS } from "../../core/easing.js";

// Shared declaration/runtime lookup name; a second spelling would fail silently.
export const TRACK_ANIMATION_NAME = "rtc-track-slide";

// Linear ping-pong in DOM order; every transition, including wrap, moves one position.
export function holdSequence(viewCount) {
  const n = Math.max(0, viewCount | 0);
  if (n < 2) return [];
  const forward = Array.from({ length: n }, (_, index) => index);
  const backwardInterior = Array.from({ length: Math.max(0, n - 2) }, (_, index) => n - 2 - index);
  return [...forward, ...backwardInterior];
}

// One view's percentage of the viewCount * 100%-wide track.
export function viewWidthPct(viewCount) {
  return 100 / Math.max(1, viewCount | 0);
}

export function slideTiming({ holdSeconds, slideSeconds, viewCount, nowMs }) {
  const holdMs = Math.max(0, Number(holdSeconds) * 1000);
  const slideMs = Math.max(1, Number(slideSeconds) * 1000);
  const positions = holdSequence(viewCount);
  const enabled = holdMs > 0 && slideMs > 0 && positions.length >= 2;
  const segMs = holdMs + slideMs;
  const cycleMs = Math.max(1, positions.length * segMs);

  return {
    enabled,
    holdMs,
    slideMs,
    segMs,
    cycleMs,
    phaseMs: phaseForTimestamp(nowMs, cycleMs),
    positions,
    viewWidthPct: viewWidthPct(viewCount),
  };
}

export function phaseForTimestamp(timestampMs, cycleMs) {
  return ((timestampMs % cycleMs) + cycleMs) % cycleMs;
}

// A compact CSS percentage, so the generated keyframes stay readable.
export function formatPercent(value) {
  return clamp(Number(value) || 0, 0, 100)
    .toFixed(5)
    .replace(/\.?0+$/, "");
}

// Negative delay synchronizes instances; manual swipe later overrides these declarations.
export function trackAnimationCss(timing, activeIndex) {
  if (!timing.enabled) {
    const x = -(activeIndex || 0) * timing.viewWidthPct;
    return `animation:none;transform:translate3d(${x}%,0,0);`;
  }
  return `animation:${TRACK_ANIMATION_NAME} ${timing.cycleMs}ms linear infinite;animation-delay:-${timing.phaseMs}ms;`;
}

// Each hold emits linear-start/eased-end breakpoints; 100% closes on the first position.
export function slideKeyframes(timing) {
  if (!timing.enabled) return "";

  const frames = timing.positions.map((position, index) => {
    const x = -(position * timing.viewWidthPct);
    const holdStartPct = ((index * timing.segMs) / timing.cycleMs) * 100;
    const holdEndPct = ((index * timing.segMs + timing.holdMs) / timing.cycleMs) * 100;
    return `
          ${formatPercent(holdStartPct)}% {
            transform: translate3d(${x}%,0,0);
            animation-timing-function: linear;
          }
          ${formatPercent(holdEndPct)}% {
            transform: translate3d(${x}%,0,0);
            animation-timing-function: ${SLIDE_EASING_CSS};
          }`;
  });
  const closeX = -(timing.positions[0] * timing.viewWidthPct);

  return `
        @keyframes ${TRACK_ANIMATION_NAME} {
          ${frames.join("\n")}
          100% {
            transform: translate3d(${closeX}%,0,0);
          }
        }
      `;
}

// The visible/A11y view flips at eased spatial midpoint: about 35.4% of slide time, not 50%.
export function accessibleViewIndexAt(phaseMs, timing) {
  const n = timing.positions.length;
  if (n === 0) return 0;
  const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
  const subPhase = phaseMs - segIndex * timing.segMs;
  const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
  return subPhase < flipOffset ? timing.positions[segIndex] : timing.positions[(segIndex + 1) % n];
}

// Share the exact flip offset with accessibleViewIndexAt() so one timer can replace polling.
export function msUntilNextAccessibilityFlip(phaseMs, timing) {
  const n = timing.positions.length;
  if (n === 0) return timing.segMs;
  const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
  const subPhase = phaseMs - segIndex * timing.segMs;
  const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
  if (subPhase < flipOffset) return flipOffset - subPhase;
  return timing.segMs - subPhase + flipOffset;
}

// Stable handover windows, one per occurrence, trimmed away from moving hold edges.
export function holdWindowsForView(targetIndex, timing) {
  const holdMs = Math.max(0, timing.holdMs);
  const marginMs = Math.min(150, Math.max(0, holdMs / 4));
  const windows = [];
  (timing.positions || []).forEach((position, index) => {
    if (position !== targetIndex) return;
    const start = index * timing.segMs;
    const end = start + holdMs;
    windows.push({ start: Math.min(start + marginMs, end), end: Math.max(start, end - marginMs) });
  });
  return windows;
}

export function isPhaseInStableViewHold(targetIndex, phaseMs, timing) {
  return holdWindowsForView(targetIndex, timing).some(
    (holdWindow) => holdWindow.end >= holdWindow.start && phaseMs >= holdWindow.start && phaseMs <= holdWindow.end
  );
}

// Wait until targetIndex is stably held; zero when it already is.
export function waitFromTimestampUntilViewHold(targetIndex, timestampMs, timing) {
  const phaseMs = phaseForTimestamp(timestampMs, timing.cycleMs);
  if (isPhaseInStableViewHold(targetIndex, phaseMs, timing)) return 0;

  const windows = holdWindowsForView(targetIndex, timing);
  let best = Infinity;
  for (const holdWindow of windows) {
    let waitMs = holdWindow.start - phaseMs;
    if (waitMs < 0) waitMs += timing.cycleMs;
    if (waitMs < best) best = waitMs;
  }
  return Number.isFinite(best) ? Math.max(0, best) : 0;
}

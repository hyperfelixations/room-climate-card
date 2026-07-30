// The carousel's arithmetic, as pure functions.
//
// Every value below is derived from four numbers — how many views there are, how long
// a view is held, how long a slide takes, and what time it is — and nothing else. No
// DOM, no card, no clock of its own: the caller passes `nowMs` in. That is what makes
// the whole timing model testable by writing down a millisecond, and it is why the
// auto-slide can be reasoned about at all.
//
// WHY WALL-CLOCK TIME. The track is moved by a CSS keyframe animation with a negative
// delay derived from the absolute time. Two cards on the same dashboard therefore show
// the same view at the same moment without talking to each other, and an entity update
// never restarts the animation. The price is that JavaScript has to be able to compute
// the animation's current phase from the same clock — which is what most of this file
// is.

import { clamp } from "../../core/numbers.js";
import { A11Y_FLIP_TIME_FRACTION, SLIDE_EASING_CSS } from "../../core/easing.js";

// The hold-index sequence for one full cycle: a linear ping-pong straight through the
// views in their actual left-to-right DOM order — 0,1,…,N-1,N-2,…,1, then wrapping
// back to 0 — so every transition, including the wrap, moves exactly one position and
// no view is ever skipped. A pure function of the count; it neither knows nor cares
// which key sits at which index.
export function holdSequence(viewCount) {
  const n = Math.max(0, viewCount | 0);
  if (n < 2) return [];
  const forward = Array.from({ length: n }, (_, index) => index);
  const backwardInterior = Array.from({ length: Math.max(0, n - 2) }, (_, index) => n - 2 - index);
  return [...forward, ...backwardInterior];
}

// One view's width as a percentage of the track's own width. The track is
// viewCount * 100% wide, so a view is 100/viewCount of it.
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

// The track's initial animation declarations. A manual swipe later overrides them with
// inline styles; the negative delay is what synchronizes every card instance to the
// same absolute cycle.
export function trackAnimationCss(timing, activeIndex) {
  if (!timing.enabled) {
    const x = -(activeIndex || 0) * timing.viewWidthPct;
    return `animation:none;transform:translate3d(${x}%,0,0);`;
  }
  return `animation:rtc-track-slide ${timing.cycleMs}ms linear infinite;animation-delay:-${timing.phaseMs}ms;`;
}

// Each hold position produces two breakpoints — the hold's start (linear, so it does
// not drift) and its end (eased, so the slide out of it matches the visual easing) —
// and a final 100% breakpoint returns to the first position.
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
        @keyframes rtc-track-slide {
          ${frames.join("\n")}
          100% {
            transform: translate3d(${closeX}%,0,0);
          }
        }
      `;
}

// Which view is VISUALLY in front at a given phase.
//
// Mirrors slideKeyframes()'s structure: segment i spans [i*segMs, (i+1)*segMs) — a
// holdMs-long stable hold at positions[i], then a slideMs-long transition into
// positions[(i+1) % n]. The current view flips where the EASED, spatial progress of
// that transition crosses 50%, which for the card's easing curve is about 35.4% of the
// slide's TIME — not 50% of it. Using the raw temporal midpoint was a real bug: for
// roughly 15% of every slide the outgoing view stayed the "accessible" one while the
// incoming one was already spatially dominant.
export function accessibleViewIndexAt(phaseMs, timing) {
  const n = timing.positions.length;
  if (n === 0) return 0;
  const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
  const subPhase = phaseMs - segIndex * timing.segMs;
  const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
  return subPhase < flipOffset ? timing.positions[segIndex] : timing.positions[(segIndex + 1) % n];
}

// How long until accessibleViewIndexAt() would next return something different, so the
// caller can arm one precisely-timed timer instead of polling. Uses the same flip
// offset as the function above — a second, independently derived one would let the two
// disagree about when a flip actually happens.
export function msUntilNextAccessibilityFlip(phaseMs, timing) {
  const n = timing.positions.length;
  if (n === 0) return timing.segMs;
  const segIndex = Math.min(n - 1, Math.floor(phaseMs / timing.segMs));
  const subPhase = phaseMs - segIndex * timing.segMs;
  const flipOffset = timing.holdMs + timing.slideMs * A11Y_FLIP_TIME_FRACTION;
  if (subPhase < flipOffset) return flipOffset - subPhase;
  return timing.segMs - subPhase + flipOffset;
}

// The phases at which it is SAFE to hand the track back to the synchronized animation
// while showing targetIndex — one window per occurrence of that index in the hold
// sequence, since a view can be held more than once per cycle. Each window is trimmed
// by a margin so the handover never lands on a hold's very edge, where the animation
// is about to move.
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

// How much longer after `timestampMs` the phase needs before it holds targetIndex.
// Zero when it already does.
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

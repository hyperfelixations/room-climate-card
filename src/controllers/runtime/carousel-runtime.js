// Owns carousel position, resume/A11y timers and the animation-start frame. It knows no
// hass, config object, model or renderer; clock and DOM access arrive through narrow ports.
// Contract: see internal dev doc §5 "Carousel, Swipe und Accessibility".

import { clamp } from "../../core/numbers.js";
import { SLIDE_EASING_CSS } from "../../core/easing.js";
import {
  TRACK_ANIMATION_NAME,
  accessibleViewIndexAt,
  holdSequence,
  isPhaseInStableViewHold,
  msUntilNextAccessibilityFlip,
  slideKeyframes,
  slideTiming,
  trackAnimationCss,
  viewWidthPct,
  waitFromTimestampUntilViewHold,
} from "./carousel-timing.js";

// Scheduling floor that breaks zero-delay re-arm loops without delaying a due flip beyond
// the browser's own nested-timeout clamp.
const MIN_RESCHEDULE_MS = 4;

// Manual swipe settle duration; synchronized rejoin has a separate delay.
const SETTLE_MS = 420;

export function createCarouselController({ platform, getTrack, getViewElements, getTimingConfig, isInteracting }) {
  let viewKeys = [];
  let activeIndex = 0;
  let resumeTimer = null;
  let a11yTimer = null;
  let animationStartFrame = null;

  const viewCount = () => viewKeys.length;
  const interacting = () => Boolean(isInteracting?.());

  // Pull timing scalars on demand; a pushed copy could be stale before the first render.
  const config = () => getTimingConfig() || {};
  const holdSecondsOf = () => Number(config().rotationSeconds);
  const slideSecondsOf = () => Number(config().slideSeconds);

  const timing = () =>
    slideTiming({
      holdSeconds: holdSecondsOf(),
      slideSeconds: slideSecondsOf(),
      viewCount: viewCount(),
      nowMs: platform.now(),
    });

  // Swipe is independent; this gates only synchronized animation and its timers.
  const hasAutoSlide = () => {
    const holdSeconds = holdSecondsOf();
    const slideSeconds = slideSecondsOf();
    return (
      config().autoSlide !== false &&
      Number.isFinite(holdSeconds) &&
      Number.isFinite(slideSeconds) &&
      holdSeconds > 0 &&
      slideSeconds > 0 &&
      viewCount() >= 2 &&
      !platform.prefersReducedMotion()
    );
  };

  const maxTrackOffsetPct = () => -((Math.max(1, viewCount()) - 1) * viewWidthPct(viewCount()));

  // `rtc-manual` means the JS index, not the animation phase, is visibly authoritative.
  function takeManualControl(track) {
    track.classList.add("rtc-manual");
    track.style.animation = "none";
    return track;
  }

  function trackTranslatePct(track) {
    const fallback = -(activeIndex || 0) * viewWidthPct(viewCount());
    if (!track) return fallback;
    const translateXPx = platform.readTranslateXPx(track);
    if (translateXPx === null) return fallback;
    const width = track.getBoundingClientRect().width || 1;
    return clamp((translateXPx / width) * 100, maxTrackOffsetPct(), 0);
  }

  function updateTrackTransform(transition = true) {
    const track = getTrack();
    if (!track) return;
    takeManualControl(track);
    track.style.transition = transition ? `transform ${SETTLE_MS}ms ${SLIDE_EASING_CSS}` : "none";
    track.style.transform = `translate3d(${-(activeIndex || 0) * viewWidthPct(viewCount())}%,0,0)`;
  }

  // Freeze the rendered transform so a swipe beginning mid-slide does not jump.
  function pauseTrackAtCurrentPosition(track) {
    const currentTranslate = trackTranslatePct(track);
    takeManualControl(track);
    track.style.transition = "none";
    track.style.transform = `translate3d(${currentTranslate}%,0,0)`;
    return currentTranslate;
  }

  // DOM-owning variant; without a track, use the index-derived position.
  function freezeTrackAtCurrentPosition() {
    const track = getTrack();
    if (!track) return -(activeIndex || 0) * viewWidthPct(viewCount());
    return pauseTrackAtCurrentPosition(track);
  }

  function setTrackTranslate(translatePct) {
    const track = getTrack();
    if (!track) return;
    takeManualControl(track);
    track.style.transform = `translate3d(${clamp(translatePct, maxTrackOffsetPct(), 0)}%,0,0)`;
  }

  function setTrackTransition(enable) {
    const track = getTrack();
    if (!track) return;
    takeManualControl(track);
    track.style.transition = enable ? `transform ${SETTLE_MS}ms ${SLIDE_EASING_CSS}` : "none";
  }

  // The wall clock synchronizes cards, but start-frame latency makes it lead the rendered
  // animation. A11y flips at holdMs + 35.4% of slideMs, so use the animation's corrected
  // current phase for what is visible; keep wall time only as fallback. See browser-platform.js
  // and internal dev doc §5 "Carousel, Swipe und Accessibility".
  function visiblePhaseMs(track, current) {
    const animation = platform.readAnimationPhase?.(track, TRACK_ANIMATION_NAME);
    // Reject a phase that belongs to the previous timing configuration.
    if (!animation || Math.round(animation.cycleMs) !== Math.round(current.cycleMs)) return current.phaseMs;
    return animation.phaseMs;
  }

  // Derive visible index and next flip from ONE phase read: near an exact flip, two reads can
  // straddle the boundary and re-arm past a view that was never announced. In manual mode the
  // JS index is authoritative and there is no phase/flip to read.
  function accessibilitySnapshot() {
    const track = getTrack();
    const current = timing();
    const autoEngaged = Boolean(current.enabled && track && !track.classList.contains("rtc-manual"));
    const phaseMs = autoEngaged ? visiblePhaseMs(track, current) : null;
    return {
      autoEngaged,
      timing: current,
      phaseMs,
      visibleIndex: autoEngaged ? accessibleViewIndexAt(phaseMs, current) : activeIndex,
    };
  }

  // Shared by A11y sync and active-view preservation; animation phase wins while engaged.
  function currentVisualIndex() {
    return accessibilitySnapshot().visibleIndex;
  }

  // Permanently mounted offscreen views must be inert and hidden. Accept the index so callers
  // apply the phase they already read instead of taking a boundary-crossing second read.
  function updateViewAccessibility(visibleIndex = currentVisualIndex()) {
    const views = getViewElements();
    if (!views) return;
    views.forEach((view, index) => {
      const isActive = index === visibleIndex;
      if (isActive) view.removeAttribute("aria-hidden");
      else view.setAttribute("aria-hidden", "true");
      view.toggleAttribute("inert", !isActive);
    });
  }

  // One timer per flip, no polling; hidden/manual tracks stop the chain.
  function scheduleAccessibilitySync() {
    clearA11yTimer();
    const snapshot = accessibilitySnapshot();
    updateViewAccessibility(snapshot.visibleIndex);
    if (platform.isDocumentHidden()) return;
    if (!snapshot.autoEngaged) return;
    // Arm from the same phase used to write attributes; never skip an unapplied flip.
    const waitMs = Math.max(MIN_RESCHEDULE_MS, msUntilNextAccessibilityFlip(snapshot.phaseMs, snapshot.timing));
    a11yTimer = platform.setTimeout(() => {
      a11yTimer = null;
      scheduleAccessibilitySync();
    }, waitMs);
  }

  function applyAutoSlideStyles() {
    const track = getTrack();
    if (!track || interacting()) return;

    if (!hasAutoSlide()) {
      updateTrackTransform(false);
      scheduleAccessibilitySync();
      return;
    }

    const current = timing();
    track.classList.remove("rtc-manual");
    track.style.transition = "";
    track.style.transform = "";
    track.style.animation = `${TRACK_ANIMATION_NAME} ${current.cycleMs}ms linear infinite`;
    track.style.animationDelay = `-${current.phaseMs}ms`;
    scheduleAccessibilitySync();
    // The animation exists only after this declaration's frame. Resync once then so the
    // A11y chain uses animation phase, not the guaranteed-leading wall-clock fallback.
    clearAnimationStartFrame();
    animationStartFrame = platform.requestAnimationFrame(() => {
      animationStartFrame = null;
      scheduleAccessibilitySync();
    });
  }

  // Rejoin only while global phase holds the parked view, avoiding a visible jump.
  function resumeWhenAligned(targetIndex, minDelayMs = 10000) {
    clearResumeTimer();
    if (!hasAutoSlide()) return;

    const index = clamp(Math.round(targetIndex) || 0, 0, Math.max(0, viewCount() - 1));
    const delayMs = delayUntilPhaseHolds(index, minDelayMs);

    resumeTimer = platform.setTimeout(() => {
      resumeTimer = null;
      if (interacting() || !hasAutoSlide()) return;
      // A slow/throttled timer may miss its window; re-aim instead of jumping.
      if (!phaseHoldsView(index)) {
        resumeWhenAligned(index, 0);
        return;
      }
      applyAutoSlideStyles();
    }, delayMs);
  }

  function delayUntilPhaseHolds(targetIndex, minDelayMs) {
    const current = timing();
    const delayMs = Math.max(0, minDelayMs);
    if (!current.enabled) return delayMs;
    return delayMs + waitFromTimestampUntilViewHold(targetIndex, platform.now() + delayMs, current);
  }

  function phaseHoldsView(targetIndex) {
    const current = timing();
    if (!current.enabled) return false;
    return isPhaseInStableViewHold(targetIndex, current.phaseMs, current);
  }

  function clearResumeTimer() {
    if (resumeTimer !== null) {
      platform.clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function clearA11yTimer() {
    if (a11yTimer !== null) {
      platform.clearTimeout(a11yTimer);
      a11yTimer = null;
    }
  }

  function clearAnimationStartFrame() {
    if (animationStartFrame !== null) {
      platform.cancelAnimationFrame(animationStartFrame);
      animationStartFrame = null;
    }
  }

  function stop() {
    clearResumeTimer();
    clearA11yTimer();
    clearAnimationStartFrame();
  }

  return {
    get activeIndex() {
      return activeIndex;
    },
    set activeIndex(index) {
      activeIndex = index;
    },
    get viewKeys() {
      return viewKeys;
    },

    // View list is pushed after render; timing remains pulled on demand.
    setViews(keys) {
      viewKeys = Array.isArray(keys) ? keys : [];
    },

    timing,
    hasAutoSlide,
    holdSequence: () => holdSequence(viewCount()),
    viewWidthPct: () => viewWidthPct(viewCount()),
    trackAnimationCss: () => trackAnimationCss(timing(), activeIndex),
    slideKeyframes: () => slideKeyframes(timing()),
    maxTrackOffsetPct,
    // Keeps the `rtc-manual` class private to this DOM owner.
    isTrackManual: () => Boolean(getTrack()?.classList.contains("rtc-manual")),
    currentVisualIndex,
    phaseHoldsView,
    delayUntilPhaseHolds,
    // Expose owner handles read-only; booleans would duplicate state.
    get resumeTimerHandle() {
      return resumeTimer;
    },
    get accessibilityTimerHandle() {
      return a11yTimer;
    },
    get animationStartFrameHandle() {
      return animationStartFrame;
    },

    start: applyAutoSlideStyles,
    stop,
    restart() {
      stop();
      applyAutoSlideStyles();
    },
    applyAutoSlideStyles,
    scheduleAccessibilitySync,
    updateViewAccessibility,
    resumeWhenAligned,
    resumeAfterInteraction(delayMs = 1800) {
      resumeWhenAligned(activeIndex, delayMs);
    },
    updateTrackTransform,
    trackTranslatePct,
    pauseTrackAtCurrentPosition,
    freezeTrackAtCurrentPosition,
    setTrackTranslate,
    setTrackTransition,

    // Release every owned timer/frame; idempotent.
    destroy: stop,
  };
}

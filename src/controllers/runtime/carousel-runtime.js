// The carousel controller: everything that MOVES, and everything that has to be
// cleaned up afterwards.
//
// It owns three pieces of state and nothing else owns them: the active view index, the
// resume timer, and the accessibility-sync timer. Keeping them together gives every
// timer one explicit reset owner.
//
// What it is NOT allowed to know is deliberate and complete: no hass, no configuration
// object, no domain model, no renderer, no view model. It receives four things —
// a platform, two narrow DOM ports, and a handful of scalar values — and everything
// else is a callback into the element for a decision it genuinely cannot make itself
// (is the user currently touching the card?).
//
// The wall-clock model is what makes it testable: nothing here reads a clock, it asks
// the platform. A fake platform therefore makes the entire auto-slide deterministic,
// which is the only way to assert an animation phase without waiting for one.

import { clamp } from "../../core/numbers.js";
import { SLIDE_EASING_CSS } from "../../core/easing.js";
import {
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

// Guards against a 0ms re-arm loop if a phase lands exactly on — or a floating-point
// hair past — a flip boundary.
const MIN_RESCHEDULE_MS = 50;

// How long the eased settle after a manual swipe takes, and how long the card waits
// before it even considers rejoining the synchronized animation.
const SETTLE_MS = 420;

export function createCarouselController({ platform, getTrack, getViewElements, getTimingConfig, isInteracting }) {
  // ---- owned state ----------------------------------------------------------
  let viewKeys = [];
  let activeIndex = 0;
  let resumeTimer = null;
  let a11yTimer = null;

  const viewCount = () => viewKeys.length;
  const interacting = () => Boolean(isInteracting?.());

  // ---- timing ---------------------------------------------------------------
  // PULLED, not pushed. Three scalars, read on demand from the one place that owns
  // them. A pushed copy would need a synchronization point before every timing read —
  // and there is one that happens before any render at all: a card connected before its
  // first hass update starts the rotation, which would then run against stale zeros.
  // The controller still cannot see the configuration object, only these three numbers.
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

  // Auto-rotation needs at least two views, positive durations, an explicit opt-in and
  // a user who has not asked for reduced motion. Note that this gates only the timer
  // and the synchronized CSS animation — swiping is a separate decision the element
  // makes, and is not read here at all.
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

  // ---- track manipulation ---------------------------------------------------
  // Every path that takes manual control marks the track "rtc-manual" and kills the
  // animation. That class is also the single signal for "the JS index IS the visible
  // position", which currentVisualIndex() reads back.
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

  // Freezes the synchronized animation exactly where it currently is, so a swipe that
  // starts mid-slide does not jump.
  function pauseTrackAtCurrentPosition(track) {
    const currentTranslate = trackTranslatePct(track);
    takeManualControl(track);
    track.style.transition = "none";
    track.style.transform = `translate3d(${currentTranslate}%,0,0)`;
    return currentTranslate;
  }

  // The same freeze, but the controller finds its own track — so the interaction runtime
  // never has to query the DOM. With no track mounted there is nothing to freeze and the
  // index-derived position is the honest answer.
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

  // ---- which view is actually in front --------------------------------------
  // The single shared answer, used both by the accessibility sync and by the
  // active-view preservation across a structural rebuild, so the two can never quietly
  // disagree. While the synchronized animation drives the track, the JS index is stale
  // between discrete updates and the phase is authoritative; the moment anything takes
  // manual control, the JS index IS the visible position.
  function currentVisualIndex() {
    const track = getTrack();
    const current = timing();
    const autoEngaged = current.enabled && track && !track.classList.contains("rtc-manual");
    return autoEngaged ? accessibleViewIndexAt(current.phaseMs, current) : activeIndex;
  }

  // Keeps offscreen views out of the tab order and hidden from assistive technology.
  // Every view stays permanently mounted, so without this a keyboard user could tab
  // into a card that is not on screen.
  function updateViewAccessibility() {
    const views = getViewElements();
    if (!views) return;
    const visibleIndex = currentVisualIndex();
    views.forEach((view, index) => {
      const isActive = index === visibleIndex;
      if (isActive) view.removeAttribute("aria-hidden");
      else view.setAttribute("aria-hidden", "true");
      view.toggleAttribute("inert", !isActive);
    });
  }

  // One precisely-timed timer per flip rather than continuous polling. Re-arms itself
  // for as long as the track stays in synchronized mode; a hidden document stops the
  // chain entirely, because nothing can be looked at and a background tab throttles the
  // timer anyway.
  function scheduleAccessibilitySync() {
    clearA11yTimer();
    updateViewAccessibility();
    if (platform.isDocumentHidden()) return;
    const track = getTrack();
    const current = timing();
    if (!(current.enabled && track && !track.classList.contains("rtc-manual"))) return;
    const waitMs = Math.max(MIN_RESCHEDULE_MS, msUntilNextAccessibilityFlip(current.phaseMs, current));
    a11yTimer = platform.setTimeout(() => {
      a11yTimer = null;
      scheduleAccessibilitySync();
    }, waitMs);
  }

  // ---- engaging and leaving the synchronized animation ----------------------
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
    track.style.animation = `rtc-track-slide ${current.cycleMs}ms linear infinite`;
    track.style.animationDelay = `-${current.phaseMs}ms`;
    scheduleAccessibilitySync();
  }

  // Rejoin the synchronized animation only once its global phase already HOLDS the
  // view the user is parked on. Handing the track back at any other moment would make
  // it visibly jump to wherever the wall clock happens to be.
  function resumeWhenAligned(targetIndex, minDelayMs = 10000) {
    clearResumeTimer();
    if (!hasAutoSlide()) return;

    const index = clamp(Math.round(targetIndex) || 0, 0, Math.max(0, viewCount() - 1));
    const delayMs = delayUntilPhaseHolds(index, minDelayMs);

    resumeTimer = platform.setTimeout(() => {
      resumeTimer = null;
      if (interacting() || !hasAutoSlide()) return;
      // The phase may have drifted past the window while the timer was pending — a
      // slow frame, a throttled background tab. Re-aim rather than hand over wrongly.
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

  // ---- timers ---------------------------------------------------------------
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

  function stop() {
    clearResumeTimer();
    clearA11yTimer();
  }

  return {
    // ---- state the controller owns ------------------------------------------
    get activeIndex() {
      return activeIndex;
    },
    set activeIndex(index) {
      activeIndex = index;
    },
    get viewKeys() {
      return viewKeys;
    },

    // The element hands over the resolved view list after each render; the timing is
    // pulled through getTimingConfig() instead (see there).
    setViews(keys) {
      viewKeys = Array.isArray(keys) ? keys : [];
    },

    // ---- queries -------------------------------------------------------------
    timing,
    hasAutoSlide,
    holdSequence: () => holdSequence(viewCount()),
    viewWidthPct: () => viewWidthPct(viewCount()),
    trackAnimationCss: () => trackAnimationCss(timing(), activeIndex),
    slideKeyframes: () => slideKeyframes(timing()),
    maxTrackOffsetPct,
    // Whether the track is currently detached from the synchronized animation. The
    // interaction runtime needs to know this — a tap must not schedule a resume for a
    // state that never applied — and asking the controller keeps the "rtc-manual" class
    // an implementation detail of exactly one module.
    isTrackManual: () => Boolean(getTrack()?.classList.contains("rtc-manual")),
    currentVisualIndex,
    phaseHoldsView,
    delayUntilPhaseHolds,
    // The raw handles, not booleans. The element exposes them read-only for tests that
    // assert "no timer lingers"; a derived boolean would be a second representation of
    // the same fact and could drift from it.
    get resumeTimerHandle() {
      return resumeTimer;
    },
    get accessibilityTimerHandle() {
      return a11yTimer;
    },

    // ---- commands ------------------------------------------------------------
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

    // Everything this controller could still be holding. Called on disconnect, and
    // safe to call twice.
    destroy: stop,
  };
}

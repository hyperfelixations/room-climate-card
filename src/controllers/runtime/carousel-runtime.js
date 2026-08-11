// The carousel controller: everything that MOVES, and everything that has to be
// cleaned up afterwards.
//
// It owns four pieces of state and nothing else owns them: the active view index, the
// resume timer, the accessibility-sync timer, and the one animation frame that follows
// an animation start. Keeping them together gives every timer one explicit reset owner.
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

// Guards against a 0ms re-arm loop if a phase lands exactly on — or a floating-point
// hair past — a flip boundary.
//
// It is a floor on SCHEDULING, and deliberately not a moment longer than it has to be:
// whatever it is set to, a flip that turns out to be due sooner than that is applied
// that much late. At 50ms it was long enough to be seen — a timer that fired a hair
// before its own flip deferred that flip by a twentieth of a second. 4ms is the point
// below which browsers clamp nested timeouts anyway, so nothing shorter is schedulable
// and nothing longer is needed to break a zero-delay loop.
const MIN_RESCHEDULE_MS = 4;

// How long the eased settle after a manual swipe takes, and how long the card waits
// before it even considers rejoining the synchronized animation.
const SETTLE_MS = 420;

export function createCarouselController({ platform, getTrack, getViewElements, getTimingConfig, isInteracting }) {
  // ---- owned state ----------------------------------------------------------
  let viewKeys = [];
  let activeIndex = 0;
  let resumeTimer = null;
  let a11yTimer = null;
  let animationStartFrame = null;

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
  // The phase the track is VISIBLY at, which is not the same thing as the phase the
  // wall clock is at.
  //
  // The synchronized animation is started with `animation-delay: -phaseMs` read from
  // the wall clock, but it only begins with the frame that applies that declaration.
  // However long that frame took becomes a fixed offset between the two for the whole
  // life of that animation — ~23 ms measured on a fast machine, and bounded by nothing
  // on a slow one. Anything derived from the wall clock is therefore that much AHEAD of
  // what is on screen.
  //
  // That is not a rounding detail for accessibility. The accessible view flips
  // holdMs + 35.4 % of slideMs into a segment, i.e. 53 ms after the hold ends for this
  // card's own defaults. Once the offset exceeds that, the flip lands while the track
  // is still parked: assistive technology announces the next view while the current one
  // is unmoved and fully on screen. It was observed exactly there, as a reproducible CI
  // failure on a slower machine.
  //
  // Asking the animation removes the offset by construction, on every machine. The wall
  // clock stays the fallback and stays the SOURCE of the synchronization — two cards on
  // one dashboard still agree because both derive their delay from it; this only reads
  // back where the resulting animation actually got to.
  //
  // "Where it got to" means NOW, including from the timer callback below, where an
  // animation clock read raw would still be reporting the last painted frame. The
  // platform port owns that correction; see msSinceAnimationFrame() in
  // browser-platform.js.
  function visiblePhaseMs(track, current) {
    const animation = platform.readAnimationPhase?.(track, TRACK_ANIMATION_NAME);
    // A running animation still carries the PREVIOUS cycle length for a moment after
    // rotation_seconds/slide_seconds change. Reading the new schedule at the old
    // animation's phase would be worse than the offset this exists to remove.
    if (!animation || Math.round(animation.cycleMs) !== Math.round(current.cycleMs)) return current.phaseMs;
    return animation.phaseMs;
  }

  // ONE reading of the situation, and everything the accessibility pass derives from it.
  //
  // "Which view is accessible now" and "how long until that stops being true" are two
  // answers about a single instant, and they have to come from a single reading of the
  // phase. The sync timer is armed to fire exactly ON a flip, so whenever it runs the
  // boundary is at most a hair away in either direction — and the phase is extrapolated
  // to *now* on every read, so two reads a few hundred microseconds apart can land on
  // opposite sides of it. A pass that read twice could therefore write the OUTGOING view
  // and then arm as though the flip were already behind it, leaving the wrong view
  // announced to assistive technology for a full hold. Measured in Chromium: in every
  // captured occurrence the last attribute write landed 0.7–2.3 ms before its own flip
  // and nothing followed for the rest of the segment.
  //
  // The phase is read only where it can mean anything: the moment anything takes manual
  // control, the JS index IS the visible position and there is no flip to wait for.
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

  // The single shared answer, used both by the accessibility sync and by the
  // active-view preservation across a structural rebuild, so the two can never quietly
  // disagree. While the synchronized animation drives the track, the JS index is stale
  // between discrete updates and the phase is authoritative.
  function currentVisualIndex() {
    return accessibilitySnapshot().visibleIndex;
  }

  // Keeps offscreen views out of the tab order and hidden from assistive technology.
  // Every view stays permanently mounted, so without this a keyboard user could tab
  // into a card that is not on screen.
  //
  // The index is a parameter so that a caller who has already read the phase applies
  // THAT reading rather than taking a second one of its own.
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

  // One precisely-timed timer per flip rather than continuous polling. Re-arms itself
  // for as long as the track stays in synchronized mode; a hidden document stops the
  // chain entirely, because nothing can be looked at and a background tab throttles the
  // timer anyway.
  function scheduleAccessibilitySync() {
    clearA11yTimer();
    const snapshot = accessibilitySnapshot();
    updateViewAccessibility(snapshot.visibleIndex);
    if (platform.isDocumentHidden()) return;
    if (!snapshot.autoEngaged) return;
    // Armed against the same phase the attributes were just written from, so the timer
    // fires when the FLIP is due on screen rather than when the wall clock says it is —
    // and so that it can never arm past a flip it has not yet applied.
    const waitMs = Math.max(MIN_RESCHEDULE_MS, msUntilNextAccessibilityFlip(snapshot.phaseMs, snapshot.timing));
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
    track.style.animation = `${TRACK_ANIMATION_NAME} ${current.cycleMs}ms linear infinite`;
    track.style.animationDelay = `-${current.phaseMs}ms`;
    scheduleAccessibilitySync();
    // The animation declared on the two lines above does not EXIST until the frame that
    // applies them. The sync just scheduled therefore had nothing to ask and fell back
    // to the wall clock — the one clock that is guaranteed to be wrong here, because the
    // animation is about to lag it by however long that frame takes. Worse, the fallback
    // does not merely mislabel this instant: msUntilNextAccessibilityFlip() then arms the
    // chain against the same wrong phase, so a card can sit on the wrong accessible view
    // for close to a full segment before anything reconsiders.
    //
    // One frame later there is something to ask. This is a single frame per animation
    // start, not per flip, so the "one precisely-timed timer instead of polling" property
    // is untouched.
    clearAnimationStartFrame();
    animationStartFrame = platform.requestAnimationFrame(() => {
      animationStartFrame = null;
      scheduleAccessibilitySync();
    });
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
    get animationStartFrameHandle() {
      return animationStartFrame;
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

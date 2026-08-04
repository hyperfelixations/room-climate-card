// The platform contract, and its single production implementation.
//
// Everything the controllers need from the outside world arrives through this object
// and nothing else: a clock, timeouts, animation frames, the reduced-motion
// preference, document visibility, a ResizeObserver, the font-loading promise, event
// construction, and one transform read. That list is deliberately closed. A general
// `window` handed around as a service locator would make every controller able to
// reach anything, which is exactly what makes a controller untestable.
//
// THE CONTRACT
//
//   now()                          -> milliseconds since the epoch
//   setTimeout(fn, ms)             -> an OPAQUE handle, or null
//   clearTimeout(handle)           -> void
//   requestAnimationFrame(fn)      -> an OPAQUE handle, or null
//   cancelAnimationFrame(handle)   -> void
//   prefersReducedMotion()         -> boolean
//   isDocumentHidden()             -> boolean
//   onVisibilityChange(listener)   -> unsubscribe function
//   createResizeObserver(callback) -> observer, or null when unsupported
//   fontsReady()                   -> Promise, or null when unsupported
//   createEvent(type, init)        -> an Event from the card's own realm
//   readTranslateXPx(element)      -> the element's current translate X in CSS
//                                     pixels, or null when it cannot be read
//   readAnimationPhase(element, name)
//                                  -> {phaseMs, cycleMs} of the named CSS animation
//                                     running on the element, or null
//
// A test substitutes a fake with the same shape and gets a deterministic controller.
// createFakePlatform() lives in the test suite, not here: production must not ship a
// second implementation, and a fake that lives next to its tests can be as
// inspectable as those tests need.
//
// ON REALMS, and the distinction that matters.
//
// There are two different questions, and answering both the same way is a bug:
//
//   "which realm should this NEW capability come from?"  -> the CURRENT one
//   "which realm should this EXISTING handle be cancelled in?" -> the one that made it
//
// The adapter therefore resolves its document on every call through the thunk it was
// given, never once at construction: a card can be adopted into another document —
// moved between dashboards, re-parented by a view transition — and an adapter that had
// captured the original document would keep scheduling timers, reading visibility and
// constructing events in a realm the card no longer lives in.
//
// But a timer handle is just a number, and it is only meaningful to the window that
// issued it. Cancelling it against a DIFFERENT window either does nothing — leaving a
// callback to fire into an adopted card — or, worse, cancels an unrelated timer that
// happens to have the same number there. Timeout and animation-frame handles are
// therefore opaque tokens that carry their own cancellation, bound to the realm that
// created them. Nothing outside this file may look inside one.

// Reading the transform needs BOTH the element's computed style and its realm's
// DOMMatrixReadOnly. Doing it here keeps the only two realm-bound globals the carousel
// needs in the one module that is allowed to touch them.
function readTranslateXPx(element) {
  if (!element) return null;
  const view = element.ownerDocument?.defaultView;
  if (!view) return null;
  try {
    const transform = view.getComputedStyle(element).transform;
    if (!transform || transform === "none") return null;
    return new view.DOMMatrixReadOnly(transform).m41;
  } catch (_error) {
    // A browser without DOMMatrixReadOnly, or an unparsable transform. The caller has
    // a value-derived fallback; guessing here would be worse than saying "unknown".
    return null;
  }
}

// Where the named CSS animation ACTUALLY is, read from the animation's own clock
// rather than from the wall clock the card used to start it.
//
// The two are not the same, and the difference is not noise. The track is started with
// `animation-delay: -phaseMs`, where phaseMs is read from the wall clock — but the
// animation only begins with the frame that applies that declaration. Whatever time
// passes in between becomes a CONSTANT offset for the whole lifetime of that animation:
// measured at ~23 ms on a fast machine, and unbounded on a slow one, because it is
// simply how long that first frame took. Anything that has to agree with what the user
// can SEE therefore has to ask the animation, not the clock.
//
// Returns the cycle length alongside the phase on purpose. A running animation can
// still carry the PREVIOUS timing configuration for a moment after `rotation_seconds`
// changes, and a phase is meaningless without the cycle it belongs to; the caller
// compares the two and falls back rather than reading the new schedule at the old
// animation's phase.
function readAnimationPhase(element, animationName) {
  if (typeof element?.getAnimations !== "function") return null;
  try {
    const animation = element.getAnimations().find((candidate) => candidate.animationName === animationName);
    const timing = animation?.effect?.getComputedTiming?.();
    const cycleMs = Number(timing?.duration);
    const progress = timing?.progress;
    if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
    if (!Number.isFinite(cycleMs) || cycleMs <= 0) return null;
    return { phaseMs: progress * cycleMs, cycleMs };
  } catch (_error) {
    // A realm without the Web Animations API, or an animation the browser will not
    // describe. The caller keeps its wall-clock answer, which is what every version
    // before this one used unconditionally.
    return null;
  }
}

export function createBrowserPlatform(getDocument) {
  const documentOf = () => getDocument() || null;
  const viewOf = () => documentOf()?.defaultView || null;

  return {
    now: () => Date.now(),

    setTimeout(fn, ms) {
      const view = viewOf();
      if (!view) return null;
      const id = view.setTimeout(fn, ms);
      // The closure is the handle. It holds the window that issued the id, so cancelling
      // works even after the card has been adopted into another document.
      return { cancel: () => view.clearTimeout(id) };
    },
    clearTimeout(handle) {
      handle?.cancel?.();
    },

    requestAnimationFrame(fn) {
      const view = viewOf();
      if (!view) return null;
      const id = view.requestAnimationFrame(fn);
      return { cancel: () => view.cancelAnimationFrame(id) };
    },
    cancelAnimationFrame(handle) {
      handle?.cancel?.();
    },

    // Mirrors the CSS media query in JavaScript, so a reduced-motion user avoids the
    // timers as well as the animation. Optional-chained: a browser or test realm
    // without matchMedia degrades to "no preference", which is the safe reading.
    prefersReducedMotion: () => Boolean(viewOf()?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches),

    isDocumentHidden: () => Boolean(documentOf()?.hidden),

    onVisibilityChange: (listener) => {
      const target = documentOf();
      if (!target) return () => {};
      target.addEventListener("visibilitychange", listener);
      // The unsubscribe closes over the document that was actually subscribed to — the
      // same realm rule as the timer handles. Returning it rather than exposing a
      // remove* twin means a caller cannot detach a listener it did not attach, and
      // cannot forget which arguments the pair has to agree on.
      return () => target.removeEventListener("visibilitychange", listener);
    },

    // null rather than a stub when unsupported: the caller has to decide what a card
    // without resize observation does, and a silently inert observer would hide that.
    createResizeObserver: (callback) => {
      const view = viewOf();
      if (!view || typeof view.ResizeObserver !== "function") return null;
      return new view.ResizeObserver(callback);
    },

    fontsReady: () => documentOf()?.fonts?.ready ?? null,

    createEvent: (type, init) => {
      const view = viewOf();
      // The realm matters: an Event constructed from another realm does not pass
      // `instanceof` checks in the listener's own realm, which is how a cross-document
      // card would silently stop dispatching actions.
      const EventConstructor = view?.Event ?? Event;
      return new EventConstructor(type, init);
    },

    readTranslateXPx,
    readAnimationPhase,
  };
}

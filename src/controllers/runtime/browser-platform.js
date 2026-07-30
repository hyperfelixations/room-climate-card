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
//   setTimeout(fn, ms)             -> handle
//   clearTimeout(handle)           -> void
//   requestAnimationFrame(fn)      -> handle
//   cancelAnimationFrame(handle)   -> void
//   prefersReducedMotion()         -> boolean
//   isDocumentHidden()             -> boolean
//   onVisibilityChange(listener)   -> unsubscribe function
//   createResizeObserver(callback) -> observer, or null when unsupported
//   fontsReady()                   -> Promise, or null when unsupported
//   createEvent(type, init)        -> an Event from the card's own realm
//   readTranslateXPx(element)      -> the element's current translate X in CSS
//                                     pixels, or null when it cannot be read
//
// A test substitutes a fake with the same shape and gets a deterministic controller.
// createFakePlatform() lives in the test suite, not here: production must not ship a
// second implementation, and a fake that lives next to its tests can be as
// inspectable as those tests need.
//
// ON REALMS. The adapter resolves its document on EVERY call through the thunk it was
// given, never once at construction. A card can be adopted into another document —
// moved between dashboards, re-parented by a view transition — and an adapter that
// had captured the original document would keep scheduling timers, reading visibility
// and constructing events in a realm the card no longer lives in. Resolving late costs
// one property read and cannot go stale.

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

export function createBrowserPlatform(getDocument) {
  const documentOf = () => getDocument() || null;
  const viewOf = () => documentOf()?.defaultView || null;

  return {
    now: () => Date.now(),

    setTimeout: (fn, ms) => viewOf()?.setTimeout(fn, ms) ?? null,
    clearTimeout: (handle) => {
      if (handle !== null && handle !== undefined) viewOf()?.clearTimeout(handle);
    },

    requestAnimationFrame: (fn) => viewOf()?.requestAnimationFrame(fn) ?? null,
    cancelAnimationFrame: (handle) => {
      if (handle !== null && handle !== undefined) viewOf()?.cancelAnimationFrame(handle);
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
      // Returning the unsubscribe rather than exposing a remove* twin means a caller
      // cannot detach a listener it did not attach, and cannot forget which arguments
      // the pair has to agree on.
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
  };
}

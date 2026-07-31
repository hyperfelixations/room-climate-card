// Everything that re-measures the card after the card itself did nothing.
//
// Two triggers, both outside the data flow. A container resize — a sidebar toggling, a
// dashboard column reflowing, a device rotating — changes the rendered width without
// any entity changing, and the labels are positioned in pixels against that width.
// Web fonts finishing loading does the same thing: the first synchronous measurement
// on a cold dashboard reload runs against fallback-font metrics, which produce a
// slightly wrong position that looks like an overlap until something else happens to
// re-render.
//
// Both are handled here rather than in the element, because both need the same three
// things and all three come from the platform: an observer, an animation frame to
// coalesce onto, and a promise. And both need to be undone on disconnect, which is the
// part that is easy to get wrong when it lives next to a render pipeline.

// What has happened to the current document's fonts.ready promise. One tiny state
// machine per SOURCE, because "have we measured yet" and "which promise was that" are
// two different questions and answering them with one boolean loses the case that
// matters: the promise settled while the card was out of the DOM.
const FONTS = {
  PENDING: "pending", // subscribed, still loading
  DEFERRED: "deferred", // settled, but the card was disconnected — owed one measurement
  MEASURED: "measured", // settled and measured; nothing further is owed
  REJECTED: "rejected", // settled as a failure; never retried for this source
};

export function createResizeRuntime({ platform, onMeasure }) {
  let observer = null;
  let frameHandle = null;
  // The fonts.ready promise this runtime is subscribed to, and what became of it. Keyed
  // on the promise itself rather than on a flag, so a card adopted into another document
  // subscribes to its NEW source exactly once and a settled promise from the document it
  // left can never measure the card it no longer belongs to.
  let fontsSource = null;
  let fontsState = null;

  function cancelPendingFrame() {
    if (frameHandle !== null) {
      platform.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
  }

  return {
    // Safe to call repeatedly: an already-connected runtime is a no-op, and a platform
    // without ResizeObserver simply stays unobserved rather than pretending.
    connect(element) {
      if (observer || !element) return;
      observer = platform.createResizeObserver(() => {
        // A resize drag fires many callbacks per second. Coalescing onto a single
        // animation frame is what keeps that from turning into one layout pass per
        // callback — and re-measuring more than once per frame could not change the
        // result anyway.
        if (frameHandle !== null) return;
        frameHandle = platform.requestAnimationFrame(() => {
          frameHandle = null;
          onMeasure();
        });
      });
      if (!observer) return;
      // Observes the element the caller passes — the card host, which survives every
      // structural rebuild. Observing something inside the shadow root would need
      // re-observing after each rebuild.
      observer.observe(element);
    },

    disconnect() {
      cancelPendingFrame();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },

    // Measures once the web font has actually loaded — and exactly once per source.
    //
    // Three wrong answers this replaces, in the order they were wrong:
    //
    //   once per rebuild:  a fresh .then() on every rebuild before the fonts land would
    //                      each capture that call's own state, and a stale one could
    //                      re-apply an old measurement after a newer render;
    //   once ever:         a card adopted into another document gets a DIFFERENT
    //                      fonts.ready whose loading state has nothing to do with the
    //                      one subscribed to;
    //   once per promise:  correct about identity, but silently loses the measurement
    //                      when the promise settles while the card is disconnected —
    //                      nothing measures then, and the stored identity blocks any
    //                      retry after the reconnect.
    //
    // So the source carries a state, and a settled-while-disconnected source stays OWED
    // one measurement until the card is back.
    measureOnceFontsReady(isStillConnected) {
      const ready = platform.fontsReady();
      if (!ready) return; // no Fonts API: a clean no-op, not an error

      if (ready !== fontsSource) {
        // A new realm's source supersedes whatever the old one was waiting for. The old
        // promise may still settle; its handler checks identity and does nothing.
        fontsSource = ready;
        fontsState = FONTS.PENDING;
        ready.then(
          () => {
            if (fontsSource !== ready) return; // superseded while loading
            if (isStillConnected()) {
              fontsState = FONTS.MEASURED;
              onMeasure();
              return;
            }
            // Settled while the card was out of the DOM. Measuring now would be work on
            // a detached node; the debt is remembered instead.
            fontsState = FONTS.DEFERRED;
          },
          () => {
            if (fontsSource === ready) fontsState = FONTS.REJECTED;
          }
        );
        return;
      }

      // Same source as before. The only thing left to do is settle an outstanding debt —
      // which is what a reconnect looks like from here.
      if (fontsState === FONTS.DEFERRED && isStillConnected()) {
        fontsState = FONTS.MEASURED;
        onMeasure();
      }
    },

    // For tests and diagnostics: which of the four states the current source is in, or
    // null when there is no source. Reading it changes nothing.
    fontsStateForCurrentSource: () => fontsState,

    hasPendingFrame: () => frameHandle !== null,
    isObserving: () => observer !== null,
  };
}

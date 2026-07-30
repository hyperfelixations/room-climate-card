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

export function createResizeRuntime({ platform, onMeasure }) {
  let observer = null;
  let frameHandle = null;
  let fontsSubscribed = false;

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

    // Subscribes exactly once per card instance, not once per rebuild: a fresh .then()
    // on every rebuild that happens before fonts finish would each capture that call's
    // own state and could re-apply a stale measurement after a newer render already
    // ran. A no-op in the common case where fonts were already ready, and on a platform
    // without the Fonts API at all.
    measureOnceFontsReady(isStillConnected) {
      if (fontsSubscribed) return;
      const ready = platform.fontsReady();
      if (!ready) return;
      fontsSubscribed = true;
      ready
        .then(() => {
          if (isStillConnected()) onMeasure();
        })
        .catch(() => {});
    },

    hasPendingFrame: () => frameHandle !== null,
    isObserving: () => observer !== null,
  };
}

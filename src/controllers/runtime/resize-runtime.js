// Owns remeasurement from container resize and web-font settlement outside data updates.
// Platform supplies observer/frame/promise capabilities; disconnect clears owned resources.

// Per-source fonts.ready state preserves measurement debt across disconnect.
const FONTS = {
  PENDING: "pending", // subscribed, still loading
  DEFERRED: "deferred", // settled, but the card was disconnected — owed one measurement
  MEASURED: "measured", // settled and measured; nothing further is owed
  REJECTED: "rejected", // settled as a failure; never retried for this source
};

export function createResizeRuntime({ platform, onMeasure }) {
  let observer = null;
  let frameHandle = null;
  // Promise identity prevents an adopted card's stale document from measuring it.
  let fontsSource = null;
  let fontsState = null;

  function cancelPendingFrame() {
    if (frameHandle !== null) {
      platform.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }
  }

  return {
    // Idempotent; missing ResizeObserver leaves the runtime unobserved.
    connect(element) {
      if (observer || !element) return;
      observer = platform.createResizeObserver(() => {
        // Coalesce resize bursts into one measurement per frame.
        if (frameHandle !== null) return;
        frameHandle = platform.requestAnimationFrame(() => {
          frameHandle = null;
          onMeasure();
        });
      });
      if (!observer) return;
      // Observe the host, which survives structural shadow-root rebuilds.
      observer.observe(element);
    },

    disconnect() {
      cancelPendingFrame();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    },

    // Measure exactly once per font source; settlement while detached remains owed until reconnect.
    measureOnceFontsReady(isStillConnected) {
      const ready = platform.fontsReady();
      if (!ready) return; // Missing Fonts API is a clean no-op.

      if (ready !== fontsSource) {
        // A new realm supersedes the old source; identity guards stale settlement.
        fontsSource = ready;
        fontsState = FONTS.PENDING;
        ready.then(
          () => {
            if (fontsSource !== ready) return; // Superseded while loading.
            if (isStillConnected()) {
              fontsState = FONTS.MEASURED;
              onMeasure();
              return;
            }
            // Remember rather than measure against detached markup.
            fontsState = FONTS.DEFERRED;
          },
          () => {
            if (fontsSource === ready) fontsState = FONTS.REJECTED;
          }
        );
        return;
      }

      // Reconnect settles outstanding debt for the same source.
      if (fontsState === FONTS.DEFERRED && isStillConnected()) {
        fontsState = FONTS.MEASURED;
        onMeasure();
      }
    },

    // Read-only diagnostics; null means no source.
    fontsStateForCurrentSource: () => fontsState,

    hasPendingFrame: () => frameHandle !== null,
    isObserving: () => observer !== null,
  };
}

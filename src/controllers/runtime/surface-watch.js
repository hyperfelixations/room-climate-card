// Supplies render occasions for surface changes that push neither state nor configuration.
// It knows no colour: render signatures compare the platform's fresh surface reading.
// Sources are colour-scheme changes, unfiltered root attributes (never subtree), and this
// card's filtered style/class attributes. Event bursts coalesce onto one animation frame;
// polling is intentionally absent. See internal dev doc §5 "Wann die Karte erneut fragt".

export function createSurfaceWatch({ platform, onChange }) {
  let unlistenColorScheme = null;
  let observer = null;
  let pendingFrame = null;

  // The frame handle also marks an already-scheduled question.
  function schedule() {
    if (pendingFrame) return;
    pendingFrame = platform.requestAnimationFrame(() => {
      pendingFrame = null;
      onChange();
    });
  }

  function disconnect() {
    unlistenColorScheme?.();
    unlistenColorScheme = null;
    observer?.disconnect();
    observer = null;
    // Never fire a pending question into a detached card.
    if (pendingFrame) platform.cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }

  return {
    // Re-observe replaces all subscriptions; Home Assistant may reconnect one element instance.
    observe(element) {
      disconnect();
      const root = element?.ownerDocument?.documentElement;
      if (!root) return;

      unlistenColorScheme = platform.onColorSchemeChange(schedule);

      // Missing MutationObserver removes one trigger; the ordinary render path still re-reads.
      observer = platform.createMutationObserver(schedule);
      if (!observer) return;
      observer.observe(root, { attributes: true });
      observer.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    },

    disconnect,
  };
}

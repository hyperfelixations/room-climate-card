// Supplies render occasions for surface changes that push neither state nor configuration.
// It knows no colour: render signatures compare the platform's fresh surface reading.
// Sources are colour-scheme changes, unfiltered root attributes (never subtree), this card's
// filtered style/class attributes, and stylesheets other modules (card-mod) place inside the
// card: the containers' child lists, and a subtree only on the foreign nodes in them. Event
// bursts coalesce onto one animation frame; polling is intentionally absent. See internal dev
// doc §5 "Render-Auslöser bei Themewechsel".

export function createSurfaceWatch({ platform, onChange, getStyleContainers, getForeignNodes }) {
  let unlistenColorScheme = null;
  let observer = null;
  let pendingFrame = null;
  let target = null;

  // The frame handle also marks an already-scheduled question.
  function schedule() {
    if (pendingFrame) return;
    pendingFrame = platform.requestAnimationFrame(() => {
      pendingFrame = null;
      onChange();
    });
  }

  // MutationObserver cannot drop one target, so every change of what is foreign subscribes anew.
  function subscribe() {
    observer.disconnect();
    observer.observe(target.ownerDocument.documentElement, { attributes: true });
    observer.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
    for (const container of getStyleContainers()) observer.observe(container, { childList: true });
    for (const node of getForeignNodes()) {
      observer.observe(node, { attributes: true, characterData: true, childList: true, subtree: true });
    }
  }

  function onMutations(records) {
    const containers = getStyleContainers();
    if (records.some((record) => record.type === "childList" && containers.includes(record.target))) subscribe();
    schedule();
  }

  function disconnect() {
    unlistenColorScheme?.();
    unlistenColorScheme = null;
    observer?.disconnect();
    observer = null;
    target = null;
    // Never fire a pending question into a detached card.
    if (pendingFrame) platform.cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }

  return {
    // Re-observe replaces all subscriptions; Home Assistant may reconnect one element instance.
    observe(element) {
      disconnect();
      if (!element?.ownerDocument?.documentElement) return;

      unlistenColorScheme = platform.onColorSchemeChange(schedule);

      // Missing MutationObserver removes one trigger; the ordinary render path still re-reads.
      observer = platform.createMutationObserver(onMutations);
      if (!observer) return;
      target = element;
      subscribe();
    },

    disconnect,
  };
}

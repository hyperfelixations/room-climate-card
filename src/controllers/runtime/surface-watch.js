// WHEN TO ASK AGAIN WHAT THE CARD IS STANDING ON.
//
// The card reads its background on every render and carries that reading in its data
// signature, so a background change is picked up by any render that happens after it. What
// this supplies is the OCCASION to render when nothing else would: a dashboard switched from
// light to dark pushes no state and changes no configuration, so without this the card kept
// the palette of a background it was no longer on until an unrelated update happened along.
//
// IT KNOWS NOTHING ABOUT COLOUR, and that is the point. It cannot decide that the background
// changed — it says "ask again", and the data signature answers with a string comparison. The
// knowledge of what a background is already lives in one place (paint-roles.js, read through
// the platform adapter); a second opinion here would be a second place for it to drift, and
// the two would disagree exactly when it mattered.
//
// THREE SOURCES, ONE QUESTION.
//
//   the colour-scheme media query   the browser's or the operating system's own switch, which
//                                   is what a Home Assistant theme set to "auto" follows
//   the root element's attributes   Home Assistant applies a theme by writing its custom
//                                   properties into `document.documentElement.style`; other
//                                   hosts flip a class or a data attribute. Unfiltered on
//                                   purpose — that one element's attributes change so rarely
//                                   that filtering would buy nothing and could miss the one
//                                   that mattered — but never with `subtree`, which on a
//                                   dashboard would be a firehose.
//   the card element's attributes   a card-mod rule that colours THIS card. Filtered to
//                                   `style` and `class`, because a card element's other
//                                   attributes change during ordinary rendering.
//
// NO TIMER. A poll would spend a getComputedStyle every interval forever to catch something
// that happens twice a day. Everything here is an event, and the answer to a burst of them is
// ONE animation frame: a theme switch writes dozens of custom properties one after another,
// and asking once per property would turn one change into dozens of identical questions.

export function createSurfaceWatch({ platform, onChange }) {
  let unlistenColorScheme = null;
  let observer = null;
  let pendingFrame = null;

  // Coalesce. The frame handle doubles as the "already asked" flag, so a second signal
  // arriving in the same frame is free rather than merely idempotent.
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
    // A frame that survives the disconnect would fire into a card that has left the document.
    if (pendingFrame) platform.cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }

  return {
    // Idempotent by construction: observing again lets the previous subscription go first.
    // connectedCallback can run more than once for the same element — Home Assistant moves
    // cards between dashboards — and two live subscriptions would mean two questions per
    // switch and one listener nobody holds the handle for.
    observe(element) {
      disconnect();
      const root = element?.ownerDocument?.documentElement;
      if (!root) return;

      unlistenColorScheme = platform.onColorSchemeChange(schedule);

      // Null where the realm has no MutationObserver. The card still renders, and the
      // ordinary render path still catches the change on the next update — one source less,
      // not a failure.
      observer = platform.createMutationObserver(schedule);
      if (!observer) return;
      observer.observe(root, { attributes: true });
      observer.observe(element, { attributes: true, attributeFilter: ["style", "class"] });
    },

    disconnect,
  };
}

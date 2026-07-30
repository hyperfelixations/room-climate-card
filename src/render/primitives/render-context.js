// The RenderContext: the only way a render module reaches the DOM.
//
// Deliberately tiny. It carries the two things that genuinely vary by realm — the
// document the card lives in and that document's window — plus the two element
// operations derived from them. Nothing else: not the custom element, not hass, not
// the configuration, not a domain service, not controller state, and no timer or
// clock. A renderer that could reach any of those could change what the card shows
// after being asked to render one view model, which is exactly the shape this
// refactoring exists to remove.
//
// Escaping is NOT injected. There is exactly one escaping function in the card
// (core/text.js), it is pure, and every render module imports it directly — routing
// it through a context would suggest a call site could be handed a different one.
//
// The full platform contract (timers, the clock, events, ResizeObserver,
// requestAnimationFrame) belongs to the controller layer and is defined in its own
// round. This context covers only what DOM creation and layout measurement need.

export function createRenderContext(ownerDocument) {
  return {
    ownerDocument,
    // Read once, on creation: a detached document has no defaultView, and failing
    // here is far easier to diagnose than an undefined dereference deep in a layout
    // pass.
    defaultView: ownerDocument.defaultView,
    createElement: (tagName) => ownerDocument.createElement(tagName),
    htmlToElement: (html) => htmlToElementIn(ownerDocument, html),
  };
}

// Parses an already-escaped HTML string (the output of one of the render functions
// in this directory) into a single detached element.
//
// This is the ONLY place the update path parses HTML, and only ever for genuinely
// NEW nodes — a room appearing, an element's shape changing. An existing node that
// merely needs new content is patched in place with setAttribute/textContent
// instead. Reusing the same already-escaped builders is what keeps one description
// of each element's markup rather than two that can drift.
export function htmlToElementIn(ownerDocument, html) {
  const wrapper = ownerDocument.createElement("div");
  wrapper.innerHTML = html.trim();
  return wrapper.firstElementChild;
}

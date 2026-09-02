// Realm-local DOM creation/layout context; it exposes no element, hass, config, state or clock.
// Pure escaping is imported directly; controller-only platform capabilities stay outside rendering.

export function createRenderContext(ownerDocument) {
  return {
    ownerDocument,
    // Capture realm failure at context creation, not deep in a layout pass.
    defaultView: ownerDocument.defaultView,
    createElement: (tagName) => ownerDocument.createElement(tagName),
    htmlToElement: (html) => htmlToElementIn(ownerDocument, html),
  };
}

// Parse already-escaped renderer output only for new/replacement nodes; patch existing nodes in place.
export function htmlToElementIn(ownerDocument, html) {
  const wrapper = ownerDocument.createElement("div");
  wrapper.innerHTML = html.trim();
  return wrapper.firstElementChild;
}

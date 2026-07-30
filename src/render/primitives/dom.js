// The two DOM reads that must not go through a global.
//
// A card can be rendered into a document that is not the ambient one — a second
// dashboard realm, a test harness with its own jsdom instance. Reading
// `window.getComputedStyle` would silently mix realms: the style resolved would
// belong to a different document than the element measured. Both helpers below take
// the element and derive its own realm from it.

export function computedStyleOf(element) {
  return element.ownerDocument.defaultView.getComputedStyle(element);
}

// The element's rendered width in CSS pixels. Every layout decision in
// render/layout/ is expressed in these, because a percentage cannot know how wide a
// label's text is.
export function measuredWidth(element) {
  return element.getBoundingClientRect().width;
}

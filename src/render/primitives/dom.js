// Realm-safe DOM reads derive all globals from the measured element's owner document.

export function computedStyleOf(element) {
  return element.ownerDocument.defaultView.getComputedStyle(element);
}

// Rendered CSS-pixel width for text-aware layout decisions.
export function measuredWidth(element) {
  return element.getBoundingClientRect().width;
}

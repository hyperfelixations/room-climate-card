// Realm-safe DOM reads derive all globals from the measured element's owner document.

export function computedStyleOf(element) {
  return element.ownerDocument.defaultView.getComputedStyle(element);
}

// Rendered CSS-pixel width for text-aware layout decisions.
export function measuredWidth(element) {
  return element.getBoundingClientRect().width;
}

// Whether an element's content is wider than its own box, so it clips or ellipsizes.
export function overflowsBox(element) {
  return element.scrollWidth > element.clientWidth;
}

// Writes that leave an element alone when it already holds the value: a patch with an
// unchanged view model queues no DOM mutation. Each one stores what its DOM setter would.

export function setText(element, text) {
  const value = text == null ? "" : String(text);
  if (element.textContent !== value) element.textContent = value;
}

export function setAttr(element, name, value) {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

// `name` is the CSS property name ("max-width", "--room-color"); "" removes the declaration.
export function setStyleProperty(element, name, value) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

export function setHidden(element, hidden) {
  if (element.hidden !== hidden) element.hidden = hidden;
}

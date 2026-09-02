// Choose canonical long or short text from actual rendered width on every layout pass.
// Always retry long first; callers apply ellipsis only after the short form also fails.

import { measuredWidth } from "../primitives/dom.js";

export function resolveLabelForm(element, longText, shortText, fitsWithWidth) {
  element.textContent = longText;
  // Identical forms avoid the extra fit measurement/reflow.
  if (longText === shortText) return measuredWidth(element);
  const longWidth = measuredWidth(element);
  if (fitsWithWidth(longWidth)) return longWidth;
  element.textContent = shortText;
  return measuredWidth(element);
}

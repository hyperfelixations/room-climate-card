// Choose a label's form from its actual rendered width on every layout pass.
// Forms come widest first (long, short, compact); a missing form, or one equal to the form
// before it, is not a candidate. Always starts again from the first, so a label widens back
// when room returns; callers apply ellipsis only after the last form also fails.

import { measuredWidth, setText } from "../primitives/dom.js";

// The width of the first candidate that fits; the last one is kept without asking, since
// nothing is left to fall back to.
export function resolveLabelForm(element, forms, fitsWithWidth) {
  const candidates = [];
  for (const form of forms) if (form != null && form !== candidates.at(-1)) candidates.push(form);
  for (const [index, form] of candidates.entries()) {
    setText(element, form);
    const width = measuredWidth(element);
    if (index === candidates.length - 1 || fitsWithWidth(width)) return width;
  }
  return 0;
}

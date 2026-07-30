// Long form or short form: decided at measure time, never in the translations.
//
// A collision-prone label is not permanently shortened for every language and every
// card width. Instead both a canonical long form and a short fallback exist, and the
// card picks between them here against the ACTUAL rendered width — the same way the
// position resolvers measure real geometry rather than guessing from character
// counts.
//
// The long form is always tried FIRST, and reverted to whenever there is room again.
// This runs on every resolve pass — resize, font-ready, every data update — so
// growing the card back out restores the long form on the very next pass rather than
// staying shortened until a reload.
//
// The short form is a deliberate intermediate step BEFORE the CSS ellipsis fallback
// the caller applies when even the short form does not fit: a real word beats a
// truncated one whenever a real word fits.

import { measuredWidth } from "../primitives/dom.js";

export function resolveLabelForm(element, longText, shortText, fitsWithWidth) {
  element.textContent = longText;
  // Most languages have no distinct short form. Short-circuiting here is what keeps
  // them from paying for the extra reflows the fits() closure would trigger.
  if (longText === shortText) return measuredWidth(element);
  const longWidth = measuredWidth(element);
  if (fitsWithWidth(longWidth)) return longWidth;
  element.textContent = shortText;
  return measuredWidth(element);
}

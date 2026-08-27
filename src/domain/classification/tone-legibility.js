// THE SECOND REPAIR, and it never touches a colour.
//
// A palette colour lands in seven places, and three of them paint it on a tint of ITSELF: the
// status pill, the header icon and a room chip's direction mark. As the colour approaches the
// card, foreground and background approach each other, because both are converging on the same
// place — `palette: lime` on a light dashboard is the case that made this visible, with the
// scale markers perfectly readable and "Optimal" in the top right not.
//
// THE COLOUR IS NOT WHAT IS WRONG THERE. It is the recipe. There is exactly one colour per
// score on the card — the marker, the accent line, the pill, the icon, the chip mark and the
// chip's own fill are all that one colour — and moving it because a 20% tint of it swallowed
// it would be repairing the wrong thing, twice over: it would change the ramp everywhere to
// fix one place, and it would do so for a reason the ramp has no control over.
//
// So what moves is the TINT. The separation between a colour and an alpha-blend of itself over
// a backdrop is, near enough, `(1 - alpha)` times the separation between the colour and the
// backdrop: lower the alpha and the pill's own background gets out of the way. Measured over
// nineteen palettes on the two backgrounds Home Assistant ships, that is enough for 161 of the
// places that could not be read, and the median correction is from 0.20 down to 0.11 — a
// change nobody would notice looking at one card, and the difference between reading a word
// and not.
//
// WHAT IT CANNOT DO, said plainly. At alpha 0 the pill has no tint at all and the colour sits
// on the card itself, so the best this can ever reach is the separation the colour has from
// the card — and the pill asks for nearly half again what a scale marker does, because it is
// twelve-pixel text rather than a solid bar. A colour between those two bars is readable as a
// marker and not as a word, and no alpha closes that. Measured, 184 places on the two canonical
// backgrounds stay out of reach, nearly all of them the pale wing of a ramp derived from a
// colour that is itself nearly the colour of the card.

import { compositeOver } from "../../core/color.js";
import { screenDistance } from "../../core/oklch.js";

// The alpha search is a bisection over a monotone quantity, and 20 halvings take it far below
// what an eight-bit channel can express.
const BISECTION_STEPS = 20;

// HOW PRECISELY AN ALPHA IS WORTH WRITING DOWN. A thousandth, and it is rounded DOWNWARDS.
//
// The number ends up in a CSS custom property that the render path and the patch path both
// write, so an unrounded bisection would put twenty digits into the markup and make every diff
// of a rendered card unreadable. A thousandth of alpha is far below what compositing eight-bit
// channels can express — and rounding down rather than to nearest is what keeps the rounded
// value on the side that still clears, because less tint is always more separation.
const ALPHA_PRECISION = 1000;
const roundedDown = (alpha) => Math.floor(alpha * ALPHA_PRECISION) / ALPHA_PRECISION;

// HOW FAR THE TINT MAY BE TAKEN DOWN. Zero, and that is not a shortcut.
//
// The pill and the icon badge both keep a border at 0.38 alpha, so at zero fill they are still
// plainly a pill and a badge rather than loose text; the chip mark keeps its glyph on the chip
// it already sits on. Nothing disappears, so there is no case for stopping short — and stopping
// short would mean choosing a number that leaves something unreadable on purpose.
const ALPHA_FLOOR = 0;

// The alpha at which this colour can be read on a tint of itself over `backdrop`, never above
// the recipe's own default and never below the floor.
//
// Returns the DEFAULT unchanged whenever the default already works, which is the common case
// and the one worth keeping cheap — and it means a card whose colours are comfortable looks
// exactly as it always did.
export function legibleTintAlpha(color, backdrop, defaultAlpha, required) {
  const separationAt = (alpha) => screenDistance(color, compositeOver(color, alpha, backdrop));
  if (separationAt(defaultAlpha) >= required) return defaultAlpha;
  // Even with the tint out of the way it cannot be read. The floor is then the best there is,
  // and it is never worse than the default.
  if (separationAt(ALPHA_FLOOR) < required) return ALPHA_FLOOR;

  let usable = ALPHA_FLOOR;
  let tooMuch = defaultAlpha;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (usable + tooMuch) / 2;
    if (separationAt(middle) >= required) usable = middle;
    else tooMuch = middle;
  }
  return roundedDown(usable);
}

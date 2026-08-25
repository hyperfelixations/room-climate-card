// THE SEAM between deciding that a palette does not suit its background and doing
// something about it.
//
// The decision is settled and lives in ../palette-fit.js. The METHOD is not, and is
// deliberately left open: moving lightness, moving chroma, drifting hue and combinations of
// those are all defensible, they behave differently on different palettes, and choosing
// between them is a judgement about how the card should look rather than a technical one.
// So this file does not choose. It registers methods, applies the chosen one, and states
// what any method must satisfy — which is what makes several of them comparable later.
//
// TODAY THERE IS ONE STRATEGY AND IT DOES NOTHING. That is a deliberate intermediate state,
// and it has a useful property: with `identity` registered, the card renders exactly as it
// did before any of this existed, so every golden image and every characterization baseline
// must be unchanged. Any that moved would be a wiring mistake rather than an expected
// difference.
//
// WHAT EVERY STRATEGY OWES, whatever it moves (each of these is checked against every
// registered strategy in classification-palettes.test.js):
//
//   1  SHAPE. Same number of steps, same wings, valid hex everywhere, same id.
//   2  ORDER. The ramp stays strictly ordered in the same direction it started.
//   3  IDEMPOTENCE. A palette that already fits comes back untouched, and a palette that
//      has been adapted stays put when adapted again.
//   4  POSTCONDITION. What comes back fits — or the strategy says `null`, meaning "not
//      achievable here", which is an answer and not a failure.
//   5  DETERMINISM. Same palette, same background, same result. No state, no clock.
//
// Hue preservation is NOT on that list, and its absence is the point: `palette: yellow`
// should give yellow, but a yellow that cannot be seen is not what the user wanted either.
// Whether a method may bend hue to rescue a step, and how far, is exactly the kind of thing
// the comparison is for.

import { evaluatePaletteFit } from "../palette-fit.js";

// Leaves every palette exactly as written.
//
// Registered rather than special-cased so that "do not adapt at all" is one of the methods
// under comparison and is measured on the same terms as the others.
function identityStrategy(palette) {
  return palette;
}

export const ADAPTATION_STRATEGIES = Object.freeze({
  identity: identityStrategy,
});

export const DEFAULT_ADAPTATION_STRATEGY = "identity";

// WHICH PALETTES THE CARD MAY CHANGE AT ALL.
//
// Only the ones it made itself. A built-in ramp and a ramp calculated from `palette: teal`
// are both the card's own work: the user asked for a look, and keeping that look legible on
// the background they happen to be using is part of delivering it.
//
// A palette written out in YAML is not. When somebody writes
//
//   palette:
//     optimal: black
//     above: [lightgreen, darkgreen, lime]
//     below: [red, deeppink]
//
// every one of those colours is a decision, and quietly moving them would be overruling a
// person who was perfectly explicit. The card does not do that. If the result is hard to
// read on their background, that is theirs to see and theirs to change.
//
// The line is WHERE THE COLOURS CAME FROM, not how they were spelled. `palette: deeppink`
// is a CSS colour name and still an automated palette, because what the user named is a
// colour and what the card built from it is a ramp. The same word inside a written-out
// palette is a chosen step.
export function isAdaptable(palette) {
  return Boolean(palette) && palette.origin !== "custom";
}

// The one call site is buildCardDomainModel(), directly behind paletteOf(config).
//
// `surface` is whatever the card is painted on: one colour for a flat card, the colour stops
// and their interpolations for a gradient, and the theme's own background when nothing else
// could be read — together with the theme's text colour, because several of the places a
// palette colour lands are tints of THAT rather than of the card. Never empty; the reading
// ladder always ends somewhere.
export function adaptPalette(palette, surface, strategyId = DEFAULT_ADAPTATION_STRATEGY) {
  if (!isAdaptable(palette)) return palette;

  const fit = evaluatePaletteFit(palette, surface);
  if (fit.fits) return palette;

  const strategy = ADAPTATION_STRATEGIES[strategyId] || ADAPTATION_STRATEGIES[DEFAULT_ADAPTATION_STRATEGY];
  const adapted = strategy(palette, fit);

  // `null` means the method looked and could not do it — a card sitting on a gradient that
  // runs from white to black contains every lightness, and no fixed ramp is legible over
  // all of it. The user's own palette is then the better answer: poor contrast is at least
  // the thing they asked for, where an arbitrarily bent ramp would be neither legible nor
  // theirs.
  return adapted || palette;
}

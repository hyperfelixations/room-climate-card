// THE SEAM between deciding that a palette does not suit its background and doing something
// about it.
//
// The decision is settled and lives in ../palette-fit.js: can each colour be seen where the
// card paints it on something it does not tint. The METHOD lives in ./legible.js. This file
// owns neither — it registers methods, applies the chosen one, and states what any method must
// satisfy, which is what makes several of them comparable at all.
//
// WHAT EVERY STRATEGY OWES, whatever it moves (each of these is checked against every
// registered strategy in palette-fit.test.js):
//
//   1  SHAPE. Same id, wings that are still wings, valid hex everywhere.
//   2  ORDER. The ramp stays ordered the way it was ordered.
//   3  IDEMPOTENCE. A palette that already fits comes back untouched, and a palette that has
//      been adapted stays put when adapted again.
//   4  POSTCONDITION. What comes back fits — or the strategy says `null`, meaning "not
//      achievable here", which is an answer and not a failure.
//   5  DETERMINISM. Same palette, same background, same result. No state, no clock.
//
// Hue preservation is NOT on that list, and its absence is deliberate: whether a method may
// bend hue to rescue a step is exactly the kind of thing the comparison is for. The method the
// card ships does not bend it, and says so itself.
//
// `identity` stays registered beside the real method. It is what "do not adapt at all" looks
// like, it is measured on the same terms as everything else, and it is the reference any
// future method is compared against.

import { VISIBILITY_THRESHOLD, evaluatePaletteFit, fitKeyFor } from "../palette-fit.js";
import { surfaceOf } from "../paint-roles.js";
import { legibleStrategy } from "./legible.js";

// Leaves every palette exactly as written.
function identityStrategy(palette) {
  return palette;
}

export const ADAPTATION_STRATEGIES = Object.freeze({
  identity: identityStrategy,
  legible: legibleStrategy,
});

export const DEFAULT_ADAPTATION_STRATEGY = "legible";

// WHICH PALETTES THE CARD MAY CHANGE AT ALL.
//
// Only the ones it made itself. A built-in ramp and a ramp calculated from `palette: teal` are
// both the card's own work: the user asked for a look, and keeping that look legible on the
// background they happen to be using is part of delivering it.
//
// A palette written out in YAML is not. When somebody writes
//
//   palette:
//     optimal: black
//     above: [lightgreen, darkgreen, lime]
//     below: [red, deeppink]
//
// every one of those colours is a decision, and quietly moving them would be overruling a
// person who was perfectly explicit. The card does not do that. If the result is hard to read
// on their background, that is theirs to see and theirs to change.
//
// The line is WHERE THE COLOURS CAME FROM, not how they were spelled. `palette: deeppink` is a
// CSS colour name and still an automated palette, because what the user named is a colour and
// what the card built from it is a ramp. The same word inside a written-out palette is a
// chosen step.
export function isAdaptable(palette) {
  return Boolean(palette) && palette.origin !== "custom";
}

// MEMOIZED ON THE QUESTION, and this is not an optimisation that could be dropped.
//
// The card asks this on every render. A real strategy searches — it builds candidate ramps and
// measures them — so it evaluates the fit report many times over, which leaves the report memo
// in ../palette-fit.js holding the LAST CANDIDATE rather than the palette the card started
// from. Without a memo here, every render would therefore pay for the whole search again;
// measured, the searches that have to work hardest cost tens of milliseconds.
//
// Keyed on the same values the report is keyed on, so the two can never disagree about what
// the answer depends on. One slot is enough and nothing accumulates: a card has one palette on
// one surface at a time, and the sequence of calls is that same pair over and over.
let lastAdaptation = null;

// The one call site is buildCardDomainModel(), directly behind paletteOf(config).
//
// `surface` is whatever the card is painted on: one colour for a flat card, the colour stops
// and their interpolations for a gradient, and the theme's own background when nothing else
// could be read — together with the theme's text colour, because several of the places a
// palette colour lands are tints of THAT rather than of the card. Never empty; the reading
// ladder always ends somewhere.
export function adaptPalette(palette, surface, strategyId = DEFAULT_ADAPTATION_STRATEGY) {
  if (!isAdaptable(palette)) return palette;

  const resolved = surfaceOf(surface);
  const key = `${strategyId}|${fitKeyFor(palette, resolved, VISIBILITY_THRESHOLD)}`;
  if (lastAdaptation && lastAdaptation.key === key) return lastAdaptation.value;

  const value = adaptedFor(palette, resolved, strategyId);
  lastAdaptation = { key, value };
  return value;
}

function adaptedFor(palette, surface, strategyId) {
  const fit = evaluatePaletteFit(palette, surface);
  if (fit.fits) return palette;

  const strategy = ADAPTATION_STRATEGIES[strategyId] || ADAPTATION_STRATEGIES[DEFAULT_ADAPTATION_STRATEGY];
  const adapted = strategy(palette, fit);

  // `null` means the method looked and could not do it — a card sitting on a gradient that
  // runs from white to black contains every lightness, and no fixed ramp is legible over all
  // of it. The user's own palette is then the better answer: poor contrast is at least the
  // thing they asked for, where an arbitrarily bent ramp would be neither legible nor theirs.
  return adapted || palette;
}

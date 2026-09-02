// The seam between deciding a palette does not suit its background (../palette-fit.js) and
// doing something about it (the method, ./legible.js). This file registers methods, applies
// the chosen one, and states the contract every method must satisfy — shape, order,
// idempotence, postcondition (fits, or `null` = not achievable here), determinism — which is
// what the shared strategy test suite checks and what makes methods comparable. Hue
// preservation is deliberately NOT in the contract. `identity` stays registered as the
// "do not adapt" reference. See interne Doku §5 „Die Naht zur Transformation".

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

// Which palettes the card may change: only the ones it made itself (`builtin` and `derived`).
// A palette written out in YAML is a set of deliberate choices and is left alone. The line is
// where the colours came from, not how they were spelled. See interne Doku §5 „Welche Paletten
// die Karte überhaupt anfassen darf".
export function isAdaptable(palette) {
  return Boolean(palette) && palette.origin !== "custom";
}

// Memoized on the question, not droppable: a real strategy searches, evaluating the fit report
// many times, so the report memo in ../palette-fit.js ends up holding the last candidate, not
// the starting palette. Without this memo every render pays the whole search again (tens of ms
// for the hardest). Keyed on the same values as the report; one slot (one palette on one
// surface at a time).
let lastAdaptation = null;

// The one call site is buildCardDomainModel(), behind paletteOf(config). `surface` is whatever
// the card is painted on (a colour, a gradient's stops, or the theme background) plus the
// theme text colour; never empty.
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

  // `null` means the method could not do it (a white-to-black gradient contains every
  // lightness). Keep the user's own palette then — poor contrast is at least theirs.
  return adapted || palette;
}

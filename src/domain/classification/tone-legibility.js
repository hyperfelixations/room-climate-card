// THE SECOND REPAIR, and it never moves a palette.
//
// A palette colour lands in seven places, and three of them paint it at full strength on a
// tint of ITSELF: the status pill, the header icon and a room chip's direction mark. As the
// colour approaches the card, foreground and background approach each other, because both are
// converging on the same place — `palette: lime` on a light dashboard is the case that made
// this visible, with the scale markers perfectly readable and "Optimal" in the top right not.
//
// THE COLOUR IS NOT WHAT IS WRONG THERE. It is the recipe. There is exactly one colour per
// score on the card — the marker, the accent line, the chip's own fill and border are all
// that one colour — and moving the palette because a 20% tint of it swallowed it would be
// repairing the wrong thing, twice over: it would change the ramp everywhere to fix one
// place, and it would do so for a reason the ramp has no control over.
//
// ONE MECHANIC, ONE COMPUTATION, ONE RESULT. The three places do not get three answers, and
// they do not get a compromise between three answers. They share one way of being painted, so
// that way is worked out ONCE and the result is applied to all three unchanged. What comes
// out is not a colour per place; it is an ADJUSTMENT:
//
//   ink         the foreground, at the same hue, exactly
//   tintFactor  a factor on the tint weight each place already has
//
// The factor is relative rather than absolute for a reason that is easy to get wrong: the
// pill's tint is 0.20 and the chip mark's is 0.18, and those are two deliberate recipe
// constants. An absolute alpha would have to merge them, which would change the chip mark of
// every card that never had a problem. A factor of 1 leaves every such card bit for bit as it
// was, which is the first thing this has to guarantee.
//
// THE ONE INSTANCE IT IS WORKED OUT ON is the mechanic in its plain form: the colour on a
// tint of itself over the card, at the weight the pill and the icon use. The chip mark's own
// chip adds a further 10% tint underneath, and that belongs to the CHIP's recipe rather than
// to this mechanic — measured, working the answer out on that heavier instance instead moves
// 197 of 444 colours where this one moves 142, and both leave all three places clear. Taking
// the milder instance and asking for a margin above the bar is the cheaper way to the same
// result, and cheaper here means less of the card changes.

import { compositeOver } from "../../core/color.js";
import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";
import { TINT_ALPHAS } from "./paint-roles.js";
import { requiredSeparationOf } from "./palette-fit.js";

// The reference instance, written out: a tint of the colour over the card, at the weight this
// mechanic uses, with whatever the place it is measured on already puts underneath.
const referenceTint = (search, factor) =>
  search.structuralTint + (1 - search.structuralTint) * search.recipeTint * factor;

// WHAT COUNTS AS READABLE, and why there are two numbers rather than one.
//
// The role's own separation is the FLOOR: below it the card is making a claim it cannot keep.
// But a repair that stops exactly there lands on the boundary every time, and a boundary is
// where "passes the arithmetic" and "is comfortable to read" part company. The target is
// therefore above the floor, and how far above was bracketed on rendered cards at 1.00, 1.10,
// 1.20, 1.25, 1.30 and 1.40.
//
// 1.10 is where it stops, and the reason is that it is the FIRST value at which all three
// places clear their own bar — at 1.00 the chip mark still fails 65 times in 386. Every value
// above it buys margin by moving more of the card: 142 colours in 444 move at 1.10, 200 at
// 1.25, 269 at 1.40, and the colours that still look soft at 1.10 look soft because the
// palette colour is nearly the colour of the card, which is a property of the colour the user
// asked for and not something this may overrule.
const COMFORT_OVER_FLOOR = 1.10;

// HOW THE SEARCH MOVES. Three axes, each in whole steps, each in both directions.
//
// The step sizes and the weights together are the exchange rate between the axes, because
// the cost of a candidate is how many weighted steps it took. They were chosen together on
// rendered cards rather than one at a time.
//
//   lightness  additive in Oklch L. 0.02 is about where a step stops being invisible.
//   chroma     MULTIPLICATIVE, which is what keeps an achromatic colour achromatic: a grey
//              has no saturation to scale, so this axis cannot turn one into a coloured
//              thing. An additive step would have done exactly that.
//   tint       a factor on the recipe's own alpha, down to nothing and up to less than
//              double. Both directions matter and the upward one is not an oversight: with a
//              darker ink, a STRONGER tint of the original colour is more contrast, not less,
//              and it keeps the softly coloured pill the card is supposed to have.
//
// The caps are what stops the search from reaching for the trivial answer. Without them the
// cheapest way to make anything readable is a nearly black ink on a nearly opaque tint, which
// passes every threshold and is not this card.
export const TINT_SEARCH = Object.freeze({
  recipeTint: TINT_ALPHAS.toneSoft,
  structuralTint: 0,
  lightnessStep: 0.02,
  lightnessCap: 10,
  chromaStep: 0.08,
  chromaCap: 6,
  tintStep: 0.125,
  tintCapDown: 8,
  tintCapUp: 6,
  tintWeight: 4,
  comfort: COMFORT_OVER_FLOOR,
});

// The identity answer, shared rather than rebuilt: a card whose colours are comfortable is
// the common case, and it must be able to prove it changed nothing.
const unchanged = (color) => Object.freeze({ ink: color, tintFactor: 1 });

// Every combination the search may make, cheapest first — and "cheapest" is the whole of the
// objective, so the first candidate that reads comfortably is the answer.
//
// Cost is the weighted number of steps. The weights are what the boards decided: a lightness
// step and a chroma step cost one, and a TINT step costs four, because thinning the pill's
// fill turns out to be a bigger visual change than darkening its text. Priced at one, the
// search reached for the tint first and produced a nearly white pill with dark text where a
// slightly darker text on the card's own soft fill was both prettier and just as readable.
// Priced at four it spends the tint only where the ink alone cannot get there — which, on the
// two shipped themes, is one colour in 444, and on an arbitrarily coloured dashboard is 80.
function* candidatesByCost(search) {
  const maxCost =
    search.lightnessCap + search.chromaCap + search.tintWeight * Math.max(search.tintCapDown, search.tintCapUp);
  for (let cost = 0; cost <= maxCost; cost += 1) {
    for (let tint = -search.tintCapDown; tint <= search.tintCapUp; tint += 1) {
      const afterTint = cost - search.tintWeight * Math.abs(tint);
      if (afterTint < 0) continue;
      for (let chroma = -search.chromaCap; chroma <= search.chromaCap; chroma += 1) {
        const afterChroma = afterTint - Math.abs(chroma);
        if (afterChroma < 0) continue;
        // Whatever is left goes into lightness, in both directions, and nowhere else — so
        // every candidate is emitted exactly once, at exactly its own cost.
        if (afterChroma > search.lightnessCap) continue;
        for (const lightness of afterChroma === 0 ? [0] : [afterChroma, -afterChroma]) {
          yield { lightness, chroma, tint };
        }
      }
    }
  }
}

// THE ANSWER: the smallest visible change, at the same hue, that makes the mechanic
// comfortable to read — or, when nothing within the caps manages that, the change within them
// that gets furthest. Never worse than doing nothing, and never a different colour.
export function legibleTintRecipe(color, card, search = TINT_SEARCH) {
  if (!color || !card) return unchanged(color);
  const target = requiredSeparationOf("chipMark") * search.comfort;
  const base = hexToOklch(color);

  // The ink depends on two of the three axes, so it is built once per pair and reused across
  // every tint. Without this the search converts the same handful of Oklch coordinates back to
  // hex fifteen times over, and gamut resolution is by far the most expensive thing here —
  // measured, it is the difference between 66 ms and 6 ms for the slowest palette and surface.
  const inks = new Map();
  const inkFor = (lightnessSteps, chromaSteps) => {
    const key = lightnessSteps * 1000 + chromaSteps;
    if (inks.has(key)) return inks.get(key);
    const lightness = base.lightness + lightnessSteps * search.lightnessStep;
    const chroma = base.chroma * (1 + chromaSteps * search.chromaStep);
    const ink = lightness < 0 || lightness > 1 || chroma < 0 ? null : oklchToHex({ lightness, chroma, hue: base.hue });
    inks.set(key, ink);
    return ink;
  };

  // Best-so-far, for the case where nothing reaches the target. "Furthest apart" decides, and
  // because the candidates arrive in ascending cost the first one to reach any given
  // separation is also the cheapest that does — so no tie-break on cost is needed here.
  let best = null;
  for (const candidate of candidatesByCost(search)) {
    const ink = inkFor(candidate.lightness, candidate.chroma);
    if (!ink) continue;
    const factor = 1 + candidate.tint * search.tintStep;
    const separation = screenDistance(ink, compositeOver(color, referenceTint(search, factor), card));
    if (separation >= target) {
      return candidate.lightness === 0 && candidate.chroma === 0 && candidate.tint === 0
        ? unchanged(color)
        : Object.freeze({ ink, tintFactor: factor });
    }
    if (!best || separation > best.separation) best = { ink, factor, separation };
  }
  if (!best || (best.ink === color && best.factor === 1)) return unchanged(color);
  return Object.freeze({ ink: best.ink, tintFactor: best.factor });
}

// EVERY COLOUR THIS CONFIGURATION CAN CLASSIFY WITH, answered once.
//
// The set is closed and known the moment the palette and the profile are: the adapted ramp,
// the invalid colour, the neutral one, and any colour a custom tier named for itself. Working
// them out together rather than on demand is what keeps a score change — 22.9 °C becoming
// 23.1 °C and moving the reading from optimal to one step out — a LOOKUP. The search is far
// too expensive to run inside a render, and a render is exactly where a score changes.
//
// Memoized on the colours and the surface together, the same single slot `adaptPalette()`
// uses and for the same reason: a card re-renders several times a second and its palette and
// its background change almost never.
let memoKey = null;
let memoValue = null;

export function tintRecipesFor(colors, surface) {
  const card = surface?.samples?.[0] ?? null;
  const key = `${colors.join(",")}|${card || ""}`;
  if (memoKey === key) return memoValue;
  const recipes = new Map();
  for (const color of colors) {
    if (!color || recipes.has(color)) continue;
    recipes.set(color, legibleTintRecipe(color, card));
  }
  memoKey = key;
  memoValue = recipes;
  return recipes;
}

// What a place gets when nobody worked out a recipe for its colour — a caller with no
// surface, or a colour that reached the card from somewhere the configuration cannot
// enumerate. Doing nothing is the honest answer there, and it is what the card did before.
export function tintRecipeFor(recipes, color) {
  return recipes?.get(color) ?? unchanged(color);
}

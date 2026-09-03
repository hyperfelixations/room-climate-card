// The second repair, and it never moves a palette. Three of the seven paint places set the
// colour at full strength on a tint of ITSELF (status pill, header icon, chip mark); there the
// recipe is wrong, not the colour. One mechanic, worked out ONCE and applied to all three — an
// ADJUSTMENT, not a colour per place:
//
//   ink         the foreground, same hue, exactly
//   tintFactor  a factor (not an absolute alpha) on the tint weight each place already has,
//               so a card that never had a problem stays bit for bit unchanged
//
// Worked out on the plain instance: the colour on a tint of itself over the card, at the pill's
// weight. Rationale, the search axes and the comfort bracket: see internal dev doc §5
// "Tönungsanpassung von Pille, Icon und Chipmarke".

import { compositeOver } from "../../core/color.js";
import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";
import { TINT_ALPHAS } from "./paint-roles.js";
import { requiredSeparationOf } from "./palette-fit.js";

// The reference instance: a tint of the colour over the card, at this mechanic's weight, with
// whatever the measured place already puts underneath.
const referenceTint = (search, factor) =>
  search.structuralTint + (1 - search.structuralTint) * search.recipeTint * factor;

// The role's separation is the FLOOR; the comfort target sits above it, at 1.10 — the smallest
// value at which all three places clear their own bar (at 1.00 the chip mark still fails 65 in
// 386; bracketed on rendered cards). Higher buys margin by moving more of the card.
const COMFORT_OVER_FLOOR = 1.10;

// How the search moves: three axes, each in whole steps, both directions, hue fixed. Lightness
// is additive in Oklch L; chroma is MULTIPLICATIVE (so an achromatic colour stays achromatic);
// tint is a factor on the recipe's alpha, down and up (a darker ink plus a stronger tint of
// the original colour is more contrast). The caps stop the search reaching for near-black ink
// on a near-opaque tint. The steps and weights together are the exchange rate between axes.
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

// Every combination the search may make, cheapest first — cost is the weighted step count, so
// the first candidate that reads comfortably is the answer. A lightness or chroma step costs
// one; a TINT step costs four, because thinning the fill is a bigger visual change than
// darkening the text, so the tint is spent only where the ink alone cannot get there (one
// colour in 444 on the two shipped themes, 80 on an arbitrarily coloured dashboard).
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

// The smallest visible change, at the same hue, that makes the mechanic comfortable to read —
// or, when nothing within the caps manages that, the one that gets furthest. Never worse than
// doing nothing, never a different colour.
export function legibleTintRecipe(color, card, search = TINT_SEARCH) {
  if (!color || !card) return unchanged(color);
  const target = requiredSeparationOf("chipMark") * search.comfort;
  const base = hexToOklch(color);

  // The ink depends on only two of the three axes, so it is built once per (lightness, chroma)
  // pair and reused across every tint. Gamut resolution is the expensive part — the difference
  // between 66 ms and 6 ms for the slowest palette and surface.
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

  // Best-so-far, for when nothing reaches the target: furthest apart wins, and ascending cost
  // means the first to reach a given separation is also the cheapest.
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

// A recipe for every colour this configuration can classify with (the adapted ramp, invalid,
// neutral, and any colour a custom tier named), worked out together so a score change is a
// LOOKUP — the search is far too expensive to run inside a render. Memoized on the colours and
// surface together, one slot like `adaptPalette()`.
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

// What a place gets when no recipe was worked out for its colour (no surface, or a colour from
// somewhere the configuration cannot enumerate): do nothing.
export function tintRecipeFor(recipes, color) {
  return recipes?.get(color) ?? unchanged(color);
}

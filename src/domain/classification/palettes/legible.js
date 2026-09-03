// The repair: a palette the card cannot be read on, made readable, changed as little as it
// takes. Triggered only by `fits` — `accent` and `marker`, where the colour is painted on
// something it does not tint. What is held fixed: hue exactly; the middle unless it cannot be
// seen; wing count; the ramp never gets harder to read than it was.
//
// Two ways in. A DERIVED ramp remembers its seed (which direction means "less"), so it is
// REBUILT from that seed with its wings aimed somewhere legible — same construction, different
// endpoints. A BUILT-IN ramp has no seed, so its finished steps are moved by the smallest
// monotone lightness correction that frees every step. Candidates are produced lazily,
// best-first, and each is judged by holds(); `null` when nothing works.
//
// See internal dev doc §5 "Die legible-Anpassungsstrategie".

import { hexToOklch, oklchToHex, screenDistance } from "../../../core/oklch.js";
import { evaluatePaletteFit } from "../palette-fit.js";
import { paletteDemandOf } from "../paint-roles.js";
import { legibleVariant, lightnessThatClears, separationFrom } from "../legibility.js";
import { MIN_VISIBLE_STEP, describePalette } from "./geometry.js";
import { LIGHTNESS_CEILING, LIGHTNESS_FLOOR, monochromeAnchors, monochromePalette, monochromeWing } from "./monochrome.js";
import { gradientPalette } from "./gradient.js";
import { completePalette } from "./registry.js";

// The cheap predicate the search runs on, equivalent to the palette verdict by construction
// (paletteDemandOf()). A whole report per candidate would cost a hundred times this.
function clears(hex, demand) {
  return separationFrom(hex, demand.backgrounds) >= demand.required;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function colorsOf(parts) {
  return [parts.optimal, ...parts.above, ...parts.below];
}

// The palette a candidate ramp would be, in the shape the resolver reads. `id`, `origin` and
// `source` travel unchanged — a repair does not alter what a palette is or where it came from.
function rebuilt(palette, parts, invalid) {
  return completePalette({
    id: palette.id,
    origin: palette.origin,
    source: palette.source,
    optimal: parts.optimal,
    above: parts.above,
    below: parts.below,
    invalid,
  });
}

// The closest two neighbouring steps come to each other, ON A SCREEN — a ramp is as hard to
// read as its worst pair. screenDistance, not the generators' plain Oklab distance (see
// MIN_VISIBLE_STEP in geometry.js): by Oklab, a repair of `palette: black` compressed three
// dark steps into one colour while the arithmetic read 0.07, twice the bar.
function tightestNeighbour(steps) {
  let tightest = Infinity;
  for (let index = 1; index < steps.length; index += 1) {
    tightest = Math.min(tightest, screenDistance(steps[index - 1].color, steps[index].color));
  }
  return tightest;
}

// How close a step of one wing comes to a step of the other — a reader can only follow a
// diverging ramp while its two directions look different. Compared to what the palette ALREADY
// did, not a fixed bar, because `signal` is deliberately symmetric.
function wingsApart(palette) {
  let closest = Infinity;
  for (const cold of palette.below) {
    for (const warm of palette.above) {
      closest = Math.min(closest, screenDistance(cold, warm));
    }
  }
  return closest;
}

// A candidate is only an answer if it keeps its promises — checked, not trusted. Same wing
// lengths; no neighbouring pair tighter than the original's tightest (capped at
// MIN_VISIBLE_STEP); and the two wings no closer to each other than before. The cross-wing
// check stops a rebuild that turned a wing round (`palette: teal` on mid grey) from running
// both wings down to the same near-black — each step legible, the two directions not.
// Separation is compared as one number, not pair by pair (with a wing free to change length
// the pairs do not correspond).
function holds(candidate, original) {
  if (!candidate) return false;
  if (candidate.below.length !== original.below.length) return false;
  if (candidate.above.length !== original.above.length) return false;
  const neighbourBar = Math.min(MIN_VISIBLE_STEP, tightestNeighbour(describePalette(original).steps));
  if (tightestNeighbour(describePalette(candidate).steps) < neighbourBar) return false;

  const wingBar = Math.min(MIN_VISIBLE_STEP, wingsApart(original));
  return wingsApart(candidate) >= wingBar;
}

// ============================================================== the derived ramps ====

// A ladder of lightnesses, nearest to `preferred` first. Used for where a wing ends and (only
// when no endpoints work) where the middle sits. Ordering by distance from the generator's own
// choice keeps the answer the least departure, and lets a wing flip sides with no direction
// bookkeeping — the far side is just further down the list.
const ANCHOR_CANDIDATES = 24;
const BASE_CANDIDATES = 24;

function lightnessLadder(count, preferred) {
  const candidates = [preferred];
  for (let step = 0; step <= count; step += 1) {
    candidates.push(LIGHTNESS_FLOOR + ((LIGHTNESS_CEILING - LIGHTNESS_FLOOR) * step) / count);
  }
  return candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
}

function wingIsUsable(colors, demand) {
  return colors.every((color) => clears(color, demand));
}

// The ramp one particular middle implies, each wing aimed as close to the generator's own
// choice as the background allows, or null when a wing has nowhere to go. The deep wing (which
// carries "more") is chosen first; the pale wing may flip downwards when it has nowhere paler,
// but a flipped wing may not overtake the deep one — unconstrained, `palette: teal` on mid
// grey ran its pale wing past the deep wing into near-black and the ramp read backwards. When
// no endpoint satisfies that, the middle moves instead.
function rampForBase(base, palette, demand, allowFlip) {
  const coordinates = hexToOklch(base);
  const preferred = monochromeAnchors(coordinates);
  const middle = coordinates.lightness;

  // One wing at a time: a wing's colours depend on the middle and its own endpoint alone.
  let deep = null;
  for (const candidate of lightnessLadder(ANCHOR_CANDIDATES, preferred.deep)) {
    if (!wingIsUsable(monochromeWing(coordinates, "deep", candidate), demand)) continue;
    deep = candidate;
    break;
  }
  if (deep === null) return null;

  const deepTravel = Math.abs(deep - middle);
  const flipped = (candidate) => (candidate - middle) * (deep - middle) > 0;
  for (const candidate of lightnessLadder(ANCHOR_CANDIDATES, preferred.pale)) {
    if (flipped(candidate) && Math.abs(candidate - middle) > deepTravel) continue;
    if (!allowFlip && flipped(candidate)) continue;
    if (!wingIsUsable(monochromeWing(coordinates, "pale", candidate), demand)) continue;
    const ramp = monochromePalette(base, palette.id, { pale: candidate, deep });
    return { optimal: ramp.optimal, above: ramp.above, below: ramp.below };
  }
  return null;
}

// Every ramp this seed can produce here, best first — "best" is three questions in order:
//   1  does the named colour stay exactly as named (it outranks everything; its pale wing may
//      turn round, e.g. `palette: yellow` on white)
//   2  do the wings run the way they mean to (once the middle must move, a pale-paler-than-
//      middle ramp reads better than two wings the same way)
//   3  how far the middle moved (nearest first, within each of the two sweeps above)
function* fromMonochromeSeed(palette, demand) {
  const seed = palette.source.color;
  const nearest = legibleVariant(seed, demand.backgrounds, demand.required);
  if (!nearest) return;

  // 1 — the named colour, untouched, whatever its wings have to do.
  if (nearest === seed) {
    const asNamed = rampForBase(seed, palette, demand, true);
    if (asNamed) yield asNamed;
  }

  const { lightness, chroma, hue } = hexToOklch(seed);
  const ladder = lightnessLadder(BASE_CANDIDATES, lightness).map((value) =>
    oklchToHex({ lightness: value, chroma, hue })
  );
  const bases = [nearest, ...ladder].filter(
    (base, index, all) => all.indexOf(base) === index && clears(base, demand)
  );

  // 2 and 3 — wings the right way round first, nearest middle within each sweep.
  for (const allowFlip of [false, true]) {
    for (const base of bases) {
      const ramp = rampForBase(base, palette, demand, allowFlip);
      if (ramp) yield ramp;
    }
  }
}

// The ramp a set of anchors implies, if ALL of it can be seen — the whole ramp, not the ends:
// an interpolation between two legible anchors can travel through the card's own lightness
// (red-white-green on a mid grey card).
function gradientRampFor(seeds, palette, demand) {
  const ramp = gradientPalette(seeds, palette.id);
  if (!colorsOf(ramp).every((color) => clears(color, demand))) return null;
  return { optimal: ramp.optimal, above: ramp.above, below: ramp.below };
}

// How far the whole set of anchors may be carried, and in what steps. Past this it is a
// different palette, not a repair.
const SHIFT_LIMIT = 0.4;
const SHIFT_STEPS = 20;

function* fromGradientSeeds(palette, demand) {
  const seeds = palette.source.colors;

  // First, each anchor on its own and only as far as it must — one may be fine where another
  // is not.
  const nearest = seeds.map((hex) => legibleVariant(hex, demand.backgrounds, demand.required));
  if (nearest.some((hex) => !hex)) return;
  const first = gradientRampFor(nearest, palette, demand);
  if (first) yield first;

  // Then all of them together, as a SET, which keeps the relationship between them — most of
  // what a two- or three-colour palette is. Nearest first.
  const anchors = seeds.map((hex) => hexToOklch(hex));
  const ladder = [];
  for (let step = 1; step <= SHIFT_STEPS; step += 1) {
    ladder.push((SHIFT_LIMIT * step) / SHIFT_STEPS, (-SHIFT_LIMIT * step) / SHIFT_STEPS);
  }
  for (const shift of ladder) {
    const moved = anchors.map(({ lightness, chroma, hue }) =>
      oklchToHex({ lightness: clamp01(lightness + shift), chroma, hue })
    );
    const ramp = gradientRampFor(moved, palette, demand);
    if (ramp) yield ramp;
  }
}

function* fromSeed(palette, demand) {
  if (!palette.source) return;
  if (palette.source.colors) yield* fromGradientSeeds(palette, demand);
  else yield* fromMonochromeSeed(palette, demand);
}

// ============================================================= the built-in ramps ====

// The steps of a ramp at given lightnesses, addressed the way a palette stores them.
function partsFrom(geometry, lightnesses) {
  const at = (step) => oklchToHex({ lightness: lightnesses[step.index], chroma: step.chroma, hue: step.hue });
  const below = [];
  const above = [];
  let optimal = null;
  for (const step of geometry.steps) {
    if (step.wing === "optimal") optimal = at(step);
    // `below` is stored innermost-first, and geometry walks it outermost-first.
    else if (step.wing === "below") below[step.offset - 1] = at(step);
    else above[step.offset - 1] = at(step);
  }
  return { optimal, above, below };
}

// The smallest monotone correction that frees every step, in one direction. Each step names
// the nearest lightness that would free it (a free step names where it is); those targets
// would reorder the ramp, so the monotone envelope is taken over them — steps walked in
// ORIGINAL-lightness order carrying a running bound. That is "move the colliding run and
// whatever must follow it, nothing else". Steps sharing a lightness land on the same one.
function monotoneLightnesses(geometry, demand, direction) {
  const steps = geometry.steps;
  const targets = steps.map((step) =>
    clears(step.color, demand)
      ? step.lightness
      : lightnessThatClears(step.color, demand.backgrounds, demand.required, direction)
  );
  if (targets.some((target) => target === null)) return null;

  const order = steps.map((step) => step.index).sort((a, b) => steps[a].lightness - steps[b].lightness || a - b);
  const result = new Array(steps.length);
  if (direction > 0) {
    let bound = -Infinity;
    for (const index of order) {
      bound = Math.max(bound, targets[index]);
      result[index] = bound;
    }
  } else {
    let bound = Infinity;
    for (let position = order.length - 1; position >= 0; position -= 1) {
      const index = order[position];
      bound = Math.min(bound, targets[index]);
      result[index] = bound;
    }
  }

  for (let position = 1; position < order.length; position += 1) {
    const previous = order[position - 1];
    const current = order[position];
    if (steps[previous].lightness === steps[current].lightness) result[previous] = result[current];
  }
  return result;
}

// The coarse fallback: move the whole ramp by one amount. Preserves order and shape by
// construction and nearly preserves SPACING (which the envelope above can flatten when every
// step must move). Runs only after the envelope's two chances, so a one-collision palette
// never pays for an eleven-collision case.
const SHIFT_CANDIDATES = 200;

// A shift that runs off the end is skipped, not clamped: `palette: gray` on mid grey, carried
// up until its palest step hit white, had clamping press #F7F7F7 and #FFFFFF into one — a step
// lost to a rounding decision nobody made.
function* uniformCandidates(geometry, demand) {
  for (let step = 1; step <= SHIFT_CANDIDATES; step += 1) {
    for (const direction of [1, -1]) {
      const shift = (direction * step) / SHIFT_CANDIDATES;
      const lightnesses = geometry.steps.map((entry) => entry.lightness + shift);
      if (lightnesses.some((value) => value < 0 || value > 1)) continue;
      const parts = partsFrom(geometry, lightnesses);
      if (colorsOf(parts).every((color) => clears(color, demand))) yield parts;
    }
  }
}

function* fromFinishedSteps(palette, demand) {
  const geometry = describePalette(palette);
  // Nothing here moves a step off its own hue and chroma, so a step with no legible lightness
  // is unreachable by any method in this section — bail before walking 400 shifts to
  // rediscover that (most of the old give-up cost on a white-to-black card).
  const reachable = geometry.steps.every(
    (step) => legibleVariant(step.color, demand.backgrounds, demand.required) !== null
  );
  if (!reachable) return;

  const corrections = [];
  for (const direction of [1, -1]) {
    const lightnesses = monotoneLightnesses(geometry, demand, direction);
    if (!lightnesses) continue;
    const parts = partsFrom(geometry, lightnesses);
    // The envelope can push a step past a background on the OTHER side of it; when that
    // happens the direction is simply not the answer, and the other one usually is.
    if (!colorsOf(parts).every((color) => clears(color, demand))) continue;
    const travel = lightnesses.reduce((sum, value, index) => sum + Math.abs(value - geometry.steps[index].lightness), 0);
    corrections.push({ travel, parts });
  }
  corrections.sort((a, b) => a.travel - b.travel);
  for (const correction of corrections) yield correction.parts;

  yield* uniformCandidates(geometry, demand);
}

// ================================================================== the strategy ====

// `invalid` is corrected on its own, never as part of the ramp: it is not on the ramp and has
// no neighbours to stay ordered with. Left behind, it would be the one unseeable colour on an
// adapted card — and it means "no reading", which is worth seeing.
function correctedInvalid(palette, demand) {
  return legibleVariant(palette.invalid, demand.backgrounds, demand.required) || palette.invalid;
}

function* everyCandidate(palette, demand) {
  yield* fromSeed(palette, demand);
  yield* fromFinishedSteps(palette, demand);
}

export function legibleStrategy(palette, fit) {
  const demand = paletteDemandOf(fit.surface, fit.threshold);
  const invalid = correctedInvalid(palette, demand);

  // Rebuild from the seed first, move finished steps second; lazily, so the common case costs
  // one candidate and the ladders behind it are never walked.
  for (const parts of everyCandidate(palette, demand)) {
    const candidate = rebuilt(palette, parts, invalid);
    if (!holds(candidate, palette)) continue;
    // Postcondition against the real report, not the search's own predicate — the two agree by
    // construction, and checking makes the construction falsifiable.
    if (evaluatePaletteFit(candidate, fit.surface, { threshold: fit.threshold }).fits) return candidate;
  }
  return null;
}

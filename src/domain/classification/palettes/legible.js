// THE REPAIR: a palette the card cannot be read on, made readable, and changed as little as
// it takes.
//
// This is the method BL-21 left open. The decision it acts on is settled elsewhere and is
// deliberately narrow: ../palette-fit.js asks whether each colour can be seen where the colour
// is painted on something it does not tint — the scale marker and the accent line. Nothing
// else moves a palette colour. The status pill, the header icon and a room chip's mark are
// painted on a tint of the colour ITSELF, and their answer is a different tint rather than a
// different colour. There is exactly one colour per score on the card, and it stays that way.
//
// WHAT IS HELD FIXED, and each of these is a rule rather than a preference:
//
//   hue        exactly, everywhere. A `palette: yellow` that came back green would not be a
//              repair. What moves is lightness, and with it whatever chroma the gamut allows.
//   the middle stays exactly where it is whenever it can be seen where it is, and moves the
//              smallest step that makes it visible when it cannot.
//   shape      wings stay wings, and a wing keeps every step it had — until nothing else
//              works, when fewer steps a reader can see beats more that they cannot.
//   spacing    the ramp never gets harder to read than it already was.
//
// TWO WAYS IN, chosen by whether the palette remembers where it came from.
//
// A DERIVED ramp does. `palette: teal` and `palette: blue-green-red` are calculations from
// colours somebody named, and the calculation knows something the finished list of hexes no
// longer does: which direction means "less" and which means "more". So a derived ramp is
// REBUILT from the same seed with its wings aimed somewhere legible — the same construction,
// different endpoints. That is what lets a pale wing with nowhere paler to go run downwards
// into the washed-out while the deep wing runs downwards into the saturated: both darker, and
// never mistakable for one another, because a monochrome ramp separates its wings by chroma
// as much as by lightness.
//
// A BUILT-IN ramp does not. There is no seed behind `pastel`, only eleven decided colours, so
// the finished steps are moved instead — by the smallest monotone lightness correction that
// frees every step, which moves the colliding run and whatever has to follow it and leaves the
// rest exactly where it was.
//
// EVERY METHOD IS A CANDIDATE, NOT A DECISION. They are produced best-first and each is judged
// on what it produced: a correction can be minimal and still squash two steps together, and
// only holds() can see that. This is also why they are produced lazily rather than chained —
// the common case costs one candidate, and the expensive searches are never reached.
//
// AND WHEN NOTHING WORKS, the answer is `null`. A card on a gradient from white to black
// contains every lightness and no fixed ramp is legible over all of it; adaptation.js then
// keeps what the user asked for, because poor contrast is at least theirs.

import { hexToOklch, oklchToHex, screenDistance } from "../../../core/oklch.js";
import { evaluatePaletteFit } from "../palette-fit.js";
import { paletteDemandOf } from "../paint-roles.js";
import { legibleVariant, lightnessThatClears, separationFrom } from "../legibility.js";
import { MIN_VISIBLE_STEP, describePalette } from "./geometry.js";
import { LIGHTNESS_CEILING, LIGHTNESS_FLOOR, monochromeAnchors, monochromePalette, monochromeWing } from "./monochrome.js";
import { gradientPalette } from "./gradient.js";
import { completePalette } from "./registry.js";

// The cheap predicate the search runs on, equivalent to the palette verdict by construction —
// see paletteDemandOf(). Evaluating a whole report per candidate would cost a hundred times
// this and answer the same question.
function clears(hex, demand) {
  return separationFrom(hex, demand.backgrounds) >= demand.required;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function colorsOf(parts) {
  return [parts.optimal, ...parts.above, ...parts.below];
}

// The palette a candidate ramp would be, in the shape the resolver reads. `id`, `origin` and
// `source` travel unchanged: what a palette IS and where it came from are not what a repair is
// allowed to alter.
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

// The closest two neighbouring steps of a ramp come to each other, ON A SCREEN. One number,
// because that is the property a reader notices: a ramp is as hard to read as its worst pair.
//
// screenDistance rather than the plain Oklab distance the generators use — see MIN_VISIBLE_STEP
// in geometry.js for the measurement that separates the two. Using the generators' instrument
// here let a repair of `palette: black` on a mid grey card compress its darkest three steps
// into one colour while the arithmetic still read 0.07, twice the bar.
function tightestNeighbour(steps) {
  let tightest = Infinity;
  for (let index = 1; index < steps.length; index += 1) {
    tightest = Math.min(tightest, screenDistance(steps[index - 1].color, steps[index].color));
  }
  return tightest;
}

// How close a step of one wing comes to a step of the other. A diverging ramp says two
// different things in two directions, and a reader can only follow it while those two things
// look different.
//
// Compared to what the palette ALREADY did rather than to a fixed bar, because `signal` is
// deliberately symmetric: its two wings are the same orange and the same red by design, and a
// rule that forbade that would forbid the palette itself.
function wingsApart(palette) {
  let closest = Infinity;
  for (const cold of palette.below) {
    for (const warm of palette.above) {
      closest = Math.min(closest, screenDistance(cold, warm));
    }
  }
  return closest;
}

// A candidate is only an answer if it keeps its promises. Checked here rather than trusted,
// because a search that only asked "is it legible now" would happily hand back a ramp with two
// steps nobody can tell apart.
//
// THE CROSS-WING CHECK IS THE ONE THE PICTURES ADDED. A rebuild is free to turn a wing round
// when it has nowhere else to go, and `palette: teal` on a mid grey card needs both wings
// below the middle. Left at that, the search found a ramp whose two wings ran down to the same
// near-black — five steps each, every one of them legible against the card, and the two
// directions indistinguishable from one another. Legible is not the same as readable.
//
// SEPARATION IS COMPARED AS ONE NUMBER rather than pair by pair. Pair by pair would forbid a
// repair from ever trading a hundredth between two neighbours, which is not a promise anybody
// needs and is impossible to keep while moving anything at all; and with a wing free to change
// length, the pairs do not even correspond. What must not happen is the ramp getting harder to
// read than it was, and that is exactly what its tightest pair says.
function holds(candidate, original) {
  if (!candidate) return false;
  if (candidate.below.length !== original.below.length) return false;
  if (candidate.above.length !== original.above.length) return false;
  // Capped at one perceptible step: a repair is not asked to pull apart a pair the palette
  // itself chose to keep close, only to leave it no closer.
  const neighbourBar = Math.min(MIN_VISIBLE_STEP, tightestNeighbour(describePalette(original).steps));
  if (tightestNeighbour(describePalette(candidate).steps) < neighbourBar) return false;

  const wingBar = Math.min(MIN_VISIBLE_STEP, wingsApart(original));
  return wingsApart(candidate) >= wingBar;
}

// ============================================================== the derived ramps ====

// A LADDER OF LIGHTNESSES, nearest to a preferred one first.
//
// Used for both things a rebuild may have to choose: where a wing ends, and — only when no
// pair of endpoints works — where the middle sits. Ordering by distance from what the
// generator would have picked is what makes the answer the least departure from the ramp the
// user would have got on a friendlier background, and it is also what lets a wing flip sides
// without any bookkeeping about direction: the far side is simply further down the list.
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

// The ramp one particular middle implies, with each wing aimed as close to the generator's own
// choice as this background allows — or null when one of them has nowhere to go.
//
// THE DEEP WING IS CHOSEN FIRST, and the order is not arbitrary. It is the wing that carries
// "more", the pale wing is allowed to run the other way when it has nowhere paler to go, and a
// flipped wing only makes sense in relation to the one it flipped alongside.
//
// A FLIPPED WING MAY NOT OVERTAKE THE OTHER, which is the constraint the pictures produced.
// `palette: teal` on a mid grey card has a middle just under the grey and no room above it, so
// the pale wing turned downwards — and, unconstrained, ran past the deep wing into near-black.
// The ramp then read backwards: its "much too little" was darker than its "much too much".
// Keeping a flipped wing inside the other one's travel makes that impossible, and when no
// endpoint satisfies it the middle moves instead, which is the better repair anyway.
function rampForBase(base, palette, demand, allowFlip) {
  const coordinates = hexToOklch(base);
  const preferred = monochromeAnchors(coordinates);
  const middle = coordinates.lightness;

  // ONE WING AT A TIME. Each search tests one endpoint of one wing, and a wing's colours depend
  // on the middle and its own endpoint alone — so building the whole palette to look at half of
  // it would do twice the work for the same answer.
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

// Every ramp this seed can produce here, best first — and "best" is three questions in order.
//
// 1  DOES THE NAMED COLOUR STAY EXACTLY AS NAMED. It is the one thing the user actually wrote,
//    so it outranks everything else: `palette: yellow` on a white card keeps #FFFF00 and lets
//    its pale wing turn round, because there is nothing paler than that yellow to be seen on
//    white and a yellow palette should still be yellow.
//
// 2  DO THE WINGS RUN THE WAY THEY MEAN TO. Once the middle has to move there is no promise
//    left to protect, and a ramp whose pale wing is paler than its middle reads better than
//    one whose two wings both run the same way. `palette: teal` on a mid grey card is the case
//    that showed this: the nearest legible middle sits just above the grey, where both wings
//    have to climb and the deep one washes out to near-white at the top; a middle a little
//    further down has the whole range below the grey to itself and reads as it was meant to.
//
// 3  HOW FAR THE MIDDLE MOVED. Within each of the two sweeps above, nearest first.
//
// Measured: `palette: gold` on a mid grey card takes its middle 0.045 lighter and nothing
// else; `palette: yellow` on a mid YELLOW card has to go down to a dark olive-yellow, because
// a yellow ramp on a yellow card has nowhere else to be. In both, the hue is exact.
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

// The ramp a set of anchors implies, if all of it can be seen.
//
// The steps BETWEEN two legible anchors are not legible by construction — an interpolation can
// travel straight through the lightness the card is painted at, which is what happens to
// red-white-green on a mid grey card. So the whole ramp is checked, not the ends.
function gradientRampFor(seeds, palette, demand) {
  const ramp = gradientPalette(seeds, palette.id);
  if (!colorsOf(ramp).every((color) => clears(color, demand))) return null;
  return { optimal: ramp.optimal, above: ramp.above, below: ramp.below };
}

// HOW FAR THE WHOLE SET OF ANCHORS MAY BE CARRIED, and in what steps. A shift past this is no
// longer a repair of what somebody named; it is a different palette.
const SHIFT_LIMIT = 0.4;
const SHIFT_STEPS = 20;

function* fromGradientSeeds(palette, demand) {
  const seeds = palette.source.colors;

  // First, each anchor on its own and only as far as it must. The two or three colours a user
  // wrote are the strongest commitment in the whole palette, and one of them may be perfectly
  // fine where another is not.
  const nearest = seeds.map((hex) => legibleVariant(hex, demand.backgrounds, demand.required));
  if (nearest.some((hex) => !hex)) return;
  const first = gradientRampFor(nearest, palette, demand);
  if (first) yield first;

  // Then all of them together. Moving them as a SET is what keeps the relationship between
  // them — which end is lighter, and by how much — and that relationship is most of what a
  // two- or three-colour palette is. Nearest first, so a ramp is carried no further than the
  // background makes necessary.
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

// THE SMALLEST MONOTONE CORRECTION that frees every step, in one direction.
//
// Each step names the nearest lightness that would free it; a step that is already free names
// where it is. Those targets on their own would reorder the ramp, so the monotone envelope is
// taken over them: the steps are walked in order of their ORIGINAL lightness, carrying a
// running bound. That envelope is the least monotone function above (or below) the targets,
// which is exactly what "move the colliding run and whatever has to follow it, and nothing
// else" means — a step with room to spare moves only if a step it must stay ordered with
// pushed past it.
//
// Steps that share a lightness land on the same one, because preserving a weak ordering in
// both directions is preserving equality.
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

// THE COARSE ANSWER, kept as a fallback and not as the method.
//
// Moving the whole ramp by one amount is what a reader would call "the palette went lighter".
// It preserves order and shape by construction and very nearly preserves the SPACING, which is
// the property the correction above can lose: when every step has to move, the envelope pushes
// them all towards the same bound and the ramp flattens. Measured, a uniform shift rescues
// every shipped palette on every hard background at a cost of 0.03 to 0.20 in lightness, with
// the tightest neighbour distance unchanged to three digits.
//
// It runs only after the correction above has had its two chances, so a palette with one
// colliding step never pays for a case that has eleven.
const SHIFT_CANDIDATES = 200;

// A SHIFT THAT WOULD RUN OFF THE END IS NOT A SHIFT, and clamping it is worse than skipping
// it. Measured: `palette: gray` on a mid grey card was carried upwards until its palest step
// hit white, where clamping held it at 1.000 while the step below arrived at 0.976 — two
// colours that had been a clear step apart, pressed into #FFFFFF and #F7F7F7. The ramp was
// legible against the card and had lost a step to a rounding decision nobody made.
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
  // NOTHING HERE MOVES A STEP OFF ITS OWN HUE AND CHROMA — not the envelope, not the uniform
  // shift. So a step with no legible lightness at all is a step no method in this section can
  // reach, and walking four hundred shifts to rediscover that is time spent on a foregone
  // conclusion. Measured on a card whose background runs from white to black, this is most of
  // what the give-up path used to cost.
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

// `invalid` is corrected on its own and never as part of the ramp, because it is not on the
// ramp: it is what the card paints when no judgement is possible, and it has no neighbours to
// stay ordered with. Left behind, it would be the one colour on an adapted card that still
// could not be seen — and it is the one that means "no reading", which is worth seeing.
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

  // Rebuilding from the seed first, moving the finished steps second. A ramp that remembers
  // where it came from can be rebuilt into something that still means what it meant; one that
  // does not can only be pushed around.
  //
  // Lazily, which is what keeps the common case cheap: the first candidate is usually the
  // answer, and the ladders behind it are never walked.
  for (const parts of everyCandidate(palette, demand)) {
    const candidate = rebuilt(palette, parts, invalid);
    if (!holds(candidate, palette)) continue;
    // The postcondition, against the real report rather than the search's own predicate. The
    // two agree by construction; checking anyway is what makes the construction falsifiable.
    if (evaluatePaletteFit(candidate, fit.surface, { threshold: fit.threshold }).fits) return candidate;
  }
  return null;
}

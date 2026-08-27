// WHETHER A PALETTE CAN BE SEEN ON THE BACKGROUND THE CARD IS ACTUALLY PAINTED ON.
//
// A colour ramp is foreground. Whether its steps can be read depends entirely on what is
// behind them, and that is not a constant: Home Assistant ships a light and a dark theme,
// users install their own, and card-mod restyles individual cards — to a flat colour, to a
// gradient, to a photograph.
//
// WHY THIS REPLACED A DECLARED `tunedFor`. Each palette used to state which of two
// canonical backgrounds it had been designed against. That answers the wrong question. The
// real background is arbitrary, so "dark" says nothing useful about a dark blue card; and
// it could not resolve "any" at all — every shipped palette claimed to suit everything,
// while none of them is legible on a mid grey. Measuring the actual colours against the
// actual background answers all of those at once, and needs nothing maintained.
//
// WHAT COMES BACK IS A FINDING, NOT A YES OR NO. A boolean would be enough to decide
// whether to transform, and useless for deciding HOW. A method that moves lightness needs
// to know which steps collide and by how much; one that moves chroma needs the same
// information cut differently; one that shifts hue needs neither. So the evaluation reports
// what it measured and stops there — see palettes/adaptation.js for the seam that consumes
// it.
//
// THE INSTRUMENT is screenDistance() in core/oklch.js: perceptually uniform, and corrected
// for the light a real room reflects off a real screen. Its own reasoning is written there.

import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";
import { describePalette } from "./palettes/geometry.js";
import { PAINT_ROLES, PALETTE_ROLES, SELF_TINTED_ROLES, backgroundsFor, foregroundFor, pointsOf, surfaceOf } from "./paint-roles.js";

// The line between "a reader can pick this out" and "this is the background".
//
// Located, not chosen. Against the hand-labelled pairs in
// test/fixtures/palette-fit-calibration.js the visible cases bottom out at 0.169 (a mid
// grey step on Home Assistant's dark card) and the invisible ones top out at 0.154 (navy on
// the same card). 0.16 sits in that gap. The gap is narrow because those two pairs are
// genuinely hard; every other pair in the table is at least twice as far from the line.
//
// Raising this makes the card interfere more often; lowering it lets an unreadable step
// through. The calibration table is the place to argue about a specific case.
export const VISIBILITY_THRESHOLD = 0.16;

// `invalid` is deliberately NOT part of the ramp and just as deliberately not forgotten: it
// is a colour the card paints, it is not a point on the scale, and a transformation that
// reshapes the ramp would leave it behind. On a mid-grey card the shared neutral #7D7D7D is
// exactly as invisible as everything else, and the finding has to say so on its own.
//
// The ramp itself is described by describePalette() in palettes/geometry.js — see there for
// why the geometry is a separate question from the measurement.

// The contiguous runs of colliding steps, in ramp order.
//
// This is what answers "change the whole palette, or only part of it". A blue-green-red
// ramp on a green card collides in ONE run in the middle and reaches the background at
// neither end; a black ramp on a dark card collides in one run at the bottom. Those want
// different treatment, and a flat list of failing steps cannot tell them apart.
//
// A region reports FACTS about where it sits — which steps, and whether it reaches either
// end of the ramp — rather than a name for its shape.
//
// It used to carry a `where` of "start" | "middle" | "end" | "whole", and that was a lossy
// abstraction wearing a helpful label. For a palette with only an `above` wing, a collision
// at `optimal` is the ramp's first element and was therefore called "start" — while it is
// plainly the palette's MIDDLE. And a run of failures with one accidental survivor in it
// became two regions whose labels described neither. `touchesStart`/`touchesEnd` cannot be
// wrong in that way, and "middle" is one negation away for anything that wants it.
function regionsOf(steps, role) {
  const regions = [];
  let run = null;
  steps.forEach((step, index) => {
    const judged = step.roles[role];
    if (!judged.fits) {
      if (!run) run = { role, fromIndex: index, toIndex: index, from: step.key, to: step.key, keys: [step.key], maxDeficit: judged.deficit };
      else {
        run.toIndex = index;
        run.to = step.key;
        run.keys.push(step.key);
        run.maxDeficit = Math.max(run.maxDeficit, judged.deficit);
      }
      return;
    }
    if (run) {
      regions.push(run);
      run = null;
    }
  });
  if (run) regions.push(run);

  return regions.map((region) => ({
    ...region,
    length: region.toIndex - region.fromIndex + 1,
    touchesStart: region.fromIndex === 0,
    touchesEnd: region.toIndex === steps.length - 1,
  }));
}

// ONE COLOUR IN ONE ROLE, against every point of the surface.
//
// The worst pairing is the one that counts: a gradient is several colours and the palette has
// to hold up over all of it, so the point where this role has the least separation decides.
//
// `required` is the role's own bar, not the global threshold — see paint-roles.js for why a
// nine-pixel chip mark and a large band are not the same question.
function judgeRole(color, role, points, threshold) {
  const required = threshold * role.factor;
  let worst = null;
  for (const point of points) {
    const foreground = foregroundFor(role, color, point);
    for (const background of backgroundsFor(role, color, point)) {
      const distance = screenDistance(foreground, background);
      if (!worst || distance < worst.distance) worst = { foreground, background, distance };
    }
  }
  const fits = worst.distance >= required;
  return Object.freeze({
    role: role.id,
    ...worst,
    required,
    fits,
    deficit: fits ? 0 : required - worst.distance,
    margin: fits ? worst.distance - required : 0,
  });
}

// The worst of a GROUP of roles: most in trouble, or — when nothing is in trouble — least
// room left. Both readings matter, and they are the same comparison: a method that moves the
// ramp needs to know which role would break first, whether or not anything is broken yet.
function worstOf(roles, group) {
  let worst = null;
  for (const role of group) {
    const judged = roles[role.id];
    if (!worst) worst = judged;
    else if (judged.deficit > worst.deficit) worst = judged;
    else if (judged.deficit === worst.deficit && judged.margin < worst.margin) worst = judged;
  }
  return worst;
}

// EVERY ROLE FOR ONE STEP, plus a summary PER AXIS.
//
// TWO SUMMARIES, NOT ONE, for exactly the reason there are two verdicts. A single summary
// over all seven roles sat beside `fits` — which has always meant the palette question alone
// — and reported the recipe's trouble under a palette name. Measured, that made `margin`
// zero on every step of pastel on #808080 including the ones with room to spare, so the one
// number a transformation needs ("how far may I move this before I break something that
// works") could not be read out of the report at all.
//
// Each axis now answers for itself, and neither can be mistaken for the other.
function judgeStep(step, points, threshold) {
  const roles = {};
  for (const role of PAINT_ROLES) {
    // A mirroring role is the same measurement under another name — see paint-roles.js. It
    // keeps its own id so the report stays granular, and costs nothing to report.
    roles[role.id] = role.mirrors
      ? Object.freeze({ ...roles[role.mirrors], role: role.id })
      : judgeRole(step.color, role, points, threshold);
  }
  const worstPalette = worstOf(roles, PALETTE_ROLES);
  const worstSelfTint = worstOf(roles, SELF_TINTED_ROLES);
  return {
    ...step,
    roles: Object.freeze(roles),
    // The palette question: can this colour be seen where it is painted on something it does
    // not tint. This is what `fits` has always meant and what adaptation acts on.
    fits: PALETTE_ROLES.every((role) => roles[role.id].fits),
    worstRole: worstPalette.role,
    deficit: worstPalette.deficit,
    margin: worstPalette.margin,
    // The recipe question, kept apart so the two are never added together — see paint-roles.js.
    selfTintFits: SELF_TINTED_ROLES.every((role) => roles[role.id].fits),
    worstSelfTintRole: worstSelfTint.role,
    selfTintDeficit: worstSelfTint.deficit,
    selfTintMargin: worstSelfTint.margin,
  };
}

// WHICH LIGHTNESSES NO STEP MAY OCCUPY, in Oklab L — and, more usefully, which it may.
//
// Reported because a transformation needs it and cannot cheaply recompute it: it is the
// answer to "if I move this step, where must it not land", and its complement is the answer
// to "is there anywhere to move it to at all".
//
// A LIST OF BANDS, NEVER ONE MERGED RANGE. Each sample forbids a neighbourhood around its
// own lightness; two samples far apart forbid two separate neighbourhoods with usable space
// between them. Carrying a single min/max over all samples collapses those into one band
// spanning everything — measured, a ramp over a white-to-black gradient reported 0.000..1.000
// as forbidden while 0.40..0.83 was in fact free, and a method reading that would abandon a
// palette it could trivially have rebuilt.
//
// Solved for a NEUTRAL colour, which is the conservative case — chroma only ever helps — by
// bisecting each edge of each sample's neighbourhood.
const BISECTION_STEPS = 24;

function forbiddenBands(samples, threshold) {
  const greyAt = (lightness) => oklchToHex({ lightness, chroma: 0, hue: 0 });
  const collidesWith = (lightness, sample) => screenDistance(greyAt(lightness), sample) < threshold;

  const bands = [];
  for (const sample of samples) {
    const centre = hexToOklch(sample).lightness;
    if (!collidesWith(centre, sample)) continue;

    // One edge: walk from inside the neighbourhood towards `limit` and bisect the crossing.
    const edge = (limit) => {
      if (collidesWith(limit, sample)) return limit;
      let inside = centre;
      let outside = limit;
      for (let step = 0; step < BISECTION_STEPS; step += 1) {
        const middle = (inside + outside) / 2;
        if (collidesWith(middle, sample)) inside = middle;
        else outside = middle;
      }
      return inside;
    };
    bands.push({ min: edge(0), max: edge(1) });
  }
  return mergeOverlapping(bands);
}

// Bands are merged only where they genuinely touch, so two distant samples stay two bands
// and two samples of similar lightness become one.
function mergeOverlapping(bands) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  const merged = [];
  for (const band of sorted) {
    const last = merged[merged.length - 1];
    if (last && band.min <= last.max) last.max = Math.max(last.max, band.max);
    else merged.push({ ...band });
  }
  return merged;
}

// The complement over [0, 1]: where a step MAY sit. Empty when the bands cover everything,
// which is the honest answer for a gradient that contains every lightness — no fixed ramp is
// legible over all of it, and a method may say so rather than invent one.
function usableRuns(bands) {
  const runs = [];
  let cursor = 0;
  for (const band of bands) {
    if (band.min > cursor) runs.push({ min: cursor, max: band.min });
    cursor = Math.max(cursor, band.max);
  }
  if (cursor < 1) runs.push({ min: cursor, max: 1 });
  // A run too thin to hold anything is not a run. The floor is one just-noticeable step in
  // Oklab lightness; below it there is no room to place a colour, only arithmetic.
  return runs.filter((run) => run.max - run.min > 0.02);
}

function largestRun(runs) {
  let largest = null;
  for (const run of runs) {
    if (!largest || run.max - run.min > largest.max - largest.min) largest = run;
  }
  return largest;
}

// The bands depend on the BACKGROUND alone, never on the palette — so two palettes judged
// against the same card produce the same answer, and so does the same palette on the next
// render. One entry is enough: a card has one background at a time, and the sequence of
// calls is "the same samples, over and over".
//
// Bounded by construction rather than by an eviction policy: there is only ever one slot, so
// nothing accumulates. Measured, this is what keeps a gradient from costing three times
// what a flat card does on every render.
// Nothing ruled out, nothing to say. Shared so that the two paths that mean "no constraint"
// cannot drift apart, and frozen because it is handed to every caller that hits them.
const NO_CONSTRAINT = Object.freeze({
  forbidden: Object.freeze([]),
  usable: Object.freeze([Object.freeze({ min: 0, max: 1 })]),
  largestUsable: Object.freeze({ min: 0, max: 1 }),
});

let lastBands = null;

function bandsFor(samples, threshold) {
  const key = `${threshold}|${samples.join(",")}`;
  if (lastBands && lastBands.key === key) return lastBands.value;
  const forbidden = forbiddenBands(samples, threshold).map((band) => Object.freeze(band));
  const usable = usableRuns(forbidden).map((run) => Object.freeze(run));
  // Frozen because the same object is handed out again on the next call: a consumer that
  // adjusted a band in place would change what every later render is told.
  const value = Object.freeze({
    forbidden: Object.freeze(forbidden),
    usable: Object.freeze(usable),
    largestUsable: Object.freeze(largestRun(usable)),
  });
  lastBands = { key, value };
  return value;
}

// WHERE A STEP MAY SIT SO THAT IT CAN BE SEEN ON THE CARD ITSELF.
//
// Scoped to the card background on purpose, and the name of the field says so. A role whose
// background is a tint of the colour cannot have a fixed forbidden band at all: move the
// colour and its background moves with it, so "which lightnesses are ruled out" has no
// answer that does not depend on where the colour already is. What a method can be told
// ahead of time is where the CARD rules out, and that is what this is.

// The one question, answered in full.
//
//   surface: what the card is painted on. Either a surface — `{ samples, text }` from
//            surfaceOf() — or a bare array of colours, which means the same thing with no
//            text colour known. `samples` is never empty by the time this is reached: the
//            reading ladder in the platform adapter always ends somewhere (see
//            readBackgroundSamples and readTextColor).
// THE WHOLE REPORT, MEMOIZED ON WHAT IT WAS COMPUTED FROM.
//
// The card asks this question on every render, with the same palette and the same surface,
// and the answer costs seven roles times twelve steps times however many colours a gradient
// has. Measured on a five-stop gradient that is around five hundred perceptual distances,
// and it came to more than half a millisecond per render before this existed.
//
// Keyed on the VALUES rather than on object identity, because a derived palette
// (`palette: teal`) is rebuilt on every call and would never hit an identity check. One slot
// is enough and nothing accumulates: a card has one palette on one surface at a time, and
// the sequence of calls is that same pair over and over.
//
// The report is frozen down to its lists, because the same object is handed out again on the
// next call: a consumer that sorted `failing` in place would change what every later render
// is told. Same reasoning as the band memo below.
let lastReport = null;

// The values an answer about this palette on this surface depends on, and nothing else.
//
// Exported because adaptation.js has to memoize on exactly the same thing: a strategy
// evaluates candidates, so the report memo below is the wrong one to lean on — it holds the
// last candidate rather than the question. Two spellings of "what this depends on" would be
// two places for a stale answer to come from.
export function fitKeyFor(palette, surface, threshold) {
  return [
    threshold,
    surface.samples.join(","),
    surface.text || "",
    palette.id,
    palette.optimal,
    (palette.below || []).join(","),
    (palette.above || []).join(","),
    palette.invalid || "",
  ].join("|");
}

// HOW MUCH SEPARATION ONE PLACE ASKS OF A COLOUR, which is the threshold scaled by that
// place's own factor — see paint-roles.js for why a nine-pixel chip mark and a large band are
// not the same question.
//
// Exported because the roles are not only measured, they are also PAINTED, and the code that
// paints them has to know the same number. Two spellings of it would be a calibration that
// drifts.
export function requiredSeparationOf(roleId, threshold = VISIBILITY_THRESHOLD) {
  const role = PAINT_ROLES.find((candidate) => candidate.id === roleId);
  return threshold * role.factor;
}

export function evaluatePaletteFit(palette, surface, { threshold = VISIBILITY_THRESHOLD } = {}) {
  const resolved = surfaceOf(surface);
  const backgrounds = resolved.samples;
  if (!palette || !backgrounds.length) {
    // Nothing measured, so nothing claimed. "Fits" is the right answer to "should I change
    // this": with no background to judge against, leaving the user's palette alone is the
    // only defensible move.
    return {
      fits: true,
      threshold,
      surface: resolved,
      samples: backgrounds,
      palette: palette ? describePalette(palette) : null,
      steps: [],
      regions: [],
      failing: [],
      invalid: null,
      worst: null,
      lightness: NO_CONSTRAINT,
    };
  }

  const key = fitKeyFor(palette, resolved, threshold);
  if (lastReport && lastReport.key === key) return lastReport.value;

  const points = pointsOf(resolved);
  const geometry = describePalette(palette);
  const steps = geometry.steps.map((step) => judgeStep(step, points, threshold));
  const invalid = geometry.invalid ? judgeStep(geometry.invalid, points, threshold) : null;

  const everything = invalid ? [...steps, invalid] : steps;
  const fits = everything.every((step) => step.fits);
  const selfTintFits = everything.every((step) => step.selfTintFits);

  // Every colour-and-role pairing that fails, which is the direct answer to "which
  // individual colours are affected, and in what way". A step can fail in one role and pass
  // in another — `palette: lime` on a light dashboard does exactly that, and the difference
  // is what stops a method from moving a colour that is fine where it is painted.
  const failing = [];
  const selfTintConflicts = [];
  for (const step of everything) {
    for (const role of PAINT_ROLES) {
      const judged = step.roles[role.id];
      if (judged.fits) continue;
      const entry = { key: step.key, role: role.id, color: step.color, background: judged.background, distance: judged.distance, required: judged.required, deficit: judged.deficit };
      (role.selfTinted ? selfTintConflicts : failing).push(entry);
    }
  }

  let worst = null;
  for (const entry of failing) if (!worst || entry.deficit > worst.deficit) worst = entry;
  if (!worst) {
    // Everything fits; the useful "worst" is then the tightest margin — the pairing that
    // would break first if the ramp were moved.
    for (const step of everything) {
      for (const role of PALETTE_ROLES) {
        const judged = step.roles[role.id];
        if (!worst || judged.margin < worst.margin) {
          worst = { key: step.key, role: role.id, color: step.color, background: judged.background, distance: judged.distance, required: judged.required, deficit: 0, margin: judged.margin };
        }
      }
    }
  }

  // One list of regions per role, keyed by role. Mixing them would invent a region that
  // exists nowhere: a run of steps that collide in the scale track is a different problem
  // from a run that collides in the status label, and they rarely have the same extent.
  const regions = {};
  for (const role of PAINT_ROLES) regions[role.id] = regionsOf(steps, role.id);

  const value = Object.freeze({
    fits,
    threshold,
    // What the palette is painted on, as read — see paint-roles.js.
    surface: resolved,
    // The background colours alone, which is what most callers and every existing test mean
    // when they say "samples".
    samples: backgrounds,
    // What the palette is shaped like, measured once — see palettes/geometry.js.
    palette: geometry,
    // In ramp order — the far end of `below`, through optimal, out along `above`. Each step
    // carries `roles`, and a summary of its worst role.
    steps: Object.freeze(steps),
    // Keyed by role; see regionsOf().
    regions: Object.freeze(regions),
    // Colour AND role, for every PALETTE-role pairing that fails: the answer to "which
    // individual colours are the problem, and in what way".
    failing: Object.freeze(failing),
    // THE SECOND VERDICT, deliberately not folded into the first.
    //
    // A colour painted on a tint of itself can fail while the same colour is perfectly legible
    // on the card — `palette: lime` on a light dashboard is exactly that, with the ramp
    // readable and "Optimal" in the top right not. Adding the two together would make the card
    // rewrite a palette that is fine where it is a palette, which is the wrong repair: the
    // status pill's recipe is what puts that colour on that background.
    //
    // So it is measured, named, and reported — and nothing acts on it yet.
    selfTintFits,
    selfTintConflicts: Object.freeze(selfTintConflicts),
    // Judged like a step, reported separately, and never part of a region: it is not on the
    // scale — see the note above describePalette's `invalid`.
    invalid,
    worst,
    // Only computed when something is wrong: it exists for the transformation, and a palette
    // that fits is not going to be transformed. The bisection is the expensive part of this
    // whole function, so keeping it off the common path is what keeps a fitting palette
    // cheap.
    lightness: fits ? NO_CONSTRAINT : bandsFor(backgrounds, threshold),
  });
  lastReport = { key, value };
  return value;
}

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
function regionsOf(steps) {
  const regions = [];
  let run = null;
  steps.forEach((step, index) => {
    if (!step.fits) {
      if (!run) run = { fromIndex: index, toIndex: index, from: step.key, to: step.key, keys: [step.key], maxDeficit: step.deficit };
      else {
        run.toIndex = index;
        run.to = step.key;
        run.keys.push(step.key);
        run.maxDeficit = Math.max(run.maxDeficit, step.deficit);
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

// The worst background this step has to survive. A gradient is several samples and the
// palette has to work over all of it, so the weakest pairing is the one that counts.
function nearestSample(color, samples) {
  let nearest = { sample: samples[0], distance: Infinity };
  for (const sample of samples) {
    const distance = screenDistance(color, sample);
    if (distance < nearest.distance) nearest = { sample, distance };
  }
  return nearest;
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

// The one question, answered in full.
//
//   samples: one or more background colours the card is painted on. A flat card is one; a
//            gradient is its colour stops. Never empty — the reading ladder in the platform
//            adapter always ends somewhere (see readBackgroundSamples).
export function evaluatePaletteFit(palette, samples, { threshold = VISIBILITY_THRESHOLD } = {}) {
  const backgrounds = Array.isArray(samples) && samples.length ? samples : [];
  if (!palette || !backgrounds.length) {
    // Nothing measured, so nothing claimed. "Fits" is the right answer to "should I change
    // this": with no background to judge against, leaving the user's palette alone is the
    // only defensible move.
    return {
      fits: true,
      threshold,
      samples: backgrounds,
      palette: palette ? describePalette(palette) : null,
      steps: [],
      regions: [],
      failing: [],
      invalid: null,
      worst: null,
      lightness: { forbidden: [], usable: [{ min: 0, max: 1 }], largestUsable: { min: 0, max: 1 } },
    };
  }

  // Every step keeps its geometry and gains the measurement. `deficit` is how far short a
  // failing step is; `margin` is how much room a passing one still has. Both are always
  // present and one of them is always zero — a method that moves the whole ramp needs the
  // margins to know how far it may go before it breaks something that currently works.
  const judge = (step) => {
    const nearest = nearestSample(step.color, backgrounds);
    const fits = nearest.distance >= threshold;
    return {
      ...step,
      nearest,
      fits,
      deficit: fits ? 0 : threshold - nearest.distance,
      margin: fits ? nearest.distance - threshold : 0,
    };
  };

  const geometry = describePalette(palette);
  const steps = geometry.steps.map(judge);
  const invalid = geometry.invalid ? judge(geometry.invalid) : null;

  const everything = invalid ? [...steps, invalid] : steps;
  let worst = everything[0];
  for (const step of everything) if (step.nearest.distance < worst.nearest.distance) worst = step;

  const fits = everything.every((step) => step.fits);
  return {
    fits,
    threshold,
    samples: backgrounds,
    // What the palette is shaped like, measured once — see palettes/geometry.js.
    palette: geometry,
    // In ramp order — the far end of `below`, through optimal, out along `above`.
    steps,
    // Where the collisions are, not just that there are some. See regionsOf().
    regions: regionsOf(steps),
    // The plain answer to "which colours are the problem", `invalid` included, without
    // anything having to filter for it.
    failing: everything
      .filter((step) => !step.fits)
      .map((step) => ({ key: step.key, color: step.color, deficit: step.deficit })),
    // Judged, reported separately, and never part of a region: it is not on the scale.
    invalid,
    worst: { key: worst.key, color: worst.color, distance: worst.nearest.distance, deficit: worst.deficit },
    // Only computed when something is wrong with the palette: it exists for the
    // transformation, and a palette that fits is not going to be transformed. The bisection
    // is the expensive part of this whole function, so keeping it off the common path is
    // what keeps a fitting palette cheap.
    lightness: fits ? { forbidden: [], usable: [{ min: 0, max: 1 }], largestUsable: { min: 0, max: 1 } } : bandsFor(backgrounds, threshold),
  };
}

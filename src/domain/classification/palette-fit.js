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

// Every colour a palette can paint, IN THE ORDER A READER TRAVELS IT: the far end of
// `below`, inwards to optimal, out again along `above`.
//
// Ramp order rather than declaration order, because the interesting question about a
// collision is not which steps fail but WHERE they fail — a run in the middle is a very
// different problem from a run at one end, and only a ramp-ordered list can say which it
// is. See regionsOf() below.
function rampSteps(palette) {
  const below = palette.below || [];
  const steps = [];
  for (let index = below.length; index >= 1; index -= 1) {
    steps.push({ key: `below:${index}`, color: below[index - 1] });
  }
  steps.push({ key: "optimal", color: palette.optimal });
  (palette.above || []).forEach((color, index) => steps.push({ key: `above:${index + 1}`, color }));
  return steps;
}

// `invalid` is deliberately NOT part of the ramp and just as deliberately not forgotten: it
// is a colour the card paints, it is not a point on the scale, and a transformation that
// reshapes the ramp would leave it behind. On a mid-grey card the shared neutral #7D7D7D is
// exactly as invisible as everything else, and the finding has to say so on its own.
function invalidStep(palette) {
  return palette.invalid ? { key: "invalid", color: palette.invalid } : null;
}

// The contiguous runs of colliding steps, in ramp order.
//
// This is what answers "change the whole palette, or only part of it". A blue-green-red
// ramp on a green card collides in ONE run in the middle and reaches the background at
// neither end; a black ramp on a dark card collides in one run at the bottom. Those want
// different treatment, and a flat list of failing steps cannot tell them apart.
//
// `where` names the shape directly so a strategy does not have to work it out again.
function regionsOf(steps) {
  const regions = [];
  let run = null;
  steps.forEach((step, index) => {
    if (!step.fits) {
      if (!run) run = { fromIndex: index, toIndex: index, from: step.key, to: step.key, deficit: step.deficit };
      else {
        run.toIndex = index;
        run.to = step.key;
        run.deficit = Math.max(run.deficit, step.deficit);
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
    // Named by POSITION IN THE RAMP, not by temperature. "start" is the outermost step of
    // `below`, "end" the outermost step of `above` — which for a monochrome palette with
    // only one wing means the end that exists. Calling them cold and warm would be wrong
    // for exactly those palettes.
    where:
      region.fromIndex === 0 && region.toIndex === steps.length - 1
        ? "whole"
        : region.fromIndex === 0
          ? "start"
          : region.toIndex === steps.length - 1
            ? "end"
            : "middle",
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

function bandsFor(samples, threshold) {
  const forbidden = forbiddenBands(samples, threshold);
  const usable = usableRuns(forbidden);
  return { forbidden, usable, largestUsable: largestRun(usable) };
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
      steps: [],
      regions: [],
      invalid: null,
      worst: null,
      lightness: { forbidden: [], usable: [{ min: 0, max: 1 }], largestUsable: { min: 0, max: 1 } },
    };
  }

  const judge = ({ key, color }) => {
    const nearest = nearestSample(color, backgrounds);
    const fits = nearest.distance >= threshold;
    return { key, color, nearest, fits, deficit: fits ? 0 : threshold - nearest.distance };
  };

  const steps = rampSteps(palette).map(judge);
  const invalidColor = invalidStep(palette);
  const invalid = invalidColor ? judge(invalidColor) : null;

  const everything = invalid ? [...steps, invalid] : steps;
  let worst = everything[0];
  for (const step of everything) if (step.nearest.distance < worst.nearest.distance) worst = step;

  const fits = everything.every((step) => step.fits);
  return {
    fits,
    threshold,
    samples: backgrounds,
    // In ramp order — the far end of `below`, through optimal, out along `above`.
    steps,
    // Where the collisions are, not just that there are some. See regionsOf().
    regions: regionsOf(steps),
    // Judged, reported separately, and never part of a region: it is not on the scale.
    invalid,
    worst: { key: worst.key, color: worst.color, distance: worst.nearest.distance },
    // Only computed when something is wrong with the palette: it exists for the
    // transformation, and a palette that fits is not going to be transformed. The bisection
    // is the expensive part of this whole function, so keeping it off the common path is
    // what keeps a fitting palette cheap.
    lightness: fits ? { forbidden: [], usable: [{ min: 0, max: 1 }], largestUsable: { min: 0, max: 1 } } : bandsFor(backgrounds, threshold),
  };
}

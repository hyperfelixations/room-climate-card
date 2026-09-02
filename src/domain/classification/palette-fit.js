// Whether a palette can be seen on the background the card is actually painted on. A ramp is
// foreground; whether its steps read depends on the background, which is not a constant (light
// or dark theme, a custom theme, a card-mod colour, gradient or photo).
//
// What comes back is a FINDING, not a yes/no: a method that moves lightness needs to know which
// steps collide and by how much, one that moves chroma needs it cut differently. The instrument
// is screenDistance() (core/oklch.js). Rationale, and why this replaced a declared `tunedFor`:
// interne Doku §5 „Ob eine Palette auf diesem Grund gesehen werden kann".

import { hexToOklch, oklchToHex, screenDistance } from "../../core/oklch.js";
import { describePalette } from "./palettes/geometry.js";
import { PAINT_ROLES, PALETTE_ROLES, SELF_TINTED_ROLES, backgroundsFor, foregroundFor, pointsOf, surfaceOf } from "./paint-roles.js";

// The line between "a reader can pick this out" and "this is the background". Located, not
// chosen: against test/fixtures/palette-fit-calibration.js the visible cases bottom out at
// 0.169 and the invisible ones top out at 0.154. Raising it makes the card interfere more
// often; the calibration table is where to argue a specific case.
export const VISIBILITY_THRESHOLD = 0.16;

// `invalid` is not part of the ramp and not forgotten either: it is painted, and a
// transformation that reshapes the ramp would leave it behind. describePalette() in
// palettes/geometry.js gives the ramp geometry.

// The contiguous runs of colliding steps for one role, in ramp order — what answers "change
// the whole palette, or only part". A region reports FACTS about where it sits (which steps,
// whether it reaches either end) rather than a "start"/"middle"/"end" label, which is lossy
// for a palette whose first element is `optimal`. See interne Doku §5 „Ob eine Palette…".
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

// One colour in one role, against every point of the surface — the worst pairing counts.
// `required` is the role's own bar (threshold × factor), not the global threshold.
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

// The worst of a GROUP of roles: most in trouble, or — when nothing is — least room left. Both
// matter: a method needs to know which role would break first, broken or not.
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

// Every role for one step, plus a summary PER AXIS. Two summaries, not one: the palette
// question (`accent`, `marker`) and the recipe question (self-tinted roles) each answer for
// themselves, so a transformation can read "how far may I move this before something that
// works breaks" off the palette axis without the recipe axis zeroing its margin.
function judgeStep(step, points, threshold) {
  const roles = {};
  for (const role of PAINT_ROLES) {
    // A mirroring role is the same measurement under another id — see paint-roles.js.
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

// Which lightnesses no step may occupy (Oklab L), and its complement — where a step MAY sit.
// A LIST of bands, never one merged range: each sample forbids a neighbourhood around its own
// lightness, and two distant samples leave usable space between. Solved for a NEUTRAL colour
// (the conservative case — chroma only helps) by bisecting each edge of each neighbourhood.
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

// The complement over [0, 1]: where a step MAY sit. Empty when the bands cover everything (a
// gradient containing every lightness) — a method may say so rather than invent a ramp.
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

// Nothing ruled out, nothing to say. Shared so the two "no constraint" paths cannot drift
// apart, and frozen because it is handed to every caller that hits them.
const NO_CONSTRAINT = Object.freeze({
  forbidden: Object.freeze([]),
  usable: Object.freeze([Object.freeze({ min: 0, max: 1 })]),
  largestUsable: Object.freeze({ min: 0, max: 1 }),
});

// Bands depend on the BACKGROUND alone, not the palette, so one slot is enough: a card has one
// background at a time and the calls are the same samples over and over. Keeps a gradient from
// costing three times a flat card per render.
let lastBands = null;

function bandsFor(samples, threshold) {
  const key = `${threshold}|${samples.join(",")}`;
  if (lastBands && lastBands.key === key) return lastBands.value;
  const forbidden = forbiddenBands(samples, threshold).map((band) => Object.freeze(band));
  const usable = usableRuns(forbidden).map((run) => Object.freeze(run));
  // Frozen because the same object is handed out on the next call.
  const value = Object.freeze({
    forbidden: Object.freeze(forbidden),
    usable: Object.freeze(usable),
    largestUsable: Object.freeze(largestRun(usable)),
  });
  lastBands = { key, value };
  return value;
}

// The `lightness` field is scoped to the CARD background: a self-tinted role has no fixed
// forbidden band, since moving the colour moves its background too. What a method can be told
// ahead of time is where the card rules out.

// The whole report, memoized on the VALUES it was computed from (a derived palette is rebuilt
// each call and would miss an identity check). One slot: a card has one palette on one surface
// at a time. Frozen down to its lists, since the same object is handed out on the next call.
// `surface` is `{ samples, text }` from surfaceOf() or a bare colour array; `samples` is never
// empty here (the reading ladder in the platform adapter always ends somewhere).
let lastReport = null;

// The values an answer about this palette on this surface depends on. Exported because
// adaptation.js must memoize on exactly the same thing — its strategy evaluates candidates, so
// the report memo above holds the last candidate, not the question.
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

// How much separation one place asks of a colour: threshold × the role's factor. Exported
// because the roles are also PAINTED, and the painting code must use the same number.
export function requiredSeparationOf(roleId, threshold = VISIBILITY_THRESHOLD) {
  const role = PAINT_ROLES.find((candidate) => candidate.id === roleId);
  return threshold * role.factor;
}

export function evaluatePaletteFit(palette, surface, { threshold = VISIBILITY_THRESHOLD } = {}) {
  const resolved = surfaceOf(surface);
  const backgrounds = resolved.samples;
  if (!palette || !backgrounds.length) {
    // Nothing measured, so nothing claimed: with no background to judge against, "fits" (leave
    // the palette alone) is the only defensible answer.
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

  // Every colour-and-role pairing that fails. A step can fail in one role and pass in another
  // (`palette: lime` on a light dashboard), which stops a method moving a colour that is fine
  // where it is painted. Self-tinted failures go in their own list.
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

  // One list of regions per role: a run colliding in the scale track rarely has the same
  // extent as one colliding in the status label.
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
    // The second verdict, not folded into `fits`: a colour on a tint of itself can fail while
    // the same colour reads fine on the card (`palette: lime` on a light dashboard). Adding the
    // two together would rewrite a palette that is fine where it is a palette. Measured and
    // reported; nothing acts on it yet.
    selfTintFits,
    selfTintConflicts: Object.freeze(selfTintConflicts),
    // Judged like a step, reported separately, never part of a region: not on the scale.
    invalid,
    worst,
    // Only computed when something is wrong (the bisection is the expensive part), so a
    // fitting palette stays cheap.
    lightness: fits ? NO_CONSTRAINT : bandsFor(backgrounds, threshold),
  });
  lastReport = { key, value };
  return value;
}

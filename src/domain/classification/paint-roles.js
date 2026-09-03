// WHERE A PALETTE COLOUR ACTUALLY LANDS: not on "the card" but in seven specific places, five
// of them tints of the colour ITSELF (the case a card-background-only check cannot see). So
// fit is asked per role — a step can be visible as a scale marker and invisible as a status
// label, and those want different answers.
//
// Two kinds of role. `accent` and `marker` paint the colour on something it does not tint
// (the card, the scale track): that is the PALETTE question, and the card acts on it. The rest
// paint on a tint of themselves; those failures are the pill's recipe, not the palette's, and
// `selfTinted` marks them so the two verdicts are never added together (see palette-fit.js).
//
// Every role corresponds to a real CSS rule (named in its `what`), and a test holds the two
// together: every `--tone-*` / `--room-*` property the stylesheet paints with must be covered.
// Role table and factor rationale: see internal dev doc §5 "Malrollen einer Palettenfarbe".

import { compositeOver } from "../../core/color.js";

// How much more separation a role needs than the baseline (VISIBILITY_THRESHOLD), which is
// calibrated for a large solid area. Set by rendering each role AT ITS REAL SIZE AND WEIGHT
// and looking (test/browser/visual/paint-role-calibration.spec.js), not by formula. Bracket
// cases are kept beside the numbers because that is how they were fixed.
const ROLE_FACTORS = {
  accent: 1.0,
  marker: 1.0,
  // Well below 1.0: a large area fill with hard edges, not a mark to pick out of a field
  // (WCAG asks 3:1 of a graphical object, 4.5:1 of text). Bracketed at 400px, light theme:
  // #AADDCC (0.021) barely a tint, #77EEDD (0.031) plainly a band; "barely" counts as failure.
  toneBand: 0.15,
  // The three small self-tinted roles share one number: bracketed on rendered cards, the pill
  // (fails 0.218 lime / reads 0.259 pastel) and the chip mark (fails 0.191 / reads 0.238)
  // OVERLAP, so nothing looked at separates a 12px pill from a 9px mark. Split them here, with
  // the case, if a later observation does.
  toneLabel: 1.45,
  toneIcon: 1.45,
  chipMark: 1.45,
  metricCard: 1.15,
};

// The tint alphas, copied from the view-model modules that apply them — named here so the test
// that compares them with the source has something to compare. Each keeps its own constant
// even where two are equal today, so a change to one does not silently move the other's verdict.
const TONE_SOFT_ALPHA = 0.2; // presentation/view-model/tone.js
const TONE_BAND_ALPHA = 0.2; // presentation/view-model/tone.js
const CHIP_MARK_ALPHA = 0.18; // presentation/view-model/room-layout.js
const METRIC_CARD_BG_ALPHA = 0.09; // presentation/view-model/metric-card.js
const SCALE_TRACK_TEXT_ALPHA = 0.08; // styles/scale-bar.js: color-mix(primary-text 8%, transparent)
const CHIP_OUT_BG_ALPHA = 0.1; // presentation/view-model/room-layout.js
const CHIP_BG_TEXT_ALPHA = 0.03; // styles/tokens.js: --rtc-chip-bg

// A surface point: one colour the card is painted on, with everything the roles need that does
// not depend on the palette worked out once. A point, not the whole surface, because a
// gradient is several colours and the palette has to survive the worst. `track` and
// `chipNeutral` are precomputed in pointsOf() (same for every step at this point; ~1/3 of the
// evaluation if recomputed per role). `text` may be null; the fallback is the card itself,
// what those tints are painted over.
function chipBackgrounds(color, point) {
  return [compositeOver(color, CHIP_OUT_BG_ALPHA, point.card), point.chipNeutral];
}

export const PAINT_ROLES = Object.freeze([
  Object.freeze({
    id: "accent",
    what: "the colour itself on the card: the 3px line across the top and the focus outline",
    background: (color, point) => point.card,
    factor: ROLE_FACTORS.accent,
  }),
  Object.freeze({
    id: "marker",
    what: "a scale marker: a 4x17px bar on the scale track",
    // The bar carries a 3px halo (`rgba(same colour, 0.28)`) between it and the track, so this
    // reading is optimistic by the halo's weight and never pessimistic. Modelling it would
    // need its own calibration.
    background: (color, point) => point.track,
    factor: ROLE_FACTORS.marker,
  }),
  Object.freeze({
    id: "toneBand",
    what: "the optimal band behind the scale: a 20% tint of the colour, painted on the track",
    // The one role whose FOREGROUND is not the colour itself: the band is a 20% tint, so
    // measuring the full-strength colour against the track would flatter it.
    foreground: (color, point) => compositeOver(color, TONE_BAND_ALPHA, point.track),
    background: (color, point) => point.track,
    factor: ROLE_FACTORS.toneBand,
    selfTinted: true,
  }),
  Object.freeze({
    id: "toneLabel",
    what: "the status pill: 12px/900 text on a 20% tint of ITSELF",
    background: (color, point) => compositeOver(color, TONE_SOFT_ALPHA, point.card),
    factor: ROLE_FACTORS.toneLabel,
    selfTinted: true,
  }),
  Object.freeze({
    id: "toneIcon",
    what: "the header icon: a 22px thin-stroked glyph on a 20% tint of ITSELF",
    // The same measurement as the pill (same 20% tint, same card, same separation): identical
    // over 14 palettes on 9 backgrounds, all 1206 step/role pairs. `mirrors` takes that
    // judgement instead of recomputing it; the role keeps its own id so the report stays
    // granular and a future stylesheet change can part the two.
    mirrors: "toneLabel",
    factor: ROLE_FACTORS.toneIcon,
    selfTinted: true,
  }),
  Object.freeze({
    id: "chipMark",
    what: "a room chip's mark: 9px/900 text on an 18% tint of ITSELF over the chip",
    // Two backgrounds, so two answers; the role reports the one the mark is worse on.
    backgrounds: (color, point) => chipBackgrounds(color, point).map((chip) => compositeOver(color, CHIP_MARK_ALPHA, chip)),
    factor: ROLE_FACTORS.chipMark,
    selfTinted: true,
  }),
  Object.freeze({
    id: "metricCard",
    what: "an extremes card: its value on a 9% tint of ITSELF",
    background: (color, point) => compositeOver(color, METRIC_CARD_BG_ALPHA, point.card),
    factor: ROLE_FACTORS.metricCard,
    selfTinted: true,
  }),
]);

// The role whose recipe this one uses: its own, unless it mirrors another. Resolved here so
// `mirrors` stays an optimisation, not a shape callers must know about.
function recipeOf(role) {
  return role.mirrors ? PAINT_ROLES.find((other) => other.id === role.mirrors) : role;
}

// A role paints the colour itself unless it says otherwise.
export function foregroundFor(role, color, point) {
  const recipe = recipeOf(role);
  return recipe.foreground ? recipe.foreground(color, point) : color;
}

// Every background this role paints on at one surface point. Usually one; the chip mark has
// two, because a room inside the comfort band and one outside it sit on different chips.
export function backgroundsFor(role, color, point) {
  const recipe = recipeOf(role);
  return recipe.backgrounds ? recipe.backgrounds(color, point) : [recipe.background(color, point)];
}

// Checked at MODULE LOAD, like the palette registry: a mirror pointing at nothing, at itself,
// or at a role not judged before it would produce an undefined judgement on a real card. The
// order matters — the evaluator walks PAINT_ROLES once and copies the judgement it already has.
PAINT_ROLES.forEach((role, index) => {
  if (!role.mirrors) return;
  const target = PAINT_ROLES.findIndex((other) => other.id === role.mirrors);
  if (target < 0) throw new Error(`paint role "${role.id}" mirrors "${role.mirrors}", which does not exist`);
  if (target >= index) throw new Error(`paint role "${role.id}" mirrors "${role.mirrors}", which is not judged before it`);
  const source = PAINT_ROLES[target];
  if (source.mirrors) throw new Error(`paint role "${role.id}" mirrors "${role.mirrors}", which is itself a mirror`);
  if (source.factor !== role.factor) throw new Error(`paint role "${role.id}" mirrors "${role.mirrors}" but asks for a different separation`);
  if (source.selfTinted !== role.selfTinted) throw new Error(`paint role "${role.id}" mirrors "${role.mirrors}" across the two kinds of role`);
});

export const PAINT_ROLE_IDS = Object.freeze(PAINT_ROLES.map((role) => role.id));

// The roles that answer the palette question, and the ones that answer the recipe question.
export const PALETTE_ROLES = Object.freeze(PAINT_ROLES.filter((role) => !role.selfTinted));
export const SELF_TINTED_ROLES = Object.freeze(PAINT_ROLES.filter((role) => role.selfTinted));

export const TINT_ALPHAS = Object.freeze({
  toneSoft: TONE_SOFT_ALPHA,
  toneBand: TONE_BAND_ALPHA,
  chipMark: CHIP_MARK_ALPHA,
  chipOutBackground: CHIP_OUT_BG_ALPHA,
  metricCardBackground: METRIC_CARD_BG_ALPHA,
  scaleTrackText: SCALE_TRACK_TEXT_ALPHA,
  chipBackgroundText: CHIP_BG_TEXT_ALPHA,
});

// The surface the card is painted on: every colour it sits on, and the theme's text colour. A
// bare array means "these colours, text colour unknown" — the shape call sites had before
// roles existed.
export function surfaceOf(samples, text = null) {
  if (samples && !Array.isArray(samples)) return samples;
  return Object.freeze({ samples: Object.freeze([...(samples || [])]), text });
}

// One surface point, built the only way a point may be built: roles read `track` and
// `chipNeutral` straight off it, so a hand-assembled `{ card, text }` would measure against
// `undefined`.
export function pointOf(card, text = null) {
  return Object.freeze({
    card,
    text,
    // The scale track, and a room chip neutral background: tints of the text colour over the
    // card, or the card itself when the theme would not say.
    track: text ? compositeOver(text, SCALE_TRACK_TEXT_ALPHA, card) : card,
    chipNeutral: text ? compositeOver(text, CHIP_BG_TEXT_ALPHA, card) : card,
  });
}

// The points of a surface, in the order the samples were read.
export function pointsOf(surface) {
  return surface.samples.map((card) => pointOf(card, surface.text));
}

// A colour has to be handed to backgroundsFor(), and a PALETTE role never reads it. Named
// rather than inlined so that the fact is stated where it is relied on.
const COLOUR_IS_NOT_READ = "#000000";

// The palette question as one list and one number: every background a palette colour is
// painted on, and the separation it must keep from all of them. The reduction holds because
// `accent` and `marker` both paint the colour at full strength, on something it does not tint,
// at factor 1.0 (tests hold the roles to that shape). Lets a transformation search for a
// repair without evaluating a whole report per candidate.
export function paletteDemandOf(surface, threshold) {
  const points = pointsOf(surface);
  const backgrounds = new Set();
  let required = 0;
  for (const role of PALETTE_ROLES) {
    required = Math.max(required, threshold * role.factor);
    for (const point of points) {
      for (const background of backgroundsFor(role, COLOUR_IS_NOT_READ, point)) backgrounds.add(background);
    }
  }
  return { backgrounds: Object.freeze([...backgrounds]), required };
}

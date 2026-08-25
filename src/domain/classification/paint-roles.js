// WHERE A PALETTE COLOUR ACTUALLY LANDS.
//
// A palette colour is not painted on "the card". It is painted in a handful of specific
// places, and several of them are **tints of the colour itself** — which is the case that
// breaks first and the one a card-background-only check cannot see at all.
//
// The status pill is the clearest example. Its text is `var(--tone-color)` and its
// background is `var(--tone-soft)`, which is `rgba(same colour, 0.20)` over the card. As the
// colour approaches the card background, foreground and background approach each other,
// because both are converging on the same place. `palette: lime` on a light dashboard shows
// it plainly: the ramp itself is legible, and "Optimal" in the top right is not.
//
// SO THE QUESTION IS ASKED PER ROLE. A step can be perfectly visible as a scale marker and
// invisible as a status label, and those are different problems with different answers — the
// right response to the lime case is not to move lime's middle colour, which is fine where
// it is painted on the card, but to know that the LABEL is where it fails.
//
// EVERY ROLE HERE CORRESPONDS TO A REAL CSS RULE, named in its comment, and every background
// below was checked against the colours a live card actually computes. A role that drifts
// away from the stylesheet is worse than no role at all, so a test holds the two together:
// every `--tone-*` and `--room-*` custom property the stylesheet paints with must be covered.
//
// TWO KINDS OF ROLE, and the difference decides what an answer is worth.
//
// In `accent` and `marker` the colour is painted on something it has no influence over: the
// card, and the scale track. Move the colour and the separation moves with it, at full
// leverage. That is the PALETTE question — "can this ramp be seen here" — and it is the one
// the card has always asked and the one it acts on.
//
// The rest are painted on a tint of THEMSELVES. Move the colour and its background follows;
// what is left is the tint's own weight, so a colour close to the card stays close to its own
// tint however it is chosen. Those failures are real and they are NOT the palette's fault:
// the answer to an unreadable status pill is a different recipe for the pill, not a different
// palette. `selfTinted` marks them so that the two are never added together — see the
// two verdicts in palette-fit.js.

import { compositeOver } from "../../core/color.js";

// How much more separation a role needs than the baseline, which is calibrated for a large,
// solidly painted area (see VISIBILITY_THRESHOLD in palette-fit.js).
//
// Size and weight matter and WCAG says so too, with its separate floors for large and normal
// text. A 4x17 px solid marker is the easy case; nine-pixel text inside a chip is not.
//
// These numbers were set by rendering each role AT ITS REAL SIZE AND WEIGHT against its real
// background and looking at the result — see test/browser/visual/paint-role-calibration.spec.js.
// They are not derived from the font size by formula, because the relationship between size,
// weight and legibility is not one.
const ROLE_FACTORS = {
  accent: 1.0,
  marker: 1.0,
  // Well below 1.0, and deliberately. The band is a large area fill with hard edges against
  // a uniform track, not a mark to be picked out of a field, and the baseline is calibrated
  // for the latter. WCAG separates these cases the same way, asking 4.5:1 of text and 3:1 of
  // a graphical object.
  //
  // Bracketed on real cards at 400px, light theme: `palette: white` (0.012) paints no band at
  // all, #AADDCC (0.021) is barely a tint, #77EEDD (0.031) is plainly a band, and pastel's own
  // optimal (0.055) is unmistakable. 0.024 sits between the two that matter — a band you have
  // to hunt for is not doing its job, so "barely" counts as a failure.
  toneBand: 0.15,
  // THE THREE SMALL SELF-TINTED ROLES SHARE ONE NUMBER, and that is a finding rather than a
  // shortcut. Bracketed on rendered cards, the pill fails at 0.218 (lime) and reads at 0.259
  // (pastel); the chip mark fails at 0.191 (lime) and reads, with effort, at 0.238 (pastel).
  // Those two brackets OVERLAP, so nothing that was looked at separates a 12px pill from a
  // 9px mark, and inventing a difference would be a number nobody had seen. 0.232 satisfies
  // both. If a later observation does separate them, it belongs here with its case.
  toneLabel: 1.45,
  toneIcon: 1.45,
  chipMark: 1.45,
  metricCard: 1.15,
};

// The tint alphas, copied from the view-model modules that apply them. Kept here as named
// constants rather than magic numbers so the test that compares them with the source has
// something to compare.
const TONE_SOFT_ALPHA = 0.2; // presentation/view-model/tone.js
// Its own constant at the source and therefore its own constant here, even though the two are
// equal today: reading `--tone-band` off `--tone-soft` would make a change to one of them
// silently move the other's verdict.
const TONE_BAND_ALPHA = 0.2; // presentation/view-model/tone.js
const CHIP_MARK_ALPHA = 0.18; // presentation/view-model/room-layout.js
const METRIC_CARD_BG_ALPHA = 0.09; // presentation/view-model/metric-card.js
const SCALE_TRACK_TEXT_ALPHA = 0.08; // styles/scale-bar.js: color-mix(primary-text 8%, transparent)
const CHIP_OUT_BG_ALPHA = 0.1; // presentation/view-model/room-layout.js
const CHIP_BG_TEXT_ALPHA = 0.03; // styles/tokens.js: --rtc-chip-bg

// A SURFACE POINT: one colour the card is painted on, with everything the roles need that
// does NOT depend on the palette worked out once.
//
// A point rather than the whole surface, because a gradient is several colours and each role
// has to be judged against every one of them; the palette has to survive the worst. The
// evaluator walks the points, and a role only ever sees one.
//
// `track` and `chipNeutral` are precomputed in pointsOf() rather than inside the roles: they
// are the same for every step of every palette at this point, and recomputing them per step
// and per role was measured at roughly a third of the whole evaluation on a five-stop
// gradient without ever producing a different answer.
//
// `text` may be null when the theme would not say. Both derived colours are tints of it
// rather than of the card, and the honest fallback is the card itself: it is what those tints
// are painted OVER, so the answer is off by the tint own weight, a few percent, where a
// guessed text colour could be wrong by any amount.
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
    // The bar carries a `box-shadow: 0 0 0 3px rgba(same colour, 0.28)` halo, so its
    // immediate surround is a tint of itself and the track is three pixels further out. The
    // halo always lies BETWEEN the bar and the track, so it can soften the edge but never
    // reverse it: this reading is optimistic by the halo's weight and never pessimistic.
    // Modelling it would need its own calibration, and an uncalibrated number would be worse
    // than a stated boundary.
    background: (color, point) => point.track,
    factor: ROLE_FACTORS.marker,
  }),
  Object.freeze({
    id: "toneBand",
    what: "the optimal band behind the scale: a 20% tint of the colour, painted on the track",
    // The one role whose FOREGROUND is not the colour itself. The band is painted at 20%
    // alpha, so measuring the full-strength colour against the track would flatter it badly:
    // a tint is much closer to what it is painted over than the colour is.
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
    background: (color, point) => compositeOver(color, TONE_SOFT_ALPHA, point.card),
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

// A role paints the colour itself unless it says otherwise.
export function foregroundFor(role, color, point) {
  return role.foreground ? role.foreground(color, point) : color;
}

// Every background this role paints on at one surface point. Usually one; the chip mark has
// two, because a room inside the comfort band and one outside it sit on different chips.
export function backgroundsFor(role, color, point) {
  return role.backgrounds ? role.backgrounds(color, point) : [role.background(color, point)];
}

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

// THE SURFACE the card is painted on: every colour it sits on, and the theme's text colour.
//
// A bare array is accepted and means "these colours, and the theme would not say what its
// text colour is" — the shape most call sites had before roles existed, and still the honest
// description of a card that has only been asked about its background.
export function surfaceOf(samples, text = null) {
  if (samples && !Array.isArray(samples)) return samples;
  return Object.freeze({ samples: Object.freeze([...(samples || [])]), text });
}

// ONE SURFACE POINT, built the only way a point may be built.
//
// A role reads `track` and `chipNeutral` straight off the point, so a hand-assembled
// `{ card, text }` would silently measure against `undefined`. Constructing them here is what
// makes that impossible.
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

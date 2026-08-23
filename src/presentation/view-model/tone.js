// A classification turned into the tone the card actually paints with.
//
// This is exactly where a SEMANTIC CLASSIFICATION VALUE becomes a CSS-ready one.
// The classification arriving here carries the hex colour its tier or the entity's
// value_color attribute declared — a fact about the classification. What comes out
// carries rgba() derivations for the soft background, the border and the band,
// which are facts about how the card looks. The domain never crosses that line.
//
// The label follows the same rule: a built-in tier carries a translation key, a
// custom profile carries the verbatim level the user wrote, and an entity-provided
// classification carries the integration's own wording. Only the first is
// translated.

import { rgba } from "../../core/color.js";

// The four alphas the tone is derived at. Named because each one appears in both a
// render path and a patch path, and a silent drift between the two would be a
// visual bug no test shape would catch.
export const TONE_SOFT_ALPHA = 0.20;
export const TONE_BORDER_ALPHA = 0.38;
export const TONE_BAND_ALPHA = 0.20;

// The colour of NOTHING TO SAY: a card with no usable value, and a room chip whose sensor
// has none. It belongs here rather than in a palette because it is not a classification at
// all — no palette should have an opinion about the absence of one — and it lives in ONE
// place for the same reason the alphas above do. It is read from two modules that render
// it side by side, and two copies drifting apart would be a visual bug no test shape
// would catch.
export const NO_DATA_COLOR = "#7F8792";

export function toneLabel(classification, texts) {
  return classification.level || texts.t(classification.levelKey);
}

// The purely numeric part of a classification, with its level translated. Kept
// separate from buildTone() because the physical-validity and fallback paths need
// the tier without an icon or a soft colour.
export function numericTone(classification, texts) {
  return {
    level: toneLabel(classification, texts),
    color: classification.color,
    score: classification.score,
    zone: classification.zone,
  };
}

export function buildTone({ classification, icon, texts }) {
  return {
    label: toneLabel(classification, texts),
    color: classification.color,
    score: classification.score,
    zone: classification.zone,
    source: classification.source,
    profileId: classification.profileId,
    icon,
    soft: rgba(classification.color, TONE_SOFT_ALPHA),
  };
}

// The card root's own custom properties. One string, built once per render and
// reused by the patch path, so the two can never disagree.
export function toneStyleDeclaration(tone) {
  return `--tone-color:${tone.color};--tone-soft:${tone.soft};--tone-border:${rgba(tone.color, TONE_BORDER_ALPHA)};--tone-band:${rgba(tone.color, TONE_BAND_ALPHA)};`;
}

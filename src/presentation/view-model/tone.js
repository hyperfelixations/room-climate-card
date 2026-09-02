// Converts semantic classification into CSS-ready tone values. Built-in tier
// labels are translated; custom and entity-provided labels remain verbatim.

import { rgba } from "../../core/color.js";
import { tintRecipeFor } from "../../domain/classification/tone-legibility.js";

// Shared by full-render and patch paths to prevent visual drift.
export const TONE_SOFT_ALPHA = 0.20;
export const TONE_BORDER_ALPHA = 0.38;
export const TONE_BAND_ALPHA = 0.20;

// Shared neutral for missing card values and room readings; absence is not a tier.
export const NO_DATA_COLOR = "#7F8792";

export function toneLabel(classification, texts) {
  return classification.level || texts.t(classification.levelKey);
}

// Classification data without icon or CSS derivations, for validity/fallback paths.
export function numericTone(classification, texts) {
  return {
    level: toneLabel(classification, texts),
    color: classification.color,
    score: classification.score,
    zone: classification.zone,
  };
}

export function buildTone({ classification, icon, texts, tintRecipes = null }) {
  // Reuse the domain-prepared self-tint legibility recipe for pill, badge and chip
  // mark. Without a surface-specific recipe the lookup is the identity.
  const recipe = tintRecipeFor(tintRecipes, classification.color);
  return {
    label: toneLabel(classification, texts),
    color: classification.color,
    // Adjusted only for self-tinted ink; markers and accent lines retain `color`.
    ink: recipe.ink,
    score: classification.score,
    zone: classification.zone,
    source: classification.source,
    profileId: classification.profileId,
    icon,
    soft: rgba(classification.color, TONE_SOFT_ALPHA * recipe.tintFactor),
  };
}

// One declaration shared by full-render and patch paths.
export function toneStyleDeclaration(tone) {
  // Palette colour drives accents; adjusted ink drives self-tinted text, icon and border.
  return `--tone-color:${tone.color};--tone-ink:${tone.ink};--tone-soft:${tone.soft};--tone-border:${rgba(tone.ink, TONE_BORDER_ALPHA)};--tone-band:${rgba(tone.color, TONE_BAND_ALPHA)};`;
}

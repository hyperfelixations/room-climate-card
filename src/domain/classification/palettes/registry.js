// The palettes the card ships, and the one shape every palette has to have.
//
// Validated at MODULE LOAD rather than on use, for the same reason the translation
// registry is: a palette with a hole in it produces a card with an invisible value, and
// the honest moment to find that out is the build, not a reading that happens to land
// three steps above optimal. The check runs over user-supplied palettes too —
// normalizePalette() in the configuration layer calls assertPalette() on a written-out
// one — so both roads into the resolver arrive at the same guarantee.

import { isHexColor } from "../../../core/color.js";
import { pastel } from "./pastel.js";
import { vivid } from "./vivid.js";

export const DEFAULT_PALETTE_ID = "pastel";

// What "no judgement is possible" looks like when a palette does not say. Deliberately a
// plain grey: it has to read as "off the scale" beside any ramp, warm or cold.
export const NEUTRAL_INVALID_COLOR = "#8A8A8A";

function assertColor(value, path) {
  if (typeof value !== "string" || !isHexColor(value.trim())) {
    throw new Error(`Invalid configuration: ${path} must be a 3/4/6/8-digit hex color.`);
  }
}

// Both wings must exist, or a profile that reaches in that direction has nowhere to go.
// A profile that never reaches one way — CO2 has no "too little" — simply leaves that
// wing untouched, which is not the same thing as the palette not having one.
function assertWing(wing, path) {
  if (!Array.isArray(wing) || wing.length === 0) {
    throw new Error(`Invalid configuration: ${path} must be a non-empty list of colors, running outwards from the middle.`);
  }
  // 1-based, because a wing is addressed by "steps from optimal" everywhere else.
  wing.forEach((color, index) => assertColor(color, `${path}[${index + 1}]`));
}

// `path` names where the palette came from, so a broken YAML palette reports the option
// the user wrote rather than an internal id they have never seen.
export function assertPalette(palette, path = "palette") {
  if (!palette || typeof palette !== "object" || Array.isArray(palette)) {
    throw new Error(`Invalid configuration: ${path} must be an object.`);
  }
  assertColor(palette.optimal, `${path}.optimal`);
  assertWing(palette.above, `${path}.above`);
  assertWing(palette.below, `${path}.below`);
  if (palette.invalid !== undefined && palette.invalid !== null) assertColor(palette.invalid, `${path}.invalid`);
  return palette;
}

// A palette in the shape the resolver reads, with the one optional field filled in. Kept
// separate from assertPalette() so validation stays a question and normalization stays an
// answer.
export function completePalette(palette) {
  return Object.freeze({
    ...palette,
    invalid: palette.invalid ?? NEUTRAL_INVALID_COLOR,
    above: Object.freeze([...palette.above]),
    below: Object.freeze([...palette.below]),
  });
}

export const CLASSIFICATION_PALETTE_REGISTRY = Object.freeze(
  Object.fromEntries(
    [pastel, vivid].map((palette) => [palette.id, completePalette(assertPalette(palette, `palette "${palette.id}"`))])
  )
);

export function paletteForName(name) {
  return CLASSIFICATION_PALETTE_REGISTRY[name] || null;
}

export const DEFAULT_PALETTE = CLASSIFICATION_PALETTE_REGISTRY[DEFAULT_PALETTE_ID];

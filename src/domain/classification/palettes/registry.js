// The palettes the card ships, and the one shape every palette has to have.
//
// Validated at MODULE LOAD rather than on use, for the same reason the translation
// registry is: a palette with a hole in it produces a card with an invisible value, and
// the honest moment to find that out is the build, not a reading that happens to land on
// position 7. The check runs over user-supplied palettes too — normalizePalette() in the
// configuration layer calls assertPalette() on a literal one — so both roads into the
// resolver arrive at the same guarantee.

import { isHexColor } from "../../../core/color.js";
import { pastel } from "./pastel.js";
import { vivid } from "./vivid.js";

export const DEFAULT_PALETTE_ID = "pastel";

// `path` names where the palette came from, so a broken YAML palette reports the option
// the user wrote rather than an internal id they have never seen.
export function assertPalette(palette, path = "palette") {
  if (!palette || typeof palette !== "object") throw new Error(`Invalid configuration: ${path} must be an object.`);
  if (!Array.isArray(palette.ramp) || palette.ramp.length === 0) {
    throw new Error(`Invalid configuration: ${path}.ramp must be a non-empty list of colors.`);
  }
  palette.ramp.forEach((color, index) => {
    if (typeof color !== "string" || !isHexColor(color.trim())) {
      // 1-based, because a ramp is addressed by position everywhere else.
      throw new Error(`Invalid configuration: ${path}.ramp[${index + 1}] must be a 3/4/6/8-digit hex color.`);
    }
  });
  if (typeof palette.invalid !== "string" || !isHexColor(palette.invalid.trim())) {
    throw new Error(`Invalid configuration: ${path}.invalid must be a 3/4/6/8-digit hex color.`);
  }
  return palette;
}

export const CLASSIFICATION_PALETTE_REGISTRY = Object.freeze(
  Object.fromEntries(
    [pastel, vivid].map((palette) => [palette.id, Object.freeze(assertPalette(palette, `palette "${palette.id}"`))])
  )
);

export function paletteForName(name) {
  return CLASSIFICATION_PALETTE_REGISTRY[name] || null;
}

export const DEFAULT_PALETTE = CLASSIFICATION_PALETTE_REGISTRY[DEFAULT_PALETTE_ID];

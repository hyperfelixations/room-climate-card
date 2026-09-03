// The palettes the card ships, the one shape every palette must have, and the words that
// reach them.
//
// Validated at MODULE LOAD, like the translation registry: a palette with a hole in it makes
// an invisible value, and the build is the honest place to catch it. assertPalette() runs
// over user-written palettes too (via normalizePalette()), so there is one definition of "a
// usable palette". See internal dev doc §5 "Farbpaletten".

import { isHexColor, parseColorToken } from "../../../core/color.js";
import { colorVision } from "./color-vision.js";
import { MAX_GRADIENT_COLORS, gradientPalette } from "./gradient.js";

// Re-exported so the composition root has one door to the palette vocabulary.
export { MAX_GRADIENT_COLORS };
import { monochromePalette } from "./monochrome.js";
import { pastel } from "./pastel.js";
import { signal } from "./signal.js";
import { vivid } from "./vivid.js";

export const DEFAULT_PALETTE_ID = "pastel";

// "No judgement is possible", in one colour: `invalid` when the palette names none, and a
// value the entity classified itself without a colour. THIS grey is measured — #7D7D7D
// reaches 4,12 : 1 on both a light and a dark card, the most a single grey can do — and it
// belongs to no palette, because this value sits on no ramp. See internal dev doc §5 "Farbpaletten".
export const NEUTRAL_COLOR = "#7D7D7D";

// WHERE A PALETTE CAME FROM, which decides whether the card may change it: `builtin` and
// `derived` (a ramp the card computed from `palette: teal` / `palette: blue-red`) may be
// adapted; `custom` (a palette written out in YAML) is left alone. Declared, not measured —
// nothing about the colours says whether a person chose them — and fixed at construction, so
// it cannot drift. `custom` is the default. See internal dev doc §5 "Anpassbare Paletten nach
// Herkunft".
export const PALETTE_ORIGINS = Object.freeze(["builtin", "derived", "custom"]);
const DEFAULT_ORIGIN = "custom";

function assertColor(value, path) {
  if (typeof value !== "string" || !isHexColor(value.trim())) {
    throw new Error(`Invalid configuration: ${path} must be a 3/4/6/8-digit hex color.`);
  }
}

// A wing may be missing (CO2/PM2.5 have no "too little", a single-colour palette has neither
// direction). What it may NOT be is present-but-malformed, which is what this still catches.
function assertWing(wing, path) {
  if (wing === undefined || wing === null) return;
  if (!Array.isArray(wing)) {
    throw new Error(`Invalid configuration: ${path} must be a list of colors, running outwards from the middle.`);
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

// A palette in the shape the resolver reads, optional fields filled in. Separate from
// assertPalette() so validation stays a question and normalization an answer. `aliases` is
// dropped — which words reach a palette is the registry's business, not the palette's.
export function completePalette(palette) {
  return Object.freeze({
    id: palette.id,
    optimal: palette.optimal,
    above: Object.freeze([...(palette.above || [])]),
    below: Object.freeze([...(palette.below || [])]),
    invalid: palette.invalid ?? NEUTRAL_COLOR,
    origin: PALETTE_ORIGINS.includes(palette.origin) ? palette.origin : DEFAULT_ORIGIN,
    // Only a derived palette has one: the colour(s) it was calculated from. Carried so a
    // derived ramp can be REBUILT from its seed rather than bent (palettes/legible.js).
    source: palette.source ? Object.freeze({ ...palette.source }) : null,
  });
}

const SHIPPED = [pastel, vivid, colorVision, signal];

// One palette, several words for it: the index maps every accepted word (id + aliases) to the
// frozen palette, which keeps exactly one `id`. A user searches by the name of the thing they
// have — a tritanope writes `tritan`.
export const CLASSIFICATION_PALETTE_REGISTRY = Object.freeze(
  Object.fromEntries(
    SHIPPED.flatMap((palette) => {
      const complete = completePalette({ ...assertPalette(palette, `palette "${palette.id}"`), origin: "builtin" });
      return [palette.id, ...(palette.aliases || [])].map((key) => [key, complete]);
    })
  )
);

export function paletteForName(name) {
  return CLASSIFICATION_PALETTE_REGISTRY[name] || null;
}

export const DEFAULT_PALETTE = CLASSIFICATION_PALETTE_REGISTRY[DEFAULT_PALETTE_ID];

// A palette DERIVED from a single colour, named or hex. A second lookup rather than 148 more
// registry entries: a registered name is a design, a monochrome ramp a calculation, and a
// registered name always wins. Returns null for anything that is neither, so the configuration
// layer can produce one error message naming both roads.
export function paletteForColor(value) {
  const hex = parseColorToken(value);
  if (!hex) return null;
  const id = typeof value === "string" ? value.trim().toLowerCase() : String(value);
  // Alpha is dropped from the SEED: a ramp is a statement about L, chroma and hue, and there
  // is no way to derive ten transparencies from one. A written-out palette still takes an
  // 8-digit colour per step.
  const seed = hex.length > 7 ? hex.slice(0, 7) : hex;
  return completePalette({ ...monochromePalette(seed, id), origin: "derived", source: { color: seed } });
}

// A palette DERIVED FROM TWO OR THREE COLOURS joined by hyphens: `blue-red`. A third lookup
// after the registered-name and single-colour lookups, so a name that is also a hyphen
// spelling (`orange-red`, `color-vision`, `protan-deutan`) keeps its meaning and only a
// spelling that is neither reaches here. Returns null for anything that is not two or three
// hyphen-joined colours, so the configuration layer can name every road and the part at fault.
export function paletteForGradient(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("-");
  if (parts.length < 2 || parts.length > MAX_GRADIENT_COLORS) return null;
  const hexes = parts.map((part) => parseColorToken(part));
  if (hexes.some((hex) => !hex)) return null;
  // Alpha dropped from every anchor — see paletteForColor().
  const seeds = hexes.map((hex) => (hex.length > 7 ? hex.slice(0, 7) : hex));
  // The id is built from the trimmed, lowercased PARTS, so `blue - red` and `Blue-Red` are one
  // palette. It ends up in the fit report's memo key.
  const id = parts.map((part) => part.trim().toLowerCase()).join("-");
  return completePalette({ ...gradientPalette(seeds, id), origin: "derived", source: { colors: seeds } });
}

// Whether a palette suits its background is not decided here: it is measured in
// ../palette-fit.js and acted on in ./adaptation.js (called by buildCardDomainModel()).

// Every word a `palette:` option may be, aliases included, for the message a user sees when
// theirs was none of them. The 148 colour names stay out — the message names that road
// separately.
export function paletteKeys() {
  return Object.keys(CLASSIFICATION_PALETTE_REGISTRY);
}

// The palettes the card ships, the one shape every palette has to have, and the words
// that reach them.
//
// Validated at MODULE LOAD rather than on use, for the same reason the translation
// registry is: a palette with a hole in it produces a card with an invisible value, and
// the honest moment to find that out is the build, not a reading that happens to land
// three steps above optimal. The check runs over user-supplied palettes too —
// normalizePalette() in the configuration layer calls assertPalette() on a written-out
// one — so both roads into the resolver arrive at the same guarantee, and there is
// exactly ONE definition of "a usable palette" rather than one for the card and a
// stricter one for its users.

import { isHexColor, parseColorToken } from "../../../core/color.js";
import { colorVision } from "./color-vision.js";
import { MAX_GRADIENT_COLORS, gradientPalette } from "./gradient.js";

// Re-exported so the composition root has one door to the palette vocabulary rather than
// reaching past this file into the generator.
export { MAX_GRADIENT_COLORS };
import { monochromePalette } from "./monochrome.js";
import { pastel } from "./pastel.js";
import { signal } from "./signal.js";
import { vivid } from "./vivid.js";

export const DEFAULT_PALETTE_ID = "pastel";

// "No judgement is possible", in one colour: an invalid reading when the palette does not
// name one, and a value the entity classified itself without supplying a colour.
//
// It is a plain grey because it has to read as "off the scale" beside any ramp, warm or
// cold — and it is THIS grey because that is measured. A card colour is foreground on a
// light background and on a dark one, and the whole grey axis was walked against both:
// #7D7D7D reaches 4,12 : 1 on each, which is the most a single grey can do. (The value
// this replaced came out at 2,13 : 1 on a light card, because it was the pastel palette's
// own warm grey wired in where no palette should have had a say.)
export const NEUTRAL_COLOR = "#7D7D7D";

// WHERE A PALETTE CAME FROM, which decides whether the card is entitled to change it.
//
//   builtin   one of the four the card ships. The card designed it, so the card may adapt
//             it when the background makes it unreadable.
//   derived   calculated from what the user wrote after `palette:` — today a single colour,
//             `palette: teal`. The user named a COLOUR and asked the card to build a ramp
//             out of it, so the ramp is the card's work and the card may rebuild it.
//   custom    written out in YAML as {optimal, above, below}. Every colour in it is a
//             deliberate choice somebody typed. The card does NOT touch it.
//
// The distinction is intent, not measurement, which is why it is declared rather than
// derived: nothing about the colours themselves can tell you whether a person chose them.
// It is also the one thing `tunedFor` got right and the reason a field survives here at
// all — unlike a claim about which background suits a palette, an origin cannot drift away
// from the truth, because it is fixed at construction.
//
// `custom` is the DEFAULT, deliberately. A palette that forgot to say where it came from is
// left alone, which is the harmless direction to be wrong in.
export const PALETTE_ORIGINS = Object.freeze(["builtin", "derived", "custom"]);
const DEFAULT_ORIGIN = "custom";

function assertColor(value, path) {
  if (typeof value !== "string" || !isHexColor(value.trim())) {
    throw new Error(`Invalid configuration: ${path} must be a 3/4/6/8-digit hex color.`);
  }
}

// A wing may be missing, and a missing wing is not a broken palette.
//
// CO2 and PM2.5 have no "too little" to colour, a single-colour palette has neither
// direction, and a generated ramp on `white` has nowhere paler to go. Requiring both
// wings would have made all three of those an error for no gain: a wing nothing asks for
// costs nothing, and a wing that cannot exist cannot be conjured. What a wing may NOT be
// is present-but-malformed, which is what this still catches.
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

// A palette in the shape the resolver reads, with the optional fields filled in. Kept
// separate from assertPalette() so validation stays a question and normalization stays an
// answer.
//
// `aliases` is dropped rather than carried: which words reach a palette is the registry's
// business, and the object the card renders from is the palette itself.
export function completePalette(palette) {
  return Object.freeze({
    id: palette.id,
    optimal: palette.optimal,
    above: Object.freeze([...(palette.above || [])]),
    below: Object.freeze([...(palette.below || [])]),
    invalid: palette.invalid ?? NEUTRAL_COLOR,
    origin: PALETTE_ORIGINS.includes(palette.origin) ? palette.origin : DEFAULT_ORIGIN,
    // Only a derived palette has one: the colour it was calculated from. Carried because a
    // derived ramp can be REBUILT from its seed, which is a far better way to adapt it than
    // pushing its finished steps around — see palettes/adaptation.js.
    source: palette.source ? Object.freeze({ ...palette.source }) : null,
  });
}

const SHIPPED = [pastel, vivid, colorVision, signal];

// One palette, several words for it.
//
// A user searches by the name of the thing they have — a tritanope writes `tritan`, and
// finding nothing there would be worse than any tidiness gained by insisting on the one
// canonical spelling. So the index maps every accepted word to the palette, while the
// palette keeps exactly one `id`, which is what documentation, diagnostics and golden
// screenshots name it by.
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

// A palette DERIVED from a single colour, named or written as a hex.
//
// Deliberately a second lookup rather than 148 more entries in the registry above: a
// registered palette is a design somebody made, and a monochrome ramp is a calculation.
// Keeping them apart is also what makes the precedence obvious — a registered name always
// wins, so adding a palette called `teal` one day would take that word back without
// breaking the mechanism.
//
// Returns null for anything that is neither, which is what lets the configuration layer
// produce one error message naming both roads.
export function paletteForColor(value) {
  const hex = parseColorToken(value);
  if (!hex) return null;
  const id = typeof value === "string" ? value.trim().toLowerCase() : String(value);
  // Alpha is dropped from the SEED, and dropping it is the honest answer rather than an
  // oversight: a ramp is a statement about lightness, colourfulness and hue, and there is
  // no meaningful way to derive ten more transparencies from one. Keeping it on the
  // middle alone would make the middle behave unlike every other step of its own ramp.
  // A written-out palette still takes an 8-digit colour per step, where the user chose
  // each one deliberately.
  const seed = hex.length > 7 ? hex.slice(0, 7) : hex;
  return completePalette({ ...monochromePalette(seed, id), origin: "derived", source: { color: seed } });
}

// A palette DERIVED FROM TWO OR THREE COLOURS, joined by hyphens: `blue-red`.
//
// A THIRD LOOKUP RATHER THAN A BRANCH INSIDE THE SECOND, and the order is what resolves the
// only ambiguity the hyphen creates. Five CSS colours can be written either way —
// `orangered` and `orange-red`, and the same for blueviolet, greenyellow, limegreen and
// yellowgreen — and two shipped palettes are spelled with one (`color-vision`,
// `protan-deutan`). Because a registered name is tried first and a single colour second,
// each of those words keeps the meaning it already had, and only a spelling that is neither
// reaches this. Nothing had to be reserved and nothing had to be excluded.
//
// Returns null for anything that is not two or three colours joined by hyphens, so the
// configuration layer can produce one message naming every road — and, when the value does
// look like a gradient, say which part of it was the problem.
export function paletteForGradient(value) {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("-");
  if (parts.length < 2 || parts.length > MAX_GRADIENT_COLORS) return null;
  const hexes = parts.map((part) => parseColorToken(part));
  if (hexes.some((hex) => !hex)) return null;
  // Alpha is dropped from every anchor, for the reason written out in paletteForColor():
  // a ramp is a statement about lightness, colourfulness and hue, and transparency does not
  // interpolate into one.
  const seeds = hexes.map((hex) => (hex.length > 7 ? hex.slice(0, 7) : hex));
  // The id is built from the PARTS rather than from the raw string, so `blue - red` and
  // `Blue-Red` are the same palette rather than two spellings with two identities. It ends up
  // in the fit report's memo key, among other places, and a palette is what its colours are.
  const id = parts.map((part) => part.trim().toLowerCase()).join("-");
  return completePalette({ ...gradientPalette(seeds, id), origin: "derived", source: { colors: seeds } });
}

// WHETHER A PALETTE SUITS THE BACKGROUND IT IS PAINTED ON is not decided here.
//
// It used to be, on a `tunedFor` field each palette carried. That field is gone: it was an
// answer about two canonical backgrounds, and the background a card is actually on is
// whatever a theme or card-mod made it. The measurement lives in ../palette-fit.js and the
// seam that acts on it in ./adaptation.js, which is what buildCardDomainModel() calls.

// Every word a `palette:` option may be, for the message a user sees when theirs was none
// of them. All of them, aliases included: a word that works but is not listed would send
// somebody looking for a mistake they did not make. The 148 colour names stay out — they
// would bury the palettes, and the message names that road separately.
export function paletteKeys() {
  return Object.keys(CLASSIFICATION_PALETTE_REGISTRY);
}

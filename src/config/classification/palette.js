// The `palette:` option: which colours the card's classification ramp is made of.
//
// Three spellings, tried in this order, and the order is the contract:
//
//   palette: vivid                    a shipped palette
//   palette: teal                     any CSS colour name or hex — a derived one-colour ramp
//   palette: blue-red                 two or three hyphen-joined colours — an interpolated ramp
//   palette: {optimal, above, below}  a palette written out
//
// A shipped palette wins over a colour name, and a name over a hyphenated pair. That order
// also makes the hyphen safe: the five two-way CSS colours (orangered/orange-red, …) and
// the two hyphenated shipped palettes (color-vision, protan-deutan) resolve before the
// split is tried, so nothing had to be reserved.
//
// The literal form is lenient by design (`optimal: #1DB85D` is a YAML COMMENT): a colour
// may be written with or without `#`, quoted or not, or by name; a wing may be a list or
// comma-separated; only `optimal` is required. Everything is normalized to the resolver's
// one shape before it leaves this file.
//
// Palette lookups are INJECTED like the unit and zone lookups next door — the config layer
// must not import the domain registry. parseColorToken() is imported directly from core:
// what counts as a written colour is what CSS says, not domain knowledge.
//
// Full contract: see internal dev doc §5 "YAML-Palettenvertrag".

import { parseColorToken } from "../../core/color.js";
import { assertAllowedKeys, isPlainObject, optionalString } from "../primitives.js";
import { pathError } from "../errors.js";

// A stray `#` produces an EMPTY value, not a wrong one, so the message explains an absence.
const COMMENT_HINT =
  "a `#` after a space starts a comment in YAML, so writing `#1DB85D` leaves this empty — write it without the `#` (1DB85D), in quotes (\"#1DB85D\"), or as a color name (teal)";

const COLOR_FORMS = 'a hex color such as 1DB85D or "#1DB85D", or a CSS color name such as teal';

// A digits-only value YAML turned into a number: too few digits to tell a colour from a
// shorthand, or too many to be a colour. Its own sentence, distinct from a misspelt word.
const NUMBER_HINT =
  'a color written only in digits has to be six of them — put shorter or longer values in quotes, for example "080" or "#0808080"';

// One written colour, in any of the spellings a person uses.
function normalizeColor(value, path) {
  if (value === undefined || value === null || value === "") pathError(path, COMMENT_HINT);
  const color = parseColorToken(value);
  if (!color) {
    pathError(path, typeof value === "number" ? `${value} is not a color — ${NUMBER_HINT}` : `"${value}" is not a color — write ${COLOR_FORMS}`);
  }
  return color;
}

// One wing. Absent (`!(key in palette)`) means the palette does not reach that way, which
// is allowed; present-and-empty is almost always a `#` comment and gets the explanation.
function normalizeWing(palette, key, path) {
  if (!(key in palette)) return [];
  const raw = palette[key];
  if (raw === undefined || raw === null) pathError(`${path}.${key}`, COMMENT_HINT);

  // A string may carry several colours; splitting inside an array entry too rescues
  // `above: ["FD9808, EE2046"]`.
  const tokens = (Array.isArray(raw) ? raw : [raw]).flatMap((entry) =>
    typeof entry === "string" ? entry.split(/[\s,]+/).filter(Boolean) : [entry]
  );
  if (tokens.length === 0) pathError(`${path}.${key}`, `must name at least one color, running outwards from the middle — ${COLOR_FORMS}`);
  return tokens.map((token, index) => normalizeColor(token, `${path}.${key}[${index + 1}]`));
}

// The three ways a hyphenated value can be wrong, each named specifically. Returns silently
// when the value is not hyphenated, so the caller falls through to the general message.
function gradientError(text, limit) {
  if (!text.includes("-")) return;
  const parts = text.trim().split("-");
  if (parts.length > limit) {
    pathError(
      "palette",
      `"${text}" names ${parts.length} colors — a gradient palette takes two, for the two ends, or three, where the middle one is the optimal color`
    );
  }
  const emptyAt = parts.findIndex((part) => part.trim() === "");
  if (emptyAt >= 0) {
    pathError("palette", `"${text}" has an empty part where a color should be — write two or three colors with a single hyphen between them, such as "blue-green-red"`);
  }
  const badAt = parts.findIndex((part) => !parseColorToken(part));
  if (badAt >= 0) {
    pathError("palette", `"${parts[badAt]}" in "${text}" is not a color — write ${COLOR_FORMS}`);
  }
}

export function normalizePalette(value, { paletteForName, paletteForColor, paletteForGradient, paletteGradientLimit, paletteKeys, assertPalette, completePalette }) {
  if (value === undefined || value === null) return paletteForName(null);

  if (typeof value === "string" || typeof value === "number") {
    // Blank means "not configured", the same as leaving the option out.
    const name = typeof value === "number" ? String(value) : optionalString(value)?.toLowerCase();
    if (!name) return paletteForName(null);
    const palette = paletteForName(name) || paletteForColor(value) || paletteForGradient(String(value));
    if (!palette) {
      // A hyphenated value was probably meant as a gradient, so name the part that failed.
      // Diagnosed here, not in the lookup: a config question belongs to the config layer.
      gradientError(String(value), paletteGradientLimit);
      const known = paletteKeys().map((id) => `"${id}"`).join(", ");
      pathError(
        "palette",
        `"${value}" is neither a palette nor a color — the palettes are ${known}, or name any CSS color such as "teal" for a ramp in that one color, or two or three colors joined by hyphens such as "blue-green-red", or write a palette out as {optimal, above, below}`
      );
    }
    return palette;
  }

  if (!isPlainObject(value)) pathError("palette", "must be a palette name, a color, or an object with optimal and optionally above and below");
  assertAllowedKeys(value, new Set(["below", "optimal", "above", "invalid"]), "palette");
  if (!("optimal" in value)) {
    pathError("palette", `needs an optimal color — that is the one thing a palette cannot do without. Write ${COLOR_FORMS}.`);
  }
  // Validated by the same assertPalette() the shipped palettes go through, so "a usable
  // palette" has one definition. It cannot fail here; it stays as the drift check.
  return completePalette(
    assertPalette(
      {
        id: "custom",
        optimal: normalizeColor(value.optimal, "palette.optimal"),
        above: normalizeWing(value, "above", "palette"),
        below: normalizeWing(value, "below", "palette"),
        invalid: "invalid" in value ? normalizeColor(value.invalid, "palette.invalid") : undefined,
      },
      "palette"
    )
  );
}

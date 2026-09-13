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
// one shape before it leaves this file. A value the card cannot read makes the option fall
// back to the default palette with one warning, which in a palette written out names the first
// colour at fault; a key a written-out palette does not have refuses the configuration.
//
// Palette lookups are INJECTED like the unit and zone lookups next door — the config layer
// must not import the domain registry. parseColorToken() is imported directly from core:
// what counts as a written colour is what CSS says, not domain knowledge.
//
// Full contract: see internal dev doc §5 "YAML-Palettenvertrag".

import { createDiagnostic, fallbackOption, fallbackValue } from "../../core/diagnostics.js";
import { parseColorToken } from "../../core/color.js";
import { ConfigValueError, rejectValue } from "../errors.js";
import { assertKnownKeys, isPlainObject, isUnwritten } from "../primitives.js";

const PALETTE_KEYS = ["below", "optimal", "above", "invalid"];

// One written colour, in any of the spellings a person uses.
function normalizeColor(value, path) {
  const color = isUnwritten(value) || value === "" ? null : parseColorToken(value);
  if (!color) rejectValue(path, value);
  return color;
}

// One wing. Absent means the palette does not reach that way, which is allowed; present and
// empty is almost always a `#` comment, and refused.
function normalizeWing(palette, key) {
  if (!Object.hasOwn(palette, key)) return [];
  const path = `palette.${key}`;
  const raw = palette[key];
  if (isUnwritten(raw)) rejectValue(path, raw);

  // A string may carry several colours; splitting inside an array entry too rescues
  // `above: ["FD9808, EE2046"]`.
  const tokens = (Array.isArray(raw) ? raw : [raw]).flatMap((entry) =>
    typeof entry === "string" ? entry.split(/[\s,]+/).filter(Boolean) : [entry]
  );
  if (tokens.length === 0) rejectValue(path, raw);
  // Counted in steps from optimal, so a wing's first colour is [1].
  return tokens.map((token, index) => normalizeColor(token, `${path}[${index + 1}]`));
}

export function normalizePalette(value, { paletteForName, paletteForColor, paletteForGradient, assertPalette, completePalette }, diagnostics) {
  const defaultPalette = paletteForName(null);
  const fallBack = (path, written, instead) => {
    diagnostics.push(createDiagnostic("value.invalid", { path, value: written, fallback: instead }));
    return defaultPalette;
  };
  if (isUnwritten(value)) return defaultPalette;

  if (typeof value === "string" || typeof value === "number") {
    const name = String(value).trim().toLowerCase();
    const palette = name ? paletteForName(name) || paletteForColor(value) || paletteForGradient(String(value)) : null;
    return palette || fallBack("palette", value, fallbackValue(defaultPalette.id));
  }
  if (!isPlainObject(value)) return fallBack("palette", value, fallbackValue(defaultPalette.id));

  assertKnownKeys(value, PALETTE_KEYS, "palette");
  try {
    // Validated by the same assertPalette() the shipped palettes go through, so "a usable
    // palette" has one definition. It cannot fail here; it stays as the drift check.
    return completePalette(
      assertPalette(
        {
          id: "custom",
          optimal: normalizeColor(value.optimal, "palette.optimal"),
          above: normalizeWing(value, "above"),
          below: normalizeWing(value, "below"),
          invalid: Object.hasOwn(value, "invalid") ? normalizeColor(value.invalid, "palette.invalid") : undefined,
        },
        "palette"
      )
    );
  } catch (error) {
    if (!(error instanceof ConfigValueError)) throw error;
    return fallBack(error.path, error.value, fallbackOption("palette", defaultPalette.id));
  }
}

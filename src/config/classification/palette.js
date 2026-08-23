// The `palette:` option: which colours the card's classification ramp is made of.
//
// Three spellings, tried in this order, and the order is the contract:
//
//   palette: vivid                    one of the palettes the card ships
//   palette: teal                     any CSS colour name, or a hex — a ramp in that
//                                     one colour, derived rather than written down
//   palette: {optimal, above, below}  a palette written out
//
// A shipped palette always wins over a colour name. That is what lets a future palette
// take a word like `teal` back without anything else changing, and it means the names the
// card ships can be read as a closed list rather than as exceptions.
//
// WRITTEN FOR SOMEONE TYPING, not for a parser. The strict spelling of a colour is a trap
// in YAML rather than a safeguard: `optimal: #1DB85D` is a COMMENT, and what the parser
// hands over is nothing at all. So a colour here may be written with or without the `#`,
// quoted or not, or by name; a wing may be a list, a single colour, or colours separated
// by commas; and only `optimal` is required, because a card in one colour and a profile
// with nothing below it are both things people legitimately want. Everything is
// normalized to the one shape the resolver reads before it leaves this file, so nothing
// downstream has to know that any of this was allowed.
//
// The palette lookups are INJECTED, exactly like the unit and zone lookups next door:
// which palettes exist, and what makes one usable, is domain knowledge, and the
// configuration layer must not import the domain registry. parseColorToken() is a core
// primitive and imported directly — what counts as a written colour is not domain
// knowledge, it is what CSS says.

import { parseColorToken } from "../../core/color.js";
import { assertAllowedKeys, isPlainObject, optionalString } from "../primitives.js";
import { pathError } from "../errors.js";

// The single most likely first mistake, and it produces an EMPTY value rather than a
// wrong one — so the message has to explain an absence, which "must be a hex color"
// never could.
const COMMENT_HINT =
  "a `#` after a space starts a comment in YAML, so writing `#1DB85D` leaves this empty — write it without the `#` (1DB85D), in quotes (\"#1DB85D\"), or as a color name (teal)";

const COLOR_FORMS = 'a hex color such as 1DB85D or "#1DB85D", or a CSS color name such as teal';

// One written colour, in any of the spellings a person uses.
function normalizeColor(value, path) {
  if (value === undefined || value === null || value === "") pathError(path, COMMENT_HINT);
  const color = parseColorToken(value);
  if (!color) {
    pathError(
      path,
      `"${value}" is not a color — write ${COLOR_FORMS}. A hex made only of digits has to be quoted, or written as its six digits.`
    );
  }
  return color;
}

// One wing. Absent means the palette does not reach that way, which is allowed and is not
// the same as present-and-empty: `above:` with nothing after it is almost always a `#`
// that turned the value into a comment, so that gets the explanation rather than silence.
function normalizeWing(palette, key, path) {
  if (!(key in palette)) return [];
  const raw = palette[key];
  if (raw === undefined || raw === null) pathError(`${path}.${key}`, COMMENT_HINT);

  // A string may carry several colours. Nesting the same split under an array entry costs
  // nothing and rescues `above: ["FD9808, EE2046"]`, which is a thing people write.
  const tokens = (Array.isArray(raw) ? raw : [raw]).flatMap((entry) =>
    typeof entry === "string" ? entry.split(/[\s,]+/).filter(Boolean) : [entry]
  );
  if (tokens.length === 0) pathError(`${path}.${key}`, `must name at least one color, running outwards from the middle — ${COLOR_FORMS}`);
  return tokens.map((token, index) => normalizeColor(token, `${path}.${key}[${index + 1}]`));
}

export function normalizePalette(value, { paletteForName, paletteForColor, paletteKeys, assertPalette, completePalette }) {
  if (value === undefined || value === null) return paletteForName(null);

  if (typeof value === "string" || typeof value === "number") {
    // Blank means "not configured", the same as leaving the option out — a stray space is
    // not a palette name anyone meant to write.
    const name = typeof value === "number" ? String(value) : optionalString(value)?.toLowerCase();
    if (!name) return paletteForName(null);
    const palette = paletteForName(name) || paletteForColor(value);
    if (!palette) {
      const known = paletteKeys().map((id) => `"${id}"`).join(", ");
      pathError(
        "palette",
        `"${value}" is neither a palette nor a color — the palettes are ${known}, or name any CSS color such as "teal" for a ramp in that one color, or write a palette out as {optimal, above, below}`
      );
    }
    return palette;
  }

  if (!isPlainObject(value)) pathError("palette", "must be a palette name, a color, or an object with optimal and optionally above and below");
  assertAllowedKeys(value, new Set(["below", "optimal", "above", "invalid"]), "palette");
  if (!("optimal" in value)) {
    pathError("palette", `needs an optimal color — that is the one thing a palette cannot do without. Write ${COLOR_FORMS}.`);
  }
  // Validated by the same function the shipped palettes go through, so there is one
  // definition of "a usable palette" whichever road it came in on. It cannot fail here —
  // everything above has already been normalized to it — which is exactly why it is worth
  // keeping: the day these two drift apart, this is where it is noticed.
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

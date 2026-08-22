// The `palette:` option: which colours the card's classification ramp is made of.
//
// Two spellings, and they are alternatives rather than a shorthand for one another:
//
//   palette: vivid            one of the palettes the card ships
//   palette: {below, optimal, above}  a palette written out in YAML
//
// Both lookups are INJECTED, exactly like the unit and zone lookups next door: which
// palettes exist, and what makes one usable, is domain knowledge, and the configuration
// layer must not import the domain registry. An unknown name is a hard error naming the
// option and listing what is available — silently falling back to the default would
// leave a user staring at a dashboard that ignored what they wrote.

import { assertAllowedKeys, isPlainObject, optionalString } from "../primitives.js";
import { pathError } from "../errors.js";

export function normalizePalette(value, { paletteForName, paletteNames, assertPalette, completePalette }) {
  if (value === undefined || value === null) return paletteForName(null);

  if (typeof value === "string") {
    // Blank means "not configured", the same as leaving the option out — a stray space is
    // not a palette name anyone meant to write.
    const name = optionalString(value)?.toLowerCase();
    if (!name) return paletteForName(null);
    const palette = paletteForName(name);
    if (!palette) {
      const known = paletteNames().map((id) => `"${id}"`).join(", ");
      pathError("palette", `"${value}" is not a known palette — available: ${known}, or write one out as {below, optimal, above}`);
    }
    return palette;
  }

  if (!isPlainObject(value)) pathError("palette", "must be a palette name or an object with below, optimal and above");
  assertAllowedKeys(value, new Set(["below", "optimal", "above", "invalid"]), "palette");
  // Validated by the same function the shipped palettes go through, so there is one
  // definition of "a usable palette" whichever road it came in on.
  return completePalette(
    assertPalette({ id: "custom", below: value.below, optimal: value.optimal, above: value.above, invalid: value.invalid }, "palette")
  );
}

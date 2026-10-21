// Lookups in plain-object tables keyed by user or Home Assistant strings. A bracket lookup
// also finds inherited members, so `table["constructor"]` would answer with a function.

// The table's own entry for `key`, or undefined.
export function ownValue(table, key) {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

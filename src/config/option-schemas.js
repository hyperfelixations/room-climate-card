// Factories for a validated, defaulted configuration option: a schema descriptor is
// a {default, validate} pair, so a raw YAML value is defaulted and type-checked. An
// option declared without validate() is not value-checked (valid for values that
// cannot be enumerated).

export function boolOption(defaultValue) {
  return { default: defaultValue, validate: (value) => typeof value === "boolean" };
}

// For an option with a closed set of non-boolean values (e.g. marker mode
// "average"|"extremes"|"all"). An invalid value is diagnosed, dropped, and the
// default filled in — same non-destructive fallback as an invalid boolean.
export function enumOption(defaultValue, allowedValues) {
  return { default: defaultValue, validate: (value) => allowedValues.includes(value) };
}

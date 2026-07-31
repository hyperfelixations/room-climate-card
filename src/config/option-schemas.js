// Building blocks for declaring a validated, defaulted configuration option.
//
// A schema descriptor is a small {default, validate} contract, so a raw YAML
// value is both defaulted and type-checked rather than merely whitelisted.
//
// Kept as factories rather than inlined at each call site so every option of
// the same kind shares identical validation semantics for free. An option
// declared without a validate() is simply not value-checked, which stays a
// valid choice for a future option whose values cannot be enumerated.

export function boolOption(defaultValue) {
  return { default: defaultValue, validate: (value) => typeof value === "boolean" };
}

// For an option with a closed set of non-boolean values (e.g. a marker mode
// "average"|"extremes"|"all"). An invalid value is diagnosed and dropped by the
// normalizer, then the default is filled in — the same non-destructive
// fallback an invalid boolean gets.
export function enumOption(defaultValue, allowedValues) {
  return { default: defaultValue, validate: (value) => allowedValues.includes(value) };
}

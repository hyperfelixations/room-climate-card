// The closed set of tier/invalid-classification zone values.
//
// Single source of truth for both the built-in profiles and custom-profile
// validation: anything that needs to know "which zone values exist" reads this
// instead of repeating the list.

export const CLASSIFICATION_ZONES = Object.freeze(["optimal", "comfort", "outside", "invalid"]);

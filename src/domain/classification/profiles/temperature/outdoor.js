// Outdoor temperature. Seasonal readings, so the profile declares no reference range at all and the rendered axis follows the data (anchorScale:false).
//
// A classification profile is one atomic semantic unit: tiers with their
// thresholds, score and zone, the comfort/optimal/scale bands, physical
// validity, and the profile-specific icons. Everything that has to stay
// coherent for a reading to be judged consistently lives here together;
// unit conversion is deliberately separate (see ../../../metrics/definitions.js).
//
// It names no colours. `score` is the tier's distance from OPTIMAL -- 0 is the right
// value, positive is too much, negative is too little -- and which colour sits at that
// distance is the palette's decision, not the profile's. That is what lets the same
// profile be shown in any palette without restating itself, and it is why a profile with
// only one direction to go wrong needs no special case. See ../../palettes/registry.js.
//
// Values are product decisions, not implementation details. Do not round,
// reorder or "tidy" them without a documented reason.

export const outdoor = {
  id: "outdoor",
  metricKind: "temperature",
  comparison: ">=",
  tiers: [
    { min: 35, score: 5, levelKey: "level.veryHot", zone: "outside" },
    { min: 30, score: 4, levelKey: "level.hot", zone: "outside" },
    { min: 28, score: 3, levelKey: "level.veryWarm", zone: "outside" },
    { min: 26, score: 2, levelKey: "level.warm", zone: "outside" },
    { min: 22, score: 1, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: 18, score: 0, levelKey: "level.optimal", zone: "optimal" },
    { min: 14, score: -1, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: 10, score: -2, levelKey: "level.fresh", zone: "outside" },
    { min: 5, score: -3, levelKey: "level.cool", zone: "outside" },
    { min: 0, score: -4, levelKey: "level.cold", zone: "outside" },
    { min: -Infinity, score: -5, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: 14, max: 26 },
  optimal: { min: 18, max: 22 },
  // No reference range, deliberately: outdoor readings are seasonal, so any fixed one
  // would be wrong for most of the year. dynamicScale() derives both edges from the live
  // values plus its normal one-step headroom, and the two things a range is otherwise
  // read for do not apply here — this profile is not one-sided, and it states its icon
  // thresholds itself rather than deriving them.
  scale: null,
  step: 1,
  anchorScale: false,
  iconTiers: [
    { min: 35, icon: "mdi:fire-alert" },
    { min: 30, icon: "mdi:thermometer-high" },
    { min: 14, icon: "mdi:thermometer" },
    { min: 5, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};

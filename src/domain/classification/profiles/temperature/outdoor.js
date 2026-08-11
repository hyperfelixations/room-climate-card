// Outdoor temperature. Seasonal readings, so the profile declares no reference range at all and the rendered axis follows the data (anchorScale:false).
//
// A classification profile is one atomic semantic unit: tiers with their
// thresholds, score and zone, the comfort/optimal/scale bands, physical
// validity, and the profile-specific icons. Everything that has to stay
// coherent for a reading to be judged consistently lives here together;
// unit conversion is deliberately separate (see ../../../metrics/definitions.js).
//
// Values are product decisions, not implementation details. Do not round,
// reorder or "tidy" them without a documented reason.

export const outdoor = {
  id: "outdoor",
  metricKind: "temperature",
  comparison: ">=",
  tiers: [
    { min: 35, score: 11, levelKey: "level.veryHot", color: "#B85F67", zone: "outside" },
    { min: 30, score: 10, levelKey: "level.hot", color: "#C67277", zone: "outside" },
    { min: 28, score: 9, levelKey: "level.veryWarm", color: "#C98A67", zone: "outside" },
    { min: 26, score: 8, levelKey: "level.warm", color: "#C0A752", zone: "outside" },
    { min: 22, score: 7, levelKey: "level.slightlyWarm", color: "#9DA85A", zone: "comfort" },
    { min: 18, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
    { min: 14, score: 5, levelKey: "level.slightlyCool", color: "#69A78B", zone: "comfort" },
    { min: 10, score: 4, levelKey: "level.fresh", color: "#67A7AE", zone: "outside" },
    { min: 5, score: 3, levelKey: "level.cool", color: "#76A0C0", zone: "outside" },
    { min: 0, score: 2, levelKey: "level.cold", color: "#8192C8", zone: "outside" },
    { min: -Infinity, score: 1, levelKey: "level.veryCold", color: "#8A88C9", zone: "outside" },
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
  iconThresholds: { fire: 35, high: 30, normal: 14, low: 5 },
};

// Indoor room temperature — the default temperature profile.
//
// A classification profile is one atomic semantic unit: tiers with their
// thresholds, score and zone, the comfort/optimal/scale bands, physical
// validity, and the profile-specific icons. Everything that has to stay
// coherent for a reading to be judged consistently lives here together;
// unit conversion is deliberately separate (see ../../../metrics/definitions.js).
//
// Values are product decisions, not implementation details. Do not round,
// reorder or "tidy" them without a documented reason.

export const indoor = {
  id: "indoor",
  metricKind: "temperature",
  comparison: ">=",
  tiers: [
    { min: 28, score: 11, levelKey: "level.veryHot", color: "#B85F67", zone: "outside" },
    { min: 26, score: 10, levelKey: "level.hot", color: "#C67277", zone: "outside" },
    { min: 25, score: 9, levelKey: "level.veryWarm", color: "#C98A67", zone: "outside" },
    { min: 24, score: 8, levelKey: "level.warm", color: "#C0A752", zone: "outside" },
    { min: 23, score: 7, levelKey: "level.slightlyWarm", color: "#9DA85A", zone: "comfort" },
    { min: 21, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
    { min: 20, score: 5, levelKey: "level.slightlyCool", color: "#69A78B", zone: "comfort" },
    { min: 19, score: 4, levelKey: "level.fresh", color: "#67A7AE", zone: "outside" },
    { min: 18, score: 3, levelKey: "level.cool", color: "#76A0C0", zone: "outside" },
    { min: 16, score: 2, levelKey: "level.cold", color: "#8192C8", zone: "outside" },
    { min: -Infinity, score: 1, levelKey: "level.veryCold", color: "#8A88C9", zone: "outside" },
  ],
  comfort: { min: 20, max: 24 },
  optimal: { min: 21, max: 23 },
  scale: { min: 19, max: 25 },
  step: 1,
  // The same descending {min, icon} list every profile uses, whatever it measures.
  iconTiers: [
    { min: 28, icon: "mdi:fire-alert" },
    { min: 26, icon: "mdi:thermometer-high" },
    { min: 20, icon: "mdi:thermometer" },
    { min: 18, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};

// Indoor PM2.5 concentration — the default PM2.5 profile.
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
  metricKind: "pm25",
  comparison: ">",
  invalidWhen: (value) => value < 0,
  invalidClassification: { score: 1, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
  tiers: [
    { min: 50, score: 11, levelKey: "level.critical", color: "#B85F67", zone: "outside" },
    { min: 35, score: 10, levelKey: "level.veryHigh", color: "#C67277", zone: "outside" },
    { min: 25, score: 9, levelKey: "level.high", color: "#C98A67", zone: "outside" },
    { min: 15, score: 8, levelKey: "level.elevated", color: "#C0A752", zone: "outside" },
    { min: 5, score: 7, levelKey: "level.slightlyElevated", color: "#9DA85A", zone: "comfort" },
    { min: -Infinity, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
  ],
  comfort: { min: 0, max: 15 },
  optimal: { min: 0, max: 5 },
  scale: { min: 0, max: 20 },
  step: 5,
  oneSided: true,
  iconTiers: [
    { min: 50, icon: "mdi:alert-circle-outline" },
    { min: 25, icon: "mdi:weather-dust" },
    { min: 5, icon: "mdi:weather-hazy" },
    { min: -Infinity, icon: "mdi:molecule" },
  ],
};

// Indoor PM2.5 concentration — the default PM2.5 profile.
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

export const indoor = {
  id: "indoor",
  metricKind: "pm25",
  comparison: ">",
  invalidWhen: (value) => value < 0,
  invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
  tiers: [
    { min: 50, score: 5, levelKey: "level.critical", zone: "outside" },
    { min: 35, score: 4, levelKey: "level.veryHigh", zone: "outside" },
    { min: 25, score: 3, levelKey: "level.high", zone: "outside" },
    { min: 15, score: 2, levelKey: "level.elevated", zone: "outside" },
    { min: 5, score: 1, levelKey: "level.slightlyElevated", zone: "comfort" },
    { min: -Infinity, score: 0, levelKey: "level.optimal", zone: "optimal" },
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

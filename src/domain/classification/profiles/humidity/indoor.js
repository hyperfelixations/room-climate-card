// Indoor relative humidity — the default humidity profile.
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
  metricKind: "humidity",
  comparison: ">=",
  invalidWhen: (value) => value < 0 || value > 100,
  invalidClassification: { score: 1, levelKey: "level.invalidReading", color: "#B4B2A9", zone: "invalid" },
  tiers: [
    { min: 75, score: 11, levelKey: "level.criticallyHumid", color: "#B85F67", zone: "outside" },
    { min: 70, score: 10, levelKey: "level.tooHumid", color: "#C67277", zone: "outside" },
    { min: 65, score: 9, levelKey: "level.veryHumid", color: "#C98A67", zone: "outside" },
    { min: 60, score: 8, levelKey: "level.humid", color: "#C0A752", zone: "outside" },
    { min: 58, score: 7, levelKey: "level.slightlyHumid", color: "#9DA85A", zone: "comfort" },
    { min: 42, score: 6, levelKey: "level.optimal", color: "#79A86C", zone: "optimal" },
    { min: 40, score: 5, levelKey: "level.slightlyDry", color: "#69A78B", zone: "comfort" },
    { min: 35, score: 4, levelKey: "level.dry", color: "#67A7AE", zone: "outside" },
    { min: 30, score: 3, levelKey: "level.veryDry", color: "#76A0C0", zone: "outside" },
    { min: 25, score: 2, levelKey: "level.tooDry", color: "#8192C8", zone: "outside" },
    { min: -Infinity, score: 1, levelKey: "level.criticallyDry", color: "#8A88C9", zone: "outside" },
  ],
  comfort: { min: 40, max: 60 },
  optimal: { min: 42, max: 58 },
  scale: { min: 35, max: 65 },
  step: 5,
  iconTiers: [
    { min: 75, icon: "mdi:water-percent-alert" },
    { min: 60, icon: "mdi:water-plus" },
    { min: 40, icon: "mdi:water-percent" },
    { min: -Infinity, icon: "mdi:water-minus" },
  ],
};

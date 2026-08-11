// Indoor relative humidity — the default humidity profile.
//
// A classification profile is one atomic semantic unit: tiers with their
// thresholds, score and zone, the comfort/optimal/scale bands, physical
// validity, and the profile-specific icons. Everything that has to stay
// coherent for a reading to be judged consistently lives here together;
// unit conversion is deliberately separate (see ../../../metrics/definitions.js).
//
// It names no colours. `score` IS the tier's position on the card's colour ramp, and
// which colours sit at those positions is the palette's decision, not the profile's --
// which is what lets the same profile be shown in any palette without restating itself.
// See ../../palettes/registry.js.
//
// Values are product decisions, not implementation details. Do not round,
// reorder or "tidy" them without a documented reason.

export const indoor = {
  id: "indoor",
  metricKind: "humidity",
  comparison: ">=",
  invalidWhen: (value) => value < 0 || value > 100,
  invalidClassification: { score: 1, levelKey: "level.invalidReading", zone: "invalid" },
  tiers: [
    { min: 75, score: 11, levelKey: "level.criticallyHumid", zone: "outside" },
    { min: 70, score: 10, levelKey: "level.tooHumid", zone: "outside" },
    { min: 65, score: 9, levelKey: "level.veryHumid", zone: "outside" },
    { min: 60, score: 8, levelKey: "level.humid", zone: "outside" },
    { min: 58, score: 7, levelKey: "level.slightlyHumid", zone: "comfort" },
    { min: 42, score: 6, levelKey: "level.optimal", zone: "optimal" },
    { min: 40, score: 5, levelKey: "level.slightlyDry", zone: "comfort" },
    { min: 35, score: 4, levelKey: "level.dry", zone: "outside" },
    { min: 30, score: 3, levelKey: "level.veryDry", zone: "outside" },
    { min: 25, score: 2, levelKey: "level.tooDry", zone: "outside" },
    { min: -Infinity, score: 1, levelKey: "level.criticallyDry", zone: "outside" },
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

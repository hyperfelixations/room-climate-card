import { physicalRange } from "../../validity.js";

export const indoor = {
  id: "indoor",
  metricKind: "pm10",
  comparison: ">=",
  ...physicalRange({ min: 0 }),
  invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
  tiers: [
    { min: 150, score: 5, levelKey: "level.critical", zone: "outside" },
    { min: 100, score: 4, levelKey: "level.veryHigh", zone: "outside" },
    { min: 75, score: 3, levelKey: "level.high", zone: "outside" },
    { min: 45, score: 2, levelKey: "level.elevated", zone: "outside" },
    { min: 15, score: 1, levelKey: "level.slightlyElevated", zone: "comfort" },
    { min: -Infinity, score: 0, levelKey: "level.optimal", zone: "optimal" },
  ],
  comfort: { min: 0, max: 45 },
  optimal: { min: 0, max: 15 },
  scale: { min: 0, max: 60 },
  step: 15,
  headroom: 15,
  oneSided: true,
  anchorScale: true,
  iconTiers: [
    { min: 150, icon: "mdi:alert-circle-outline" },
    { min: 75, icon: "mdi:weather-dust" },
    { min: 15, icon: "mdi:weather-hazy" },
    { min: -Infinity, icon: "mdi:molecule" },
  ],
};

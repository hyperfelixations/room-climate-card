// Indoor PM2.5 concentration — the default PM2.5 profile.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

export const indoor = {
  id: "indoor",
  metricKind: "pm25",
  comparison: ">=",
  // A concentration cannot be negative. Zero is what clean air reads.
  ...physicalRange({ min: 0 }),
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

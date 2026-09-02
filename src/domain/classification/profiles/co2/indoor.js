// Indoor CO2 concentration — the default CO2 profile.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

export const indoor = {
  id: "indoor",
  metricKind: "co2",
  comparison: ">=",
  // A concentration cannot be negative. Zero is possible, if not indoors.
  ...physicalRange({ min: 0 }),
  invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
  tiers: [
    { min: 2000, score: 5, levelKey: "level.critical", zone: "outside" },
    { min: 1600, score: 4, levelKey: "level.veryHigh", zone: "outside" },
    { min: 1200, score: 3, levelKey: "level.high", zone: "outside" },
    { min: 1000, score: 2, levelKey: "level.elevated", zone: "outside" },
    { min: 800, score: 1, levelKey: "level.slightlyElevated", zone: "comfort" },
    { min: -Infinity, score: 0, levelKey: "level.optimal", zone: "optimal" },
  ],
  comfort: { min: 0, max: 1000 },
  optimal: { min: 0, max: 800 },
  scale: { min: 0, max: 1200 },
  step: 200,
  oneSided: true,
  headroom: 100,
  iconTiers: [
    { min: 2000, icon: "mdi:alert-circle-outline" },
    { min: -Infinity, icon: "mdi:molecule-co2" },
  ],
};

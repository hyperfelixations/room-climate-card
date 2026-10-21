// Indoor carbon monoxide in mg/m³ — the default CO profile.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. 35, 10 and 4 mg/m³ are the WHO guideline values for 1 h,
// 8 h and 24 h; 7 mg/m³ is the WHO 24-hour interim target 1; 1 mg/m³ is the card's own
// optimal edge. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

export const indoor = {
  id: "indoor",
  metricKind: "co",
  comparison: ">=",
  ...physicalRange({ min: 0 }),
  invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
  tiers: [
    { min: 35, score: 5, levelKey: "level.critical", zone: "outside" },
    { min: 10, score: 4, levelKey: "level.veryHigh", zone: "outside" },
    { min: 7, score: 3, levelKey: "level.high", zone: "outside" },
    { min: 4, score: 2, levelKey: "level.elevated", zone: "outside" },
    { min: 1, score: 1, levelKey: "level.slightlyElevated", zone: "comfort" },
    { min: -Infinity, score: 0, levelKey: "level.optimal", zone: "optimal" },
  ],
  comfort: { min: 0, max: 4 },
  optimal: { min: 0, max: 1 },
  scale: { min: 0, max: 12 },
  step: 1,
  oneSided: true,
  iconTiers: [
    { min: 35, icon: "mdi:alert-circle-outline" },
    { min: 4, icon: "mdi:alert-outline" },
    { min: -Infinity, icon: "mdi:molecule-co" },
  ],
};

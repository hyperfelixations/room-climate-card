// Outdoor temperature — seasonal, so it declares no reference range and the drawn axis
// follows the live data (anchorScale:false).
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

export const outdoor = {
  id: "outdoor",
  metricKind: "temperature",
  comparison: ">=",
  // Nothing can be colder than absolute zero; there is no upper limit to state.
  ...physicalRange({ min: -273.15 }),
  tiers: [
    { min: 35, score: 5, levelKey: "level.veryHot", zone: "outside" },
    { min: 30, score: 4, levelKey: "level.hot", zone: "outside" },
    { min: 28, score: 3, levelKey: "level.veryWarm", zone: "outside" },
    { min: 26, score: 2, levelKey: "level.warm", zone: "outside" },
    { min: 22, score: 1, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: 18, score: 0, levelKey: "level.optimal", zone: "optimal" },
    { min: 14, score: -1, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: 10, score: -2, levelKey: "level.fresh", zone: "outside" },
    { min: 5, score: -3, levelKey: "level.cool", zone: "outside" },
    { min: 0, score: -4, levelKey: "level.cold", zone: "outside" },
    { min: -Infinity, score: -5, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: 14, max: 26 },
  optimal: { min: 18, max: 22 },
  // No reference range: a fixed one is wrong for most of the year. dynamicScale() takes
  // both edges from the live values plus one step of headroom. Not one-sided, and icon
  // thresholds are stated, not derived — the two other things a range would be read for.
  scale: null,
  step: 1,
  anchorScale: false,
  iconTiers: [
    { min: 35, icon: "mdi:fire-alert" },
    { min: 30, icon: "mdi:thermometer-high" },
    { min: 14, icon: "mdi:thermometer" },
    { min: 5, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};

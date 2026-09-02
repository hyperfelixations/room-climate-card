// Refrigerator temperature — an appliance, not a room.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

// Target band follows food-safety guidance (FDA/EU "at or below 5 C", ideal ~3-4 C);
// tiers widen headroom on the warm side, where spoilage risk is. anchorScale keeps its
// default true (unlike outdoor): a fridge's operating band is narrow, so a fixed axis
// beats one that floats with every door-open spike.
export const fridge = {
  id: "fridge",
  metricKind: "temperature",
  comparison: ">=",
  // Nothing can be colder than absolute zero; there is no upper limit to state.
  ...physicalRange({ min: -273.15 }),
  tiers: [
    { min: 12, score: 5, levelKey: "level.veryHot", zone: "outside" },
    { min: 10, score: 4, levelKey: "level.hot", zone: "outside" },
    { min: 8, score: 3, levelKey: "level.veryWarm", zone: "outside" },
    { min: 6, score: 2, levelKey: "level.warm", zone: "outside" },
    { min: 5, score: 1, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: 3, score: 0, levelKey: "level.optimal", zone: "optimal" },
    { min: 1, score: -1, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: 0, score: -2, levelKey: "level.fresh", zone: "outside" },
    { min: -2, score: -3, levelKey: "level.cool", zone: "outside" },
    { min: -4, score: -4, levelKey: "level.cold", zone: "outside" },
    { min: -Infinity, score: -5, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: 1, max: 6 },
  optimal: { min: 3, max: 5 },
  scale: { min: 0, max: 8 },
  step: 1,
  iconTiers: [
    { min: 12, icon: "mdi:fire-alert" },
    { min: 10, icon: "mdi:thermometer-high" },
    { min: 1, icon: "mdi:thermometer" },
    { min: -2, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};

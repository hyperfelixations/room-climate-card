// Indoor room temperature — the default temperature profile.
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

import { physicalRange } from "../../validity.js";

export const indoor = {
  id: "indoor",
  metricKind: "temperature",
  comparison: ">=",
  // Nothing can be colder than absolute zero; there is no upper limit to state.
  ...physicalRange({ min: -273.15 }),
  tiers: [
    { min: 28, score: 5, levelKey: "level.veryHot", zone: "outside" },
    { min: 26, score: 4, levelKey: "level.hot", zone: "outside" },
    { min: 25, score: 3, levelKey: "level.veryWarm", zone: "outside" },
    { min: 24, score: 2, levelKey: "level.warm", zone: "outside" },
    { min: 23, score: 1, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: 21, score: 0, levelKey: "level.optimal", zone: "optimal" },
    { min: 20, score: -1, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: 19, score: -2, levelKey: "level.fresh", zone: "outside" },
    { min: 18, score: -3, levelKey: "level.cool", zone: "outside" },
    { min: 16, score: -4, levelKey: "level.cold", zone: "outside" },
    { min: -Infinity, score: -5, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: 20, max: 24 },
  optimal: { min: 21, max: 23 },
  scale: { min: 19, max: 25 },
  step: 1,
  // The same descending {min, icon} list every profile uses, whatever it measures.
  iconTiers: [
    { min: 28, icon: "mdi:fire-alert" },
    { min: 26, icon: "mdi:thermometer-high" },
    { min: 20, icon: "mdi:thermometer" },
    { min: 18, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};

// Freezer temperature — an appliance, not a room.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands,
// physical validity, icons. `score` is the signed distance from optimal that the
// palette turns into a colour. Values are product decisions — do not reorder or "tidy".

import { physicalRange } from "../../validity.js";

// Target follows frozen-food storage guidance of -18 C or below. The warm-side
// tiers also use the established -12 C and -6 C frozen-compartment reference
// points. Colder tiers are deliberately gentler: colder storage is primarily an
// efficiency/quality concern, while warming is the important storage failure mode.
// anchorScale keeps its default true so normal temperature cycling does not move
// the scale around.
export const freezer = {
  id: "freezer",
  metricKind: "temperature",
  comparison: ">=",
  // Nothing can be colder than absolute zero; there is no upper limit to state.
  ...physicalRange({ min: -273.15 }),
  tiers: [
    { min: 0, score: 5, levelKey: "level.veryHot", zone: "outside" },
    { min: -6, score: 4, levelKey: "level.hot", zone: "outside" },
    { min: -12, score: 3, levelKey: "level.veryWarm", zone: "outside" },
    { min: -15, score: 2, levelKey: "level.warm", zone: "outside" },
    { min: -18, score: 1, levelKey: "level.slightlyWarm", zone: "comfort" },
    { min: -21, score: 0, levelKey: "level.optimal", zone: "optimal" },
    { min: -24, score: -1, levelKey: "level.slightlyCool", zone: "comfort" },
    { min: -27, score: -2, levelKey: "level.cool", zone: "outside" },
    { min: -30, score: -3, levelKey: "level.cold", zone: "outside" },
    { min: -33, score: -4, levelKey: "level.veryCold", zone: "outside" },
    { min: -Infinity, score: -5, levelKey: "level.veryCold", zone: "outside" },
  ],
  comfort: { min: -24, max: -15 },
  optimal: { min: -21, max: -18 },
  scale: { min: -30, max: -6 },
  step: 2,
  iconTiers: [
    { min: 0, icon: "mdi:fire-alert" },
    { min: -12, icon: "mdi:thermometer-high" },
    { min: -24, icon: "mdi:thermometer" },
    { min: -30, icon: "mdi:thermometer-low" },
    { min: -Infinity, icon: "mdi:snowflake" },
  ],
};
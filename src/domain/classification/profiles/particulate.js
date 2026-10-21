// Indoor particulate-matter profiles (PM1, PM2.5, PM4, PM10), built from one threshold set.
//
// One atomic profile: tiers (threshold/score/zone), comfort/optimal/scale bands, physical
// validity, icons. `score` is the signed distance from optimal that the palette turns into a
// colour. The optimal and comfort edges are the WHO 2021 annual and 24-hour guideline values;
// PM1 and PM4 have no guideline of their own and take the PM2.5 set. The tiers above are
// product decisions — do not reorder or "tidy".

import { physicalRange } from "../validity.js";

export const PM25_THRESHOLDS = Object.freeze({ tiers: [50, 35, 25, 15, 5], optimalMax: 5, comfortMax: 15, scaleMax: 20, step: 5 });
export const PM10_THRESHOLDS = Object.freeze({ tiers: [150, 100, 75, 45, 15], optimalMax: 15, comfortMax: 45, scaleMax: 60, step: 15 });

export function particulateIndoor(metricKind, { tiers, optimalMax, comfortMax, scaleMax, step }) {
  const [critical, veryHigh, high, elevated, slightlyElevated] = tiers;
  return {
    id: "indoor",
    metricKind,
    comparison: ">=",
    // A concentration cannot be negative. Zero is what clean air reads.
    ...physicalRange({ min: 0 }),
    invalidClassification: { score: null, levelKey: "level.invalidReading", zone: "invalid" },
    tiers: [
      { min: critical, score: 5, levelKey: "level.critical", zone: "outside" },
      { min: veryHigh, score: 4, levelKey: "level.veryHigh", zone: "outside" },
      { min: high, score: 3, levelKey: "level.high", zone: "outside" },
      { min: elevated, score: 2, levelKey: "level.elevated", zone: "outside" },
      { min: slightlyElevated, score: 1, levelKey: "level.slightlyElevated", zone: "comfort" },
      { min: -Infinity, score: 0, levelKey: "level.optimal", zone: "optimal" },
    ],
    comfort: { min: 0, max: comfortMax },
    optimal: { min: 0, max: optimalMax },
    scale: { min: 0, max: scaleMax },
    step,
    oneSided: true,
    iconTiers: [
      { min: critical, icon: "mdi:alert-circle-outline" },
      { min: high, icon: "mdi:weather-dust" },
      { min: slightlyElevated, icon: "mdi:weather-hazy" },
      { min: -Infinity, icon: "mdi:molecule" },
    ],
  };
}

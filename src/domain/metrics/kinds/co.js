// Carbon monoxide: classified in mg/m³, the unit of the WHO guideline values, and shown in any
// of the four units Home Assistant allows. Boundaries projected into ppm and ppb are floored,
// so a printed boundary never lies above the guideline value it stands for.

import { linearUnitProfile } from "../../units/linear-unit-profile.js";

// HA gas-conversion convention: 20 °C, 101325 Pa; see internal dev doc §5 "Unit-, Range-, Trend- und Scale-System".
const MG_PER_PPM = (28.01 * 101325) / (8.31446261815324 * 293.15) / 1000;

export const co = {
  metricKind: "co",
  deviceClass: "carbon_monoxide",
  canonicalUnit: "mg/m³",
  canonicalProfileKey: "milligram_per_m3",
  unitProfiles: {
    milligram_per_m3: linearUnitProfile({ key: "milligram_per_m3", displayUnit: "mg/m³" }),
    microgram_per_m3: linearUnitProfile({ key: "microgram_per_m3", displayUnit: "µg/m³", factor: 0.001 }),
    ppm: linearUnitProfile({ key: "ppm", displayUnit: "ppm", factor: MG_PER_PPM, thresholdDigits: 1 }),
    ppb: linearUnitProfile({ key: "ppb", displayUnit: "ppb", factor: MG_PER_PPM / 1000, thresholdDigits: 0 }),
  },
  trend: { fallingBelow: -0.1, risingAbove: 0.1 },
};

import { CLASSIFICATION_PROFILE_REGISTRY } from "../../classification/registry.js";

// HA gas-conversion convention: 20 °C, 101325 Pa; see internal dev doc §5 "Unit-, Range-, Trend- und Scale-System".
const MG_PER_PPM = (28.01 * 101325) / (8.31446261815324 * 293.15) / 1000;
const step = CLASSIFICATION_PROFILE_REGISTRY.co.profiles.indoor.step;

function floorThreshold(value, digits) {
  const factor = 10 ** digits;
  if (Math.abs(value) > Number.MAX_VALUE / factor) return value;
  const scaled = value * factor;
  const nearest = Math.round(scaled);
  const snapped = Math.abs(scaled - nearest) <= 4 * Number.EPSILON * Math.max(1, Math.abs(scaled)) ? nearest : scaled;
  return Math.floor(snapped) / factor || 0;
}

function linearProfile(key, displayUnit, factor, digits) {
  return {
    key,
    units: [displayUnit],
    displayUnit,
    toCanonical: (value) => value * factor,
    fromCanonical: (value) => value / factor,
    deltaToCanonical: (value) => value * factor,
    deltaFromCanonical: (value) => value / factor,
    baseDisplayStep: step / factor,
    ...(digits === null ? {} : { thresholdRounding: (value) => floorThreshold(value, digits) }),
  };
}

export const co = {
  metricKind: "co",
  deviceClass: "carbon_monoxide",
  canonicalUnit: "mg/m³",
  canonicalProfileKey: "milligram_per_m3",
  unitProfiles: {
    milligram_per_m3: linearProfile("milligram_per_m3", "mg/m³", 1, null),
    microgram_per_m3: linearProfile("microgram_per_m3", "µg/m³", 0.001, null),
    ppm: linearProfile("ppm", "ppm", MG_PER_PPM, 1),
    ppb: linearProfile("ppb", "ppb", MG_PER_PPM / 1000, 0),
  },
  trend: { fallingBelow: -0.1, risingAbove: 0.1 },
};

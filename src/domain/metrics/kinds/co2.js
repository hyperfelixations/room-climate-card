// Carbon dioxide in ppm, one identity unit profile.

import { CLASSIFICATION_PROFILE_REGISTRY } from "../../classification/registry.js";

export const co2 = {
  metricKind: "co2",
  deviceClass: "carbon_dioxide",
  canonicalUnit: "ppm",
  canonicalProfileKey: "ppm",
  unitProfiles: {
    ppm: {
      key: "ppm",
      units: ["ppm"],
      displayUnit: "ppm",
      toCanonical: (v) => v,
      fromCanonical: (v) => v,
      deltaToCanonical: (v) => v,
      deltaFromCanonical: (v) => v,
      baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.step,
    },
  },
  trend: { fallingBelow: -25, risingAbove: 25 },
};

// Fine particulate matter (PM2.5) in µg/m³, one identity unit profile.

import { CLASSIFICATION_PROFILE_REGISTRY } from "../../classification/registry.js";

export const pm25 = {
  metricKind: "pm25",
  deviceClass: "pm25",
  canonicalUnit: "µg/m³",
  canonicalProfileKey: "microgram_per_m3",
  unitProfiles: {
    microgram_per_m3: {
      key: "microgram_per_m3",
      units: ["µg/m³"],
      displayUnit: "µg/m³",
      toCanonical: (v) => v,
      fromCanonical: (v) => v,
      deltaToCanonical: (v) => v,
      deltaFromCanonical: (v) => v,
      baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.step,
    },
  },
  trend: { fallingBelow: -0.5, risingAbove: 0.5 },
};

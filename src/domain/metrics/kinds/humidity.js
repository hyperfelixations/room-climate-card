// Relative humidity in %, one identity unit profile.

import { CLASSIFICATION_PROFILE_REGISTRY } from "../../classification/registry.js";

export const humidity = {
  metricKind: "humidity",
  deviceClass: "humidity",
  canonicalUnit: "%",
  canonicalProfileKey: "percent",
  unitProfiles: {
    percent: {
      key: "percent",
      units: ["%"],
      displayUnit: "%",
      toCanonical: (v) => v,
      fromCanonical: (v) => v,
      deltaToCanonical: (v) => v,
      deltaFromCanonical: (v) => v,
      baseDisplayStep: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.step,
    },
  },
  trend: { fallingBelow: -0.5, risingAbove: 0.5 },
};

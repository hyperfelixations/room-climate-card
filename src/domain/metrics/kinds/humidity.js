// Relative humidity in %, one identity unit profile.

import { linearUnitProfile } from "../../units/linear-unit-profile.js";

export const humidity = {
  metricKind: "humidity",
  deviceClass: "humidity",
  canonicalUnit: "%",
  canonicalProfileKey: "percent",
  unitProfiles: {
    percent: linearUnitProfile({ key: "percent", displayUnit: "%" }),
  },
  trend: { fallingBelow: -0.5, risingAbove: 0.5 },
};

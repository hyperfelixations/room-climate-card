// Carbon dioxide in ppm, one identity unit profile.

import { linearUnitProfile } from "../../units/linear-unit-profile.js";

export const co2 = {
  metricKind: "co2",
  deviceClass: "carbon_dioxide",
  canonicalUnit: "ppm",
  canonicalProfileKey: "ppm",
  unitProfiles: {
    ppm: linearUnitProfile({ key: "ppm", displayUnit: "ppm" }),
  },
  trend: { fallingBelow: -25, risingAbove: 25 },
};

// Particulate matter (PM1, PM2.5, PM4, PM10): reported in µg/m³ under a device class named
// like the kind, one identity unit profile.

import { linearUnitProfile } from "../../units/linear-unit-profile.js";

export function particulateKind(metricKind) {
  return {
    metricKind,
    deviceClass: metricKind,
    canonicalUnit: "µg/m³",
    canonicalProfileKey: "microgram_per_m3",
    unitProfiles: {
      microgram_per_m3: linearUnitProfile({ key: "microgram_per_m3", displayUnit: "µg/m³" }),
    },
    trend: { fallingBelow: -0.5, risingAbove: 0.5 },
  };
}

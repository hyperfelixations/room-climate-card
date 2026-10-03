// Temperature: shown in °C, °F or K, classified and compared in °C.

import { withoutNegativeZero } from "../../../core/numbers.js";

export const temperature = {
  metricKind: "temperature",
  deviceClass: "temperature",
  canonicalUnit: "°C",
  canonicalProfileKey: "celsius",
  unitProfiles: {
    celsius: {
      key: "celsius",
      units: ["°c", "c", "celsius"],
      displayUnit: "°C",
      toCanonical: (v) => v,
      fromCanonical: (v) => v,
      deltaToCanonical: (v) => v,
      deltaFromCanonical: (v) => v,
      baseDisplayStep: 1,
      // No thresholdRounding: derivation is a pure identity for the
      // canonical unit itself (verified in tests).
    },
    fahrenheit: {
      key: "fahrenheit",
      units: ["°f", "f", "fahrenheit"],
      displayUnit: "°F",
      toCanonical: (v) => ((v - 32) * 5) / 9,
      fromCanonical: (v) => (v * 9) / 5 + 32,
      deltaToCanonical: (v) => (v * 5) / 9,
      deltaFromCanonical: (v) => (v * 9) / 5,
      baseDisplayStep: 2,
      // Round projected boundaries to whole °F, so a displayed boundary and the one
      // used for classification never disagree. Math.round returns -0 for a small
      // negative boundary (-18 °C is -0.4 °F), which no boundary means.
      thresholdRounding: (v) => withoutNegativeZero(Math.round(v)),
      // Dynamic scale step by displayed span: fine for a narrow range, coarse for a
      // wide one. Celsius/Kelvin omit this and keep a fixed baseDisplayStep of 1.
      dynamicDisplaySteps: [
        { maxSpan: 20, step: 2 },
        { maxSpan: 40, step: 5 },
        { maxSpan: Infinity, step: 10 },
      ],
    },
    kelvin: {
      key: "kelvin",
      units: ["k", "kelvin"],
      displayUnit: "K",
      toCanonical: (v) => v - 273.15,
      fromCanonical: (v) => v + 273.15,
      // Kelvin and Celsius differ by a pure offset (no scale factor),
      // so a delta/rate is numerically identical in both units.
      deltaToCanonical: (v) => v,
      deltaFromCanonical: (v) => v,
      baseDisplayStep: 1,
    },
  },
  trend: { fallingBelow: -0.1, risingAbove: 0.1 },
};

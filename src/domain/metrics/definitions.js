import { CLASSIFICATION_PROFILE_REGISTRY } from "../classification/registry.js";

// MetricDefinition / UnitProfile / QuantityKind registry.
//
// One entry per measurement kind, each owning its canonical unit, the key of the
// UnitProfile that IS that unit, references to the canonical classification tiers/bands
// (not a second copy), and every UnitProfile it can be displayed in. canonicalUnit is
// stated HERE and read from here by the presentation metadata, never the reverse.
//
// Temperature has Celsius/Fahrenheit/Kelvin; humidity/co2/pm25 each use an identity
// profile so validation and conversion follow one atomic path. A `quantityKind` picks
// the conversion path: `absolute` via toCanonical/fromCanonical (applies the Fahrenheit
// offset), `delta` and `rate` via deltaToCanonical/deltaFromCanonical (never an offset);
// `rate` differs from `delta` only in a time unit this module does not touch. See
// domain/units/conversion.js.
export const METRIC_DEFINITIONS = {
  temperature: {
    metricKind: "temperature",
    canonicalUnit: "°C",
    // Which unitProfiles key IS the canonical unit, so the pipeline looks it up
    // generically instead of hard-coding "celsius" at every call site.
    canonicalProfileKey: "celsius",
    canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.tiers,
    canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.comfort,
    canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.optimal,
    canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.temperature.profiles.indoor.scale,
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
        // used for classification never disagree.
        thresholdRounding: (v) => Math.round(v),
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
  },
  // Humidity, CO2 and PM2.5 use a single identity UnitProfile each; an unresolvable unit
  // never falls back to the canonical profile.
  humidity: {
    metricKind: "humidity",
    canonicalUnit: "%",
    canonicalProfileKey: "percent",
    canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.tiers,
    canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.comfort,
    canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.optimal,
    canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.humidity.profiles.indoor.scale,
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
  },
  co2: {
    metricKind: "co2",
    canonicalUnit: "ppm",
    canonicalProfileKey: "ppm",
    canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.tiers,
    canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.comfort,
    canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.optimal,
    canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.co2.profiles.indoor.scale,
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
  },
  pm25: {
    metricKind: "pm25",
    canonicalUnit: "µg/m³",
    canonicalProfileKey: "microgram_per_m3",
    canonicalClassificationTiers: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.tiers,
    canonicalComfortBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.comfort,
    canonicalOptimalBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.optimal,
    canonicalBaseScaleBand: CLASSIFICATION_PROFILE_REGISTRY.pm25.profiles.indoor.scale,
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
  },
  // A future metric kind is another key of the same shape (canonicalUnit, tier/band
  // references, unitProfiles). Conversion and derivation never branch on a specific
  // metricKind; tests exercise them with a synthetic, unregistered profile.
};

import { CLASSIFICATION_PROFILE_REGISTRY } from "../classification/registry.js";

// MetricDefinition / UnitProfile / QuantityKind registry (AP-01).
//
// One entry per measurement kind. Each owns its canonical unit, the key of
// the UnitProfile that IS that canonical unit, references to the canonical
// classification tiers/bands, and every UnitProfile it can be displayed in.
//
// canonicalUnit is defined HERE and referenced by the presentation metadata
// (METRIC_META.unitFallback), not the other way round: the canonical unit is
// a measurement fact, and there must be exactly one place that states it.

// AP-01 began this generic, extensible foundation for measurement kinds.
// It is now live for all four supported metrics: temperature provides
// Celsius/Fahrenheit/Kelvin profiles, while humidity/co2/pm25 each use an
// identity UnitProfile so unit validation and conversion follow the same
// atomic path everywhere. _resolveMetricContext() canonicalizes values;
// classification profiles are projected back into the resolved display
// profile before classification, scale, or icon decisions.
//
// A "quantityKind" distinguishes three fundamentally different numeric
// semantics that must never share a conversion path:
//   absolute — an actual reading (e.g. today's temperature): converts via
//              toCanonical()/fromCanonical(), which DOES apply the
//              Fahrenheit offset (0 °C = 32 °F).
//   delta    — a difference between two readings (e.g. daily spread,
//              room-to-room spread): converts via deltaToCanonical()/
//              deltaFromCanonical(), which must NEVER apply an offset
//              (a 0 °C difference is a 0 °F difference, not 32 °F).
//   rate     — a delta per unit time (e.g. a trend in °C/h): uses the
//              exact same value-conversion factor as delta — only the
//              time unit differs, and this module does not touch time
//              units at all, so "rate" and "delta" share one code path.
//
// Celsius stays the canonical temperature unit. The indoor profile's
// tiers and bands are referenced directly below from
// CLASSIFICATION_PROFILE_REGISTRY rather than copied into a second table.
export const METRIC_DEFINITIONS = {
  temperature: {
    metricKind: "temperature",
    canonicalUnit: "°C",
    // Which unitProfiles key IS the canonical unit — lets AP-02's
    // measurement pipeline look this up generically instead of
    // hard-coding the string "celsius" at every call site.
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
        // Product rule (audit 9.3): Fahrenheit classification/comfort/
        // optimal/base-scale boundaries are always whole numbers, so a
        // displayed boundary and the boundary actually used for
        // classification never disagree.
        thresholdRounding: (v) => Math.round(v),
        // AP-03 (audit 9.6): the dynamic scale's rounding step depends on
        // how wide the actually-displayed span is — a narrow span rounds
        // to a fine 2°F step, a wide one to a coarse 10°F step, so the
        // axis never ends up with an absurdly fine or coarse grid.
        // Celsius/Kelvin omit this field entirely and keep the fixed
        // baseDisplayStep (1) — "Für Celsius und Kelvin bleibt der
        // Basisschritt 1" (audit 9.6).
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
  // Review fix (post-AP-01..03): humidity/co2/pm25 each get a trivial,
  // single-entry "identity" UnitProfile instead of having no
  // MetricDefinition at all. Reason: _buildEntityModel() previously had no
  // way to tell "this reading's unit doesn't even match its own kind" for
  // these three modes (no registry to check against), only for
  // temperature — so a stray unit on e.g. a co2 entity was NEVER caught.
  // Giving every kind exactly one MetricDefinition entry (celsius-style
  // "one profile, canonicalProfileKey points to it") lets
  // _buildEntityModel()/_resolveUnitProfileKey() apply the exact same
  // atomic "resolve metric kind and UnitProfile from the SAME registry, no
  // canonical fallback for an unresolvable unit" policy uniformly to all
  // four kinds. Since each has only one profile whose key always equals
  // canonicalProfileKey, every existing "does the resolved profile differ
  // from canonical?" short-circuit (_scaleConfigFor(), etc.) still always
  // takes the "no" branch for these three — zero behavior change to
  // classification/scale/display, purely additive validation.
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
  // Extension point (audit section 10.1): a future kind is added here as
  // its own key, e.g.:
  //   absolute_humidity: {
  //     metricKind: "absolute_humidity",
  //     canonicalUnit: "g/m³",
  //     canonicalClassificationTiers: [...],       // once defined
  //     canonicalComfortBand: {...}, canonicalOptimalBand: {...}, canonicalBaseScaleBand: {...},
  //     unitProfiles: { gram_per_m3: {...}, milligram_per_m3: {...} },
  //   }
  // The conversion/derivation functions below never branch on a specific
  // metricKind — see metric-definitions.test.js's "extension point" case,
  // which exercises them against a synthetic profile that is never
  // registered here at all.
};

import { CLASSIFICATION_PROFILE_REGISTRY } from "../classification/registry.js";
import { temperature } from "./kinds/temperature.js";
import { humidity } from "./kinds/humidity.js";
import { co2 } from "./kinds/co2.js";
import { pm25 } from "./kinds/pm25.js";

// MetricDefinition / UnitProfile / QuantityKind registry, assembled from one module per
// measurement kind under kinds/.
//
// A kind module states its Home Assistant device class, its canonical unit, the key of the
// UnitProfile that IS that unit, every UnitProfile it can be displayed in, and its trend
// deadband (fallingBelow/risingAbove, canonical unit per hour). Device-class and unit lookups
// and the trend policies are derived from these entries, never written a second time; every
// consumer reads canonicalUnit from here.
//
// A `quantityKind` picks the conversion path: `absolute` via toCanonical/fromCanonical
// (applies the Fahrenheit offset), `delta` and `rate` via deltaToCanonical/deltaFromCanonical
// (never an offset); `rate` differs from `delta` only in a time unit this module does not
// touch. See domain/units/conversion.js. Conversion and derivation never branch on a specific
// metricKind; tests exercise them with a synthetic, unregistered profile. Adding a kind: see
// internal dev doc §6 "Neue Messart".
const KINDS = [temperature, humidity, co2, pm25];

// The card's measurement kinds in the order the card offers them.
export const METRIC_KIND_ORDER = Object.freeze(KINDS.map((kind) => kind.metricKind));

// References to the canonical classification tiers and bands of the kind's default built-in
// profile, not a second copy.
function withCanonicalClassification(kind) {
  const registry = CLASSIFICATION_PROFILE_REGISTRY[kind.metricKind];
  const profile = registry.profiles[registry.defaultProfile];
  return {
    ...kind,
    canonicalClassificationTiers: profile.tiers,
    canonicalComfortBand: profile.comfort,
    canonicalOptimalBand: profile.optimal,
    canonicalBaseScaleBand: profile.scale,
  };
}

export const METRIC_DEFINITIONS = Object.fromEntries(KINDS.map((kind) => [kind.metricKind, withCanonicalClassification(kind)]));

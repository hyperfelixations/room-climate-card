import { temperature } from "./kinds/temperature.js";
import { humidity } from "./kinds/humidity.js";
import { co2 } from "./kinds/co2.js";
import { pm25 } from "./kinds/pm25.js";
import { pm1 } from "./kinds/pm1.js";
import { pm4 } from "./kinds/pm4.js";
import { pm10 } from "./kinds/pm10.js";
import { co } from "./kinds/co.js";

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
// touch. See domain/units/conversion.js. Conversion never branches on a specific metricKind;
// tests exercise it with a synthetic, unregistered profile. Adding a kind: see internal dev
// doc §6 "Neue Messart".
const KINDS = [temperature, humidity, co2, pm25, pm1, pm4, pm10, co];

// The card's measurement kinds in the order the card offers them.
export const METRIC_KIND_ORDER = Object.freeze(KINDS.map((kind) => kind.metricKind));

export const METRIC_DEFINITIONS = Object.fromEntries(KINDS.map((kind) => [kind.metricKind, kind]));

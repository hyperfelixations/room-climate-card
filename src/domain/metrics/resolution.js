// Resolving a metric kind and a unit profile from what an entity reports.
//
// Two lookup paths, in the order the card trusts them:
//
//   1. device_class — Home Assistant's own declaration, and the primary source.
//   2. unit_of_measurement — a fallback, but only where the unit PREDICTS the
//      measurement. See below; this is the part that is not obvious.
//
// METRIC_TYPE_BY_UNIT is DERIVED from METRIC_DEFINITIONS rather than hand-maintained, so
// profile aliases and the lookup index cannot drift apart.

import { METRIC_DEFINITIONS } from "./definitions.js";
import { normalizeUnitToken } from "../units/unit-token.js";

// Values match Home Assistant's SensorDeviceClass enum.
export const METRIC_TYPE_BY_DEVICE_CLASS = {
  temperature: "temperature",
  humidity: "humidity",
  carbon_dioxide: "co2",
  pm25: "pm25",
};

// WHICH DEVICE CLASSES CLAIM EACH UNIT — the fact the fallback rule is built on.
//
// A unit only says what is being measured if it belongs to ONE measurement. Some do:
// nothing but a temperature is reported in °C. Most air-quality units do not. Home
// Assistant defines eleven sensor device classes that report µg/m³ and five that report
// ppm, so "700 ppm" on its own is as likely to be a volatile-compound reading as a CO2
// one, and guessing means showing a user the wrong scale, the wrong thresholds and the
// wrong colour with no indication that anything is wrong.
//
// Listed here are the device classes a CLIMATE card could plausibly be pointed at —
// comfort and air quality. Home Assistant's full vocabulary is wider still (battery and
// power factor also report %), but a percentage on a climate card is a humidity in every
// realistic case, and taking that fallback away would break far more installations than
// it would protect. Where the ambiguity is inside the card's own subject matter, it is
// treated as real; where it is only theoretical, it is not.
//
// Source: Home Assistant developer documentation, sensor entity device classes.
export const DEVICE_CLASSES_BY_UNIT = Object.freeze({
  "°C": ["temperature"],
  "°F": ["temperature"],
  K: ["temperature"],
  "%": ["humidity"],
  ppm: [
    "carbon_dioxide",
    "carbon_monoxide",
    "nitrogen_dioxide",
    "ozone",
    "volatile_organic_compounds_parts",
  ],
  "µg/m³": [
    "absolute_humidity",
    "carbon_monoxide",
    "nitrogen_dioxide",
    "nitrogen_monoxide",
    "ozone",
    "pm1",
    "pm10",
    "pm25",
    "pm4",
    "sulphur_dioxide",
    "volatile_organic_compounds",
  ],
});

// A unit that more than one measurement uses cannot stand in for a device class. Derived
// from the table rather than listed a second time, so adding a measurement that shares a
// unit takes that unit's fallback away by itself — which is the whole point of writing
// the rule as data.
const AMBIGUOUS_UNITS = new Set(
  Object.entries(DEVICE_CLASSES_BY_UNIT)
    .filter(([, deviceClasses]) => deviceClasses.length > 1)
    .map(([unit]) => normalizeUnitToken(unit))
);

// Whether this unit is enough on its own. Exported because "the unit does not say" is a
// distinct situation from "the unit is unknown", and a caller may want to tell a user
// which one it is looking at.
export function unitPredictsMetricKind(rawUnit) {
  return Boolean(rawUnit) && !AMBIGUOUS_UNITS.has(normalizeUnitToken(rawUnit));
}

// WHICH of the card's own measurements uses a unit. One registered unit string can only
// ever belong to one of them, so a plain last-write-wins merge is safe.
//
// This is a different question from the one above, and conflating the two was a mistake
// worth naming: "a profile written in ppm is a CO2 profile" is true and always was —
// there is exactly one CO2 profile — while "a SENSOR reporting ppm is a CO2 sensor" is a
// guess about somebody else's system. A custom profile's `classification.unit` asks the
// first question and keeps its answer; entity detection asks the second, through
// metricKindFromUnitAlone() below.
export const METRIC_TYPE_BY_UNIT = Object.fromEntries(
  Object.values(METRIC_DEFINITIONS).flatMap((definition) =>
    Object.values(definition.unitProfiles).flatMap((profile) =>
      profile.units.map((unit) => [normalizeUnitToken(unit), definition.metricKind])
    )
  )
);

// What an entity's unit alone is allowed to decide: the metric kind when the unit belongs
// to one measurement, and null when it does not. The whole of the fallback rule, in one
// place, so no caller has to remember to ask twice.
export function metricKindFromUnitAlone(rawUnit) {
  if (!unitPredictsMetricKind(rawUnit)) return null;
  return METRIC_TYPE_BY_UNIT[normalizeUnitToken(rawUnit)] || null;
}

// Maps one entity's own raw unit_of_measurement to a METRIC_DEFINITIONS
// unitProfile key (e.g. "°F" -> "fahrenheit"); null when metricKind is unknown
// or rawUnit doesn't match any registered profile. Both sides of the
// comparison go through normalizeUnitToken(), so equivalent Unicode/text
// spellings map to the same registered unit without weakening the rejection of
// genuinely unknown units.
//
// Unaffected by the ambiguity rule above, and deliberately so: by the time this is
// called the metric kind is already settled, so "which profile of THIS metric" has only
// one answer. A CO2 sensor that declares its device_class still reads its ppm normally.
export function resolveUnitProfileKey(metricKind, rawUnit) {
  const definition = METRIC_DEFINITIONS[metricKind];
  if (!definition || !rawUnit) return null;
  const normalized = normalizeUnitToken(rawUnit);
  return (
    Object.keys(definition.unitProfiles).find((key) =>
      definition.unitProfiles[key].units.some((unit) => normalizeUnitToken(unit) === normalized)
    ) || null
  );
}

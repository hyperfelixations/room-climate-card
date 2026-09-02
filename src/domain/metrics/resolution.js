// Resolving a metric kind and a unit profile from what an entity reports.
//
// Two lookup paths, in trust order: device_class first (HA's own declaration), then
// unit_of_measurement — but only where the unit PREDICTS the measurement (see below).
// METRIC_TYPE_BY_UNIT is DERIVED from METRIC_DEFINITIONS, so it cannot drift from it.

import { METRIC_DEFINITIONS } from "./definitions.js";
import { normalizeUnitToken } from "../units/unit-token.js";

// Values match Home Assistant's SensorDeviceClass enum.
export const METRIC_TYPE_BY_DEVICE_CLASS = {
  temperature: "temperature",
  humidity: "humidity",
  carbon_dioxide: "co2",
  pm25: "pm25",
};

// WHICH DEVICE CLASSES CLAIM EACH UNIT — the fact the fallback rule is built on. A unit
// stands in for a device_class only if it belongs to ONE measurement: °C is always
// temperature, but HA defines many sensor classes that report µg/m³ or ppm, so those
// predict nothing. Listed are the classes a climate card could plausibly be pointed at;
// % is kept for humidity even though battery/power_factor also use it, because dropping
// that fallback would break far more than it protects.
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

// A unit more than one measurement uses cannot stand in for a device_class. Derived from
// the table, so adding a measurement that shares a unit removes that unit's fallback by itself.
const AMBIGUOUS_UNITS = new Set(
  Object.entries(DEVICE_CLASSES_BY_UNIT)
    .filter(([, deviceClasses]) => deviceClasses.length > 1)
    .map(([unit]) => normalizeUnitToken(unit))
);

// Whether this unit is enough on its own. Exported because "the unit does not say" and
// "the unit is unknown" are distinct situations a caller may want to tell apart.
export function unitPredictsMetricKind(rawUnit) {
  return Boolean(rawUnit) && !AMBIGUOUS_UNITS.has(normalizeUnitToken(rawUnit));
}

// WHICH of the card's own measurements uses a unit. One registered unit string belongs to
// only one of them, so last-write-wins is safe. Different question from AMBIGUOUS_UNITS:
// "a profile written in ppm is a CO2 profile" (one CO2 profile exists) is answered here
// and kept; "a sensor reporting ppm is a CO2 sensor" is a guess and goes through
// metricKindFromUnitAlone() below. The two must not share a table.
export const METRIC_TYPE_BY_UNIT = Object.fromEntries(
  Object.values(METRIC_DEFINITIONS).flatMap((definition) =>
    Object.values(definition.unitProfiles).flatMap((profile) =>
      profile.units.map((unit) => [normalizeUnitToken(unit), definition.metricKind])
    )
  )
);

// What an entity's unit alone may decide: the metric kind when the unit belongs to one
// measurement, null otherwise. The whole fallback rule in one place.
export function metricKindFromUnitAlone(rawUnit) {
  if (!unitPredictsMetricKind(rawUnit)) return null;
  return METRIC_TYPE_BY_UNIT[normalizeUnitToken(rawUnit)] || null;
}

// Maps one entity's raw unit_of_measurement to a METRIC_DEFINITIONS unitProfile key
// (e.g. "°F" -> "fahrenheit"); null when the kind is unknown or the unit matches no
// registered profile. Both sides go through normalizeUnitToken(), so Unicode/text
// variants map without weakening the rejection of unknown units. Unaffected by the
// ambiguity rule: the metric kind is already settled by the time this runs.
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

// Resolving a metric kind and a unit profile from what an entity reports.
//
// Two lookup paths, in trust order: device_class first (HA's own declaration), then
// unit_of_measurement — but only for a sensor that declares no Home Assistant class, and
// only where the unit PREDICTS the measurement (see below). METRIC_TYPE_BY_UNIT is DERIVED
// from METRIC_DEFINITIONS, so it cannot drift from it. Every table lookup is own-key only.
// Details: see internal dev doc §5 "Messart-Bestimmung aus der Einheit".

import { METRIC_DEFINITIONS } from "./definitions.js";
import { normalizeUnitToken } from "../units/unit-token.js";

// Values match Home Assistant's SensorDeviceClass enum.
export const METRIC_TYPE_BY_DEVICE_CLASS = {
  temperature: "temperature",
  humidity: "humidity",
  carbon_dioxide: "co2",
  pm25: "pm25",
};

// Every SensorDeviceClass value (homeassistant/components/sensor/const.py). A class listed
// here is a declaration; one missing from it counts as undeclared, so the unit may decide.
export const HA_SENSOR_DEVICE_CLASSES = Object.freeze([
  "date", "enum", "timestamp", "uptime", "absolute_humidity", "apparent_power", "aqi", "area",
  "atmospheric_pressure", "battery", "blood_glucose_concentration", "carbon_monoxide",
  "carbon_dioxide", "conductivity", "current", "data_rate", "data_size", "distance", "duration",
  "energy", "energy_distance", "energy_storage", "frequency", "gas", "humidity", "illuminance",
  "irradiance", "moisture", "monetary", "nitrogen_dioxide", "nitrogen_monoxide", "nitrous_oxide",
  "ozone", "ph", "pm1", "pm10", "pm25", "pm4", "power_factor", "power", "precipitation",
  "precipitation_intensity", "pressure", "radon", "reactive_energy", "reactive_power",
  "signal_strength", "sound_pressure", "speed", "sulphur_dioxide", "temperature",
  "temperature_delta", "volatile_organic_compounds", "volatile_organic_compounds_parts",
  "voltage", "volume", "volume_storage", "volume_flow_rate", "water", "weight", "wind_direction",
  "wind_speed",
]);
const HA_SENSOR_DEVICE_CLASS_SET = new Set(HA_SENSOR_DEVICE_CLASSES);

const NOTHING_DECLARED = Object.freeze({ metricKind: null, foreign: false });
const FOREIGN_MEASUREMENT = Object.freeze({ metricKind: null, foreign: true });
const DECLARED_KIND = Object.freeze(
  Object.fromEntries(
    Object.entries(METRIC_TYPE_BY_DEVICE_CLASS).map(([deviceClass, metricKind]) => [
      deviceClass,
      Object.freeze({ metricKind, foreign: false }),
    ])
  )
);

// What a device_class attribute declares: one of the card's kinds, a Home Assistant
// measurement the card does not show (`foreign`), or nothing — absent, not a string, or a
// value Home Assistant does not define (a typo), which leaves the unit to decide.
export function classifyDeviceClass(rawDeviceClass) {
  if (typeof rawDeviceClass !== "string") return NOTHING_DECLARED;
  const deviceClass = rawDeviceClass.trim().toLowerCase();
  if (Object.hasOwn(DECLARED_KIND, deviceClass)) return DECLARED_KIND[deviceClass];
  return HA_SENSOR_DEVICE_CLASS_SET.has(deviceClass) ? FOREIGN_MEASUREMENT : NOTHING_DECLARED;
}

// WHICH DEVICE CLASSES CLAIM EACH UNIT — the fact the fallback rule is built on. A unit
// stands in for a device_class only if it belongs to ONE measurement: °C is always
// temperature, but HA defines many sensor classes that report µg/m³ or ppm, so those
// predict nothing. Listed are the classes a climate card could plausibly be pointed at;
// the fallback only reaches a sensor declaring no HA class, so a battery reporting %
// never gets here, and an undeclared % sensor stays humidity.
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

// Which of the card's measurements a registered unit string belongs to, or null.
export function metricKindOfUnit(rawUnit) {
  const token = normalizeUnitToken(rawUnit);
  return Object.hasOwn(METRIC_TYPE_BY_UNIT, token) ? METRIC_TYPE_BY_UNIT[token] : null;
}

// What an entity's unit alone may decide: the metric kind when the unit belongs to one
// measurement, null otherwise. The whole fallback rule in one place.
export function metricKindFromUnitAlone(rawUnit) {
  if (!unitPredictsMetricKind(rawUnit)) return null;
  return metricKindOfUnit(rawUnit);
}

// Maps one entity's raw unit_of_measurement to a METRIC_DEFINITIONS unitProfile key
// (e.g. "°F" -> "fahrenheit"); null when the kind is unknown or the unit matches no
// registered profile. Both sides go through normalizeUnitToken(), so Unicode/text
// variants map without weakening the rejection of unknown units. Unaffected by the
// ambiguity rule: the metric kind is already settled by the time this runs.
export function resolveUnitProfileKey(metricKind, rawUnit) {
  if (!Object.hasOwn(METRIC_DEFINITIONS, metricKind) || !rawUnit) return null;
  const definition = METRIC_DEFINITIONS[metricKind];
  const normalized = normalizeUnitToken(rawUnit);
  return (
    Object.keys(definition.unitProfiles).find((key) =>
      definition.unitProfiles[key].units.some((unit) => normalizeUnitToken(unit) === normalized)
    ) || null
  );
}

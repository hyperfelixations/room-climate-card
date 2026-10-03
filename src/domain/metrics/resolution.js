// Resolving a metric kind and a unit profile from what an entity reports.
//
// Two lookup paths, in trust order: device_class first (HA's own declaration), then
// unit_of_measurement — but only for a sensor that declares no Home Assistant class, and
// only where the unit PREDICTS the measurement (see identifyMeasurement()). Every table here
// is DERIVED from the metric definitions and Home Assistant's own tables, so none can drift
// from them; createMetricResolution() derives them for any set of definitions, which is how
// tests try a kind before it exists. Every table lookup is own-key only. Details: see
// internal dev doc §5 "Messart-Bestimmung aus der Einheit".

import { METRIC_DEFINITIONS } from "./definitions.js";
import { HA_DEVICE_CLASS_UNITS, HA_SENSOR_DEVICE_CLASSES } from "./home-assistant.js";
import { normalizeUnitToken } from "../units/unit-token.js";

// How an entity's measurement was identified. A unit identifies it only when no Home Assistant
// class is declared and the unit belongs to one card kind and at most one Home Assistant class;
// an ambiguous unit is one of the card's units that another class or kind also reports.
export const MEASUREMENT_BASIS = Object.freeze({
  DEVICE_CLASS: "device_class",
  FOREIGN: "foreign",
  UNIT: "unit",
  UNIT_AMBIGUOUS: "unit_ambiguous",
  UNIT_UNKNOWN: "unit_unknown",
  NOTHING: "nothing",
});

// key -> frozen [values] from [key, value] pairs, in first-seen order.
function groupPairs(pairs) {
  const groups = {};
  for (const [key, value] of pairs) groups[key] = [...(Object.hasOwn(groups, key) ? groups[key] : []), value];
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, Object.freeze(values)])));
}

export function createMetricResolution({ definitions, haDeviceClasses, haDeviceClassUnits }) {
  // Each card kind's own Home Assistant device class.
  const metricTypeByDeviceClass = Object.freeze(
    Object.fromEntries(Object.values(definitions).map(({ deviceClass, metricKind }) => [deviceClass, metricKind]))
  );
  const haDeviceClassSet = new Set(haDeviceClasses);
  const nothingDeclared = Object.freeze({ metricKind: null, foreign: false });
  const foreignMeasurement = Object.freeze({ metricKind: null, foreign: true });
  const declaredKind = Object.fromEntries(
    Object.entries(metricTypeByDeviceClass).map(([deviceClass, metricKind]) => [deviceClass, Object.freeze({ metricKind, foreign: false })])
  );

  // What a device_class attribute declares: one of the card's kinds, a Home Assistant
  // measurement the card does not show (`foreign`), or nothing — absent, not a string, or a
  // value Home Assistant does not define (a typo), which leaves the unit to decide.
  function classifyDeviceClass(rawDeviceClass) {
    if (typeof rawDeviceClass !== "string") return nothingDeclared;
    const deviceClass = rawDeviceClass.trim().toLowerCase();
    if (Object.hasOwn(declaredKind, deviceClass)) return declaredKind[deviceClass];
    return haDeviceClassSet.has(deviceClass) ? foreignMeasurement : nothingDeclared;
  }

  // Which Home Assistant device classes report each unit token. °C is always temperature;
  // ppm and µg/m³ are reported by several classes and so say nothing on their own.
  const deviceClassesByUnit = groupPairs(
    Object.entries(haDeviceClassUnits).flatMap(([deviceClass, units]) => units.map((unit) => [normalizeUnitToken(unit), deviceClass]))
  );

  // Which of the card's own kinds register each unit token, from every alias of every unit
  // profile. Two kinds sharing a unit (PM1 and PM2.5 in µg/m³) both appear; nothing here picks.
  const metricKindsByUnit = groupPairs(
    Object.values(definitions).flatMap((definition) =>
      Object.values(definition.unitProfiles).flatMap((profile) => profile.units.map((unit) => [normalizeUnitToken(unit), definition.metricKind]))
    )
  );

  // The card kind a registered unit string belongs to — "a profile written in ppm is a CO2
  // profile" — or null when no kind or more than one registers it.
  function metricKindOfUnit(rawUnit) {
    const token = normalizeUnitToken(rawUnit);
    if (!Object.hasOwn(metricKindsByUnit, token)) return null;
    const kinds = metricKindsByUnit[token];
    return kinds.length === 1 ? kinds[0] : null;
  }

  // { metricKind, basis, unknownDeviceClass }: the kind (null when none is identified), how it
  // was decided, and whether a device_class Home Assistant does not define was written — a typo
  // declares nothing, so the unit still decides.
  function identifyMeasurement(rawDeviceClass, rawUnit) {
    const identity = (metricKind, basis, unknownDeviceClass = false) => Object.freeze({ metricKind, basis, unknownDeviceClass });
    const declared = classifyDeviceClass(rawDeviceClass);
    if (declared.metricKind) return identity(declared.metricKind, MEASUREMENT_BASIS.DEVICE_CLASS);
    if (declared.foreign) return identity(null, MEASUREMENT_BASIS.FOREIGN);
    const unknownDeviceClass = typeof rawDeviceClass === "string" && rawDeviceClass.trim() !== "";
    const token = normalizeUnitToken(rawUnit);
    if (token === "") return identity(null, MEASUREMENT_BASIS.NOTHING, unknownDeviceClass);
    if (!Object.hasOwn(metricKindsByUnit, token)) return identity(null, MEASUREMENT_BASIS.UNIT_UNKNOWN, unknownDeviceClass);
    const kinds = metricKindsByUnit[token];
    const sharedByClasses = Object.hasOwn(deviceClassesByUnit, token) && deviceClassesByUnit[token].length > 1;
    if (kinds.length > 1 || sharedByClasses) return identity(null, MEASUREMENT_BASIS.UNIT_AMBIGUOUS, unknownDeviceClass);
    return identity(kinds[0], MEASUREMENT_BASIS.UNIT, unknownDeviceClass);
  }

  // Maps one entity's raw unit_of_measurement to a unitProfile key (e.g. "°F" ->
  // "fahrenheit"); null when the kind is unknown or the unit matches no registered profile.
  // Both sides go through normalizeUnitToken(), so Unicode/text variants map without
  // weakening the rejection of unknown units. Unaffected by the ambiguity rule: the metric
  // kind is already settled by the time this runs.
  function resolveUnitProfileKey(metricKind, rawUnit) {
    if (!Object.hasOwn(definitions, metricKind) || !rawUnit) return null;
    const { unitProfiles } = definitions[metricKind];
    const normalized = normalizeUnitToken(rawUnit);
    return Object.keys(unitProfiles).find((key) => unitProfiles[key].units.some((unit) => normalizeUnitToken(unit) === normalized)) || null;
  }

  // The unit profile a kind's device class leaves no choice in: Home Assistant allows exactly
  // one unit for it, and one of the kind's profiles reads that unit (humidity %, not
  // temperature with °C, °F and K).
  const impliedUnitProfile = Object.freeze(
    Object.fromEntries(
      Object.values(definitions).flatMap(({ metricKind, deviceClass }) => {
        if (!Object.hasOwn(haDeviceClassUnits, deviceClass) || haDeviceClassUnits[deviceClass].length !== 1) return [];
        const profileKey = resolveUnitProfileKey(metricKind, haDeviceClassUnits[deviceClass][0]);
        return profileKey ? [[metricKind, profileKey]] : [];
      })
    )
  );

  // The unit profile a sensor's reading is in: its own unit's, or — when it reports none and
  // its kind was declared by device class — the implied one. A reported unit is never
  // overruled; range and trend sensors keep requiring one (resolveUnitProfileKey()).
  function sensorUnitProfileKey(metricKind, rawUnit, basis) {
    if (normalizeUnitToken(rawUnit) !== "") return resolveUnitProfileKey(metricKind, rawUnit);
    if (basis !== MEASUREMENT_BASIS.DEVICE_CLASS || !Object.hasOwn(impliedUnitProfile, metricKind)) return null;
    return impliedUnitProfile[metricKind];
  }

  return Object.freeze({
    METRIC_TYPE_BY_DEVICE_CLASS: metricTypeByDeviceClass,
    DEVICE_CLASSES_BY_UNIT: deviceClassesByUnit,
    METRIC_KINDS_BY_UNIT: metricKindsByUnit,
    IMPLIED_UNIT_PROFILE: impliedUnitProfile,
    classifyDeviceClass,
    metricKindOfUnit,
    identifyMeasurement,
    resolveUnitProfileKey,
    sensorUnitProfileKey,
  });
}

export const {
  METRIC_TYPE_BY_DEVICE_CLASS,
  DEVICE_CLASSES_BY_UNIT,
  METRIC_KINDS_BY_UNIT,
  IMPLIED_UNIT_PROFILE,
  classifyDeviceClass,
  metricKindOfUnit,
  identifyMeasurement,
  resolveUnitProfileKey,
  sensorUnitProfileKey,
} = createMetricResolution({
  definitions: METRIC_DEFINITIONS,
  haDeviceClasses: HA_SENSOR_DEVICE_CLASSES,
  haDeviceClassUnits: HA_DEVICE_CLASS_UNITS,
});

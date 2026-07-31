// Resolving a metric kind and a unit profile from what an entity reports.
//
// Two independent lookup paths, in the order the card trusts them:
//   1. device_class — Home Assistant's own declaration, the primary source.
//   2. unit_of_measurement — the fallback when device_class is missing or
//      unknown.
//
// METRIC_TYPE_BY_UNIT is DERIVED from METRIC_DEFINITIONS rather than
// hand-maintained, so profile aliases and the lookup index cannot drift apart.
// One registered unit string can only ever belong to one metric kind, so
// a plain last-write-wins merge is safe.

import { METRIC_DEFINITIONS } from "./definitions.js";
import { normalizeUnitToken } from "../units/unit-token.js";

// Values match Home Assistant's SensorDeviceClass enum.
export const METRIC_TYPE_BY_DEVICE_CLASS = {
  temperature: "temperature",
  humidity: "humidity",
  carbon_dioxide: "co2",
  pm25: "pm25",
};

export const METRIC_TYPE_BY_UNIT = Object.fromEntries(
  Object.values(METRIC_DEFINITIONS).flatMap((definition) =>
    Object.values(definition.unitProfiles).flatMap((profile) =>
      profile.units.map((unit) => [normalizeUnitToken(unit), definition.metricKind])
    )
  )
);

// Maps one entity's own raw unit_of_measurement to a METRIC_DEFINITIONS
// unitProfile key (e.g. "°F" -> "fahrenheit"); null when metricKind is unknown
// or rawUnit doesn't match any registered profile. Both sides of the
// comparison go through normalizeUnitToken(), so equivalent Unicode/text
// spellings map to the same registered unit without weakening the rejection of
// genuinely unknown units.
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

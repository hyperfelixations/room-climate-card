// Presentation-only metadata for titles, icons, formatting and chip density.
// Canonical-unit fallbacks come from metric definitions; classification bands
// remain in the semantic profiles.

import { METRIC_DEFINITIONS } from "../../domain/metrics/definitions.js";

export const METRIC_META = {
  temperature: {
    titleKey: "title.temperature",
    icon: "mdi:thermometer",
    emptyIcon: "mdi:thermometer-off",
    unitFallback: METRIC_DEFINITIONS.temperature.canonicalUnit,
    decimals: 1,
    lowRoomKey: "card.coldestRoom",
    highRoomKey: "card.warmestRoom",
    aboveAdjectiveKey: "adjective.warm",
    belowAdjectiveKey: "adjective.cool",
    autoRoomColumns: 7,
  },
  humidity: {
    titleKey: "title.humidity",
    icon: "mdi:water-percent",
    emptyIcon: "mdi:water-off",
    unitFallback: METRIC_DEFINITIONS.humidity.canonicalUnit,
    decimals: 1,
    lowRoomKey: "card.driestRoom",
    highRoomKey: "card.mostHumidRoom",
    aboveAdjectiveKey: "adjective.humid",
    belowAdjectiveKey: "adjective.dry",
    autoRoomColumns: 7,
  },
  co2: {
    titleKey: "title.co2",
    icon: "mdi:molecule-co2",
    emptyIcon: "mdi:molecule-co2",
    unitFallback: METRIC_DEFINITIONS.co2.canonicalUnit,
    decimals: 0,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
  pm25: {
    titleKey: "title.pm25",
    icon: "mdi:molecule",
    emptyIcon: "mdi:molecule",
    unitFallback: METRIC_DEFINITIONS.pm25.canonicalUnit,
    decimals: 1,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
};

// Unknown kinds use temperature metadata so mixed-kind cards remain presentable.
export function metricMetaFor(metricKind) {
  return METRIC_META[metricKind] || METRIC_META.temperature;
}

// Conservative automatic-grid limit that keeps values and units readable.
export function autoRoomColumnsFor(metricKind) {
  return metricMetaFor(metricKind).autoRoomColumns || 7;
}

// Maps the structural low/high role to metric-specific wording.
export function extremeRoomLabel(role, metricKind, texts) {
  const meta = metricMetaFor(metricKind);
  return texts.t(role === "cold" ? meta.lowRoomKey : meta.highRoomKey);
}

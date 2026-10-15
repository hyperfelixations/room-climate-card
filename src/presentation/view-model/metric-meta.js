// Presentation-only metadata for titles, icons, formatting and chip density, one entry per
// metric kind; classification bands remain in the semantic profiles.

export const METRIC_META = {
  temperature: {
    titleKey: "title.temperature",
    icon: "mdi:thermometer",
    emptyIcon: "mdi:thermometer-off",
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
    decimals: 1,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
  pm1: {
    titleKey: "title.pm1",
    icon: "mdi:molecule",
    emptyIcon: "mdi:molecule",
    decimals: 1,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
  pm4: {
    titleKey: "title.pm4",
    icon: "mdi:molecule",
    emptyIcon: "mdi:molecule",
    decimals: 1,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
  pm10: {
    titleKey: "title.pm10",
    icon: "mdi:molecule",
    emptyIcon: "mdi:molecule",
    decimals: 1,
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    autoRoomColumns: 5,
  },
  co: {
    titleKey: "title.co",
    icon: "mdi:molecule-co",
    emptyIcon: "mdi:molecule-co",
    decimals: 1,
    unitFormatting: {
      ppm: { decimals: 1, boundaryDecimals: 1 },
      ppb: { decimals: 0, boundaryDecimals: 0 },
      milligram_per_m3: { decimals: 1, boundaryDecimals: 0 },
      microgram_per_m3: { decimals: 0, boundaryDecimals: 0 },
    },
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

export function metricFormattingFor(metricKind, unitProfileKey) {
  const meta = metricMetaFor(metricKind);
  return meta.unitFormatting?.[unitProfileKey] || { decimals: meta.decimals, boundaryDecimals: 0 };
}

// Presentation-only metadata for titles, icons, formatting and the readings room chips are sized
// for, one entry per metric kind; classification bands remain in the semantic profiles.
// `typicalReading` is in the canonical unit; see internal dev doc §5 "Raumchip-Passung".

// PM1, PM2.5, PM4 and PM10 differ only in their title.
const PARTICULATE_META = {
  icon: "mdi:molecule",
  emptyIcon: "mdi:molecule",
  decimals: 1,
  lowRoomKey: "card.lowestRoom",
  highRoomKey: "card.highestRoom",
  aboveAdjectiveKey: "adjective.elevated",
  belowAdjectiveKey: "adjective.low",
  typicalReading: { min: 0, max: 75 },
};

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
    typicalReading: { min: 10, max: 35 },
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
    typicalReading: { min: 20, max: 80 },
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
    typicalReading: { min: 400, max: 2000 },
  },
  pm25: { ...PARTICULATE_META, titleKey: "title.pm25" },
  pm1: { ...PARTICULATE_META, titleKey: "title.pm1" },
  pm4: { ...PARTICULATE_META, titleKey: "title.pm4" },
  pm10: { ...PARTICULATE_META, titleKey: "title.pm10" },
  co: {
    titleKey: "title.co",
    icon: "mdi:molecule-co",
    emptyIcon: "mdi:molecule-co",
    decimals: 1,
    unitDecimals: { ppm: 1, ppb: 0, milligram_per_m3: 1, microgram_per_m3: 0 },
    lowRoomKey: "card.lowestRoom",
    highRoomKey: "card.highestRoom",
    aboveAdjectiveKey: "adjective.elevated",
    belowAdjectiveKey: "adjective.low",
    // 0–12 mg/m³ is about 0–10 ppm.
    typicalReading: { min: 0, max: 12 },
  },
};

// Unknown kinds use temperature metadata so mixed-kind cards remain presentable.
export function metricMetaFor(metricKind) {
  return METRIC_META[metricKind] || METRIC_META.temperature;
}

// Maps the structural low/high role to metric-specific wording.
export function extremeRoomLabel(role, metricKind, texts) {
  const meta = metricMetaFor(metricKind);
  return texts.t(role === "cold" ? meta.lowRoomKey : meta.highRoomKey);
}

// The decimals a reading of this kind shows in this unit by default.
function unitDecimalsFor(metricKind, unitProfileKey) {
  const meta = metricMetaFor(metricKind);
  return meta.unitDecimals?.[unitProfileKey] ?? meta.decimals;
}

// The digits a reading is shown with: the card's `decimals` when set, else its unit's own.
export function readingDigits(metricKind, unitProfileKey, decimals) {
  return decimals ?? unitDecimalsFor(metricKind, unitProfileKey);
}

// The most digits a band or axis boundary is shown with (trailing zeros dropped): never fewer
// than its unit's readings, so a boundary reads as it applies. See internal dev doc §5
// "Grenzbeschriftungen".
export function boundaryDigits(metricKind, unitProfileKey, decimals) {
  return Math.max(unitDecimalsFor(metricKind, unitProfileKey), decimals ?? 0);
}

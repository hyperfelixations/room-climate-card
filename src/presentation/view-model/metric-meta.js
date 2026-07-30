// Presentation metadata per metric kind.
//
// Everything here is about how a reading is PRESENTED — which title to translate,
// which icon to show, how many decimals to print, which noun to use for the
// coldest/warmest-equivalent room, how many chips fit in a row. None of it is a
// measurement fact, which is why it lives in the presentation layer and not next
// to the metric definitions.
//
// unitFallback is the one exception in the other direction: the canonical unit IS
// a measurement fact, so it is read from the metric definition rather than spelled
// out a second time. It is only used when an entity reports no unit of its own.
//
// Comfort, optimal and base-scale bands deliberately do NOT appear here. They are
// semantic decisions and belong to the classification profiles.

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

// An unknown or missing metric kind resolves to temperature, so a card in the
// mixed-kind state still has a sensible title and icon instead of blanks.
export function metricMetaFor(metricKind) {
  return METRIC_META[metricKind] || METRIC_META.temperature;
}

// Max chips per row in fully automatic grid mode. Kept conservative enough that a
// chip's number plus unit never has to shrink to fit.
export function autoRoomColumnsFor(metricKind) {
  return metricMetaFor(metricKind).autoRoomColumns || 7;
}

// The noun for the coldest/warmest-equivalent room. "cold"/"warm" are the two
// structural roles; the wording itself is metric-specific ("driest room" for
// humidity, "lowest" for co2 and pm25), which is why the caller passes a role and
// not a translation key.
export function extremeRoomLabel(role, metricKind, texts) {
  const meta = metricMetaFor(metricKind);
  return texts.t(role === "cold" ? meta.lowRoomKey : meta.highRoomKey);
}

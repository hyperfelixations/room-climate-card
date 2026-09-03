"use strict";

// Canonical hand-written render-layer models shared by narrow owner tests.

function marker(overrides = {}) {
  return { position: 50, shiftPx: 0, color: "#4488cc", shadow: "rgba(68,136,204,0.28)", title: "Tooltip", ...overrides };
}

function axis(overrides = {}) {
  return {
    scaleMin: 19,
    scaleMax: 25,
    comfortLeft: 16.7,
    comfortWidth: 66.7,
    comfortVisible: true,
    comfortCenter: 50,
    optimalLeft: 33.3,
    optimalWidth: 33.3,
    optimalVisible: true,
    optimalCenter: 50,
    optimalMin: 21,
    optimalMax: 23,
    displayStep: 1,
    markerPositions: { avg: 50, min: 20, max: 80, current: 50, coolest: 20, warmest: 80 },
    boundaryLabels: { min: "19 °C", max: "25 °C" },
    ...overrides,
  };
}

function scaleBarContent(overrides = {}) {
  return {
    key: "scale",
    geometry: axis(),
    showComfortBand: true,
    showOptimalBand: true,
    optimalLabel: { long: "Optimal 21–23 °C", short: "Opt. 21–23 °C", center: 50, visible: true },
    boundaryLabels: axis().boundaryLabels,
    footerText: "3 of 4 in comfort",
    ...overrides,
  };
}

function metricCardModel(overrides = {}) {
  return {
    label: "Coldest room",
    nameText: "Kitchen",
    numText: "19.2",
    unitText: " °C",
    roomIndex: 0,
    entity: "sensor.kitchen",
    color: "#4488cc",
    background: "rgba(68,136,204,0.09)",
    border: "rgba(68,136,204,0.36)",
    lineShadow: "rgba(68,136,204,0.24)",
    title: "Coldest room: Kitchen 19.2 °C",
    ariaLabel: "Open Coldest room Kitchen",
    ...overrides,
  };
}

function chip(index, label, overrides = {}) {
  return {
    room: { index, name: label },
    entity: `sensor.r${index}`,
    index,
    displayLabel: label,
    shortGuaranteed: true,
    color: "#4488cc",
    mark: "•",
    out: false,
    markBackground: "rgba(68,136,204,0.18)",
    background: "var(--rtc-chip-bg)",
    border: "var(--rtc-hairline)",
    valueText: "21.0",
    unitText: "°C",
    title: `${label}: 21.0 °C`,
    ariaLabel: `Open ${label}`,
    ...overrides,
  };
}

// A hand-written CardViewModel with only the fields the rendering layer reads.
function viewModel(overrides = {}) {
  const chips = [chip(0, "KI"), chip(1, "BA")];
  return {
    empty: false,
    metric: { kind: "temperature", unit: "°C", displayUnitProfile: null },
    title: "Temperature",
    subtitle: "All rooms comfortable",
    tone: { label: "Optimal", color: "#79A86C", soft: "rgba(121,168,108,0.2)", icon: "mdi:thermometer" },
    toneStyle: "--tone-color:#79A86C;--tone-soft:rgba(121,168,108,0.2);",
    accentLine: true,
    hasPanel: true,
    hiddenHint: "layout.nothingShown",
    header: {
      icon: "mdi:thermometer",
      title: "Temperature",
      hasTitle: true,
      titleOverflow: "wrap",
      subtitle: "All rooms comfortable",
      hasSubtitle: true,
      subtitleOverflow: "clip",
      statusLabel: "Optimal",
      hasIcon: true,
      hasPill: true,
    },
    average: {
      value: 22,
      valueText: "22.0",
      unitText: "°C",
      label: "Average",
      hasLabel: true,
      entity: "sensor.avg",
      source: "sensor",
      roomIndex: null,
      color: "#79A86C",
      position: 50,
      tooltip: "Average 22.0 °C",
      ariaLabel: "Open average",
      trendDirection: null,
    },
    rooms: {
      visible: chips.map((c) => c.room),
      rowSizes: [{ itemCount: 2, columnCount: 2 }],
      count: 2,
      comparable: true,
      showChips: true,
      chips,
      chipRows: [{ columnCount: 2, chips }],
    },
    roomMarkers: [],
    carousel: { hint: "Swipe to switch views", noActiveViewsHint: "No views available" },
    views: {
      keys: ["scale"],
      entries: [],
      options: {},
      collapsed: false,
      hasRangeScale: false,
      byKey: {
        range: null,
        range_scale: null,
        scale: {
          ...scaleBarContent(),
          comfortLabel: { long: "Comfort 20–24 °C", short: "Comfort 20–24 °C", center: 50, visible: true },
          emphasizeAverage: false,
          markers: { extremes: null, rooms: [], average: marker() },
        },
        extremes: null,
      },
    },
    ...overrides,
  };
}

function emptyViewModel(overrides = {}) {
  const base = viewModel();
  return {
    ...base,
    empty: true,
    metric: { kind: "co2", unit: "", displayUnitProfile: null },
    title: "CO₂",
    subtitle: "No data yet.",
    noData: { hintKind: "value-unavailable" },
    header: {
      icon: "mdi:molecule-co2",
      title: "CO₂",
      hasTitle: true,
      titleOverflow: "wrap",
      subtitle: "No data yet.",
      hasSubtitle: true,
      subtitleOverflow: "clip",
      statusLabel: "No data",
      hasIcon: true,
      hasPill: true,
    },
    average: {
      ...base.average,
      value: null,
      valueText: "--",
      unitText: "",
      entity: "",
      trendDirection: null,
      unavailable: true,
    },
    rooms: { ...base.rooms, visible: [], rowSizes: [], count: 0, comparable: false, showChips: false, chips: [], chipRows: [] },
    views: { keys: [], entries: [], options: {}, collapsed: true, hasRangeScale: false, byKey: {} },
    carousel: { hint: "", noActiveViewsHint: "" },
    ...overrides,
  };
}
module.exports = { marker, axis, scaleBarContent, metricCardModel, chip, viewModel, emptyViewModel };

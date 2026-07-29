"use strict";

// The scenario catalog behind the Phase 0 characterization baselines (see
// characterization.js for the harness and the rationale).
//
// Every entry is a fully deterministic {config, states, language} triple. The
// catalog deliberately spans the axes that the later source split touches, so
// a regression in any one of them shows up as a baseline diff:
//
//   configuration cases   A (minimal) / B (rooms) / C (range) / D (full)
//   metric kinds          temperature, humidity, CO2, PM2.5
//   unit profiles         °C, °F, K, and a mixed-unit room consensus
//   classification        auto/builtin, indoor, outdoor, fridge, entity, custom
//   measurement states    empty, missing rooms, mixed metric kinds
//   view composition      auto, explicit order, solo, collapsed, unavailable
//   view options          bands, footers, marker modes, timestamps, values
//   presentation          room grid caps, sorting, labels, overrides, i18n
//   carousel config       auto_slide/swipe off, custom timings
//
// States use fixed last_changed/last_updated timestamps: the render signature
// in _render() incorporates last_updated, so a live `new Date()` would make
// the captured markup depend on when the suite ran.

const FIXED_TS = "2026-07-24T05:00:00Z";

function st(entityId, state, attributes) {
  return {
    entity_id: entityId,
    state: String(state),
    attributes: attributes || {},
    last_changed: FIXED_TS,
    last_updated: FIXED_TS,
  };
}

const C = { device_class: "temperature", unit_of_measurement: "°C" };
const F = { device_class: "temperature", unit_of_measurement: "°F" };
const K = { device_class: "temperature", unit_of_measurement: "K" };
const RH = { device_class: "humidity", unit_of_measurement: "%" };
const CO2 = { device_class: "carbon_dioxide", unit_of_measurement: "ppm" };
const PM = { device_class: "pm25", unit_of_measurement: "µg/m³" };

// Seven rooms with stable, spread-out Celsius values (two outside the 20-24
// comfort band in each direction, so subtitle/comfort counting/extrema/spread
// all have non-trivial values).
const SEVEN_ROOM_VALUES = [19.2, 20.8, 21.6, 22.3, 23.1, 24.4, 25.7];
const SEVEN_ROOMS = SEVEN_ROOM_VALUES.map((value, index) => ({
  name: `Room ${index + 1}`,
  short: `R${index + 1}`,
  entity: `sensor.room_${index + 1}`,
  value,
}));

function sevenRoomStates() {
  const states = {};
  for (const room of SEVEN_ROOMS) states[room.entity] = st(room.entity, room.value, C);
  return states;
}

function sevenRoomConfig() {
  return SEVEN_ROOMS.map(({ name, short, entity }) => ({ name, short, entity }));
}

const RANGE_ATTRS_C = {
  ...C,
  minimum: 19.8,
  maximum: 24.9,
  minimum_zeitpunkt: "2026-07-24T06:12:00Z",
  maximum_zeitpunkt: "2026-07-24T15:41:00Z",
};

const CUSTOM_CLASSIFICATION = {
  source: "custom",
  unit: "°C",
  comparison: ">=",
  bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
  scale: { min: 16, max: 28, step: 2 },
  tiers: [
    { min: 26, score: 5, level: "Custom hot", color: "#cc4444", zone: "outside" },
    { min: 24, score: 4, level: "Custom warm", color: "#ccaa44", zone: "comfort" },
    { min: 21, score: 3, level: "Custom optimal", color: "#44cc66", zone: "optimal" },
    { min: 18, score: 2, level: "Custom cool", color: "#4488cc", zone: "comfort" },
    { default: true, score: 1, level: "Custom cold", color: "#8888cc", zone: "outside" },
  ],
  valid_range: { min: -40, max: 60 },
  icons: { fire: 30, high: 26, normal: 19, low: 15 },
};

const SCENARIOS = [
  {
    name: "case-a-minimal",
    config: { entity: "sensor.avg" },
    states: { "sensor.avg": st("sensor.avg", 22.4, C) },
  },
  {
    name: "case-b-rooms-no-range",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig() },
    states: { "sensor.avg": st("sensor.avg", 22.4, { ...C, spread: 6.5 }), ...sevenRoomStates() },
  },
  {
    name: "case-c-range-no-rooms",
    config: { entity: "sensor.avg", range_entity: "sensor.range" },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
    },
  },
  {
    name: "case-d-full",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      trend_entity: "sensor.trend",
      rooms: sevenRoomConfig(),
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, { ...C, spread: 6.5 }),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      "sensor.trend": st("sensor.trend", 0.42, { ...C, unit_of_measurement: "°C/h" }),
      ...sevenRoomStates(),
    },
  },
  {
    name: "case-d-with-range-scale",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      trend_entity: "sensor.trend",
      rooms: sevenRoomConfig(),
      views: ["range", "range_scale", "scale", "extremes"],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, { ...C, spread: 6.5 }),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      "sensor.trend": st("sensor.trend", -0.35, { ...C, unit_of_measurement: "°C/h" }),
      ...sevenRoomStates(),
    },
  },
  {
    name: "metric-humidity",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Bath", short: "BA", entity: "sensor.r1" },
        { name: "Bedroom", short: "BE", entity: "sensor.r2" },
        { name: "Living", short: "LI", entity: "sensor.r3" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 52.4, RH),
      "sensor.r1": st("sensor.r1", 63.5, RH),
      "sensor.r2": st("sensor.r2", 47.2, RH),
      "sensor.r3": st("sensor.r3", 38.9, RH),
    },
  },
  {
    name: "metric-co2",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Office", short: "OF", entity: "sensor.r1" },
        { name: "Bedroom", short: "BE", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 812, CO2),
      "sensor.r1": st("sensor.r1", 1180, CO2),
      "sensor.r2": st("sensor.r2", 640, CO2),
    },
  },
  {
    name: "metric-pm25",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Kitchen", short: "KI", entity: "sensor.r1" },
        { name: "Living", short: "LI", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 12.4, PM),
      "sensor.r1": st("sensor.r1", 27.8, PM),
      "sensor.r2": st("sensor.r2", 4.1, PM),
    },
  },
  {
    name: "units-fahrenheit-native",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      trend_entity: "sensor.trend",
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 72.5, { ...F, spread: 5.4 }),
      "sensor.r1": st("sensor.r1", 69.8, F),
      "sensor.r2": st("sensor.r2", 75.2, F),
      "sensor.range": st("sensor.range", 8.1, {
        ...F,
        minimum: 64.4,
        maximum: 77.9,
        minimum_zeitpunkt: "2026-07-24T05:48:00Z",
        maximum_zeitpunkt: "2026-07-24T16:03:00Z",
      }),
      "sensor.trend": st("sensor.trend", 1.8, { ...F, unit_of_measurement: "°F/h" }),
    },
  },
  {
    name: "units-kelvin",
    config: { entity: "sensor.avg" },
    states: { "sensor.avg": st("sensor.avg", 295.35, K) },
  },
  {
    name: "units-mixed-room-consensus",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", "unavailable", C),
      "sensor.r1": st("sensor.r1", 70.0, F),
      "sensor.r2": st("sensor.r2", 22.0, C),
    },
  },
  {
    name: "state-mixed-metric-kinds",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", "unavailable", C),
      "sensor.r1": st("sensor.r1", 21.5, C),
      "sensor.r2": st("sensor.r2", 55.0, RH),
    },
  },
  {
    name: "state-empty-missing-rooms",
    config: {
      entity: "sensor.avg",
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.missing" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", "unavailable", C),
      "sensor.r1": st("sensor.r1", "unknown", C),
    },
  },
  {
    name: "state-empty-no-rooms-configured",
    config: { entity: "sensor.avg" },
    states: { "sensor.avg": st("sensor.avg", "unavailable", C) },
  },
  {
    name: "classification-outdoor-profile",
    config: { entity: "sensor.avg", classification: "outdoor" },
    states: { "sensor.avg": st("sensor.avg", 11.8, C) },
  },
  {
    name: "classification-fridge-profile",
    config: { entity: "sensor.avg", classification: { source: "profile", profile: "fridge" } },
    states: { "sensor.avg": st("sensor.avg", 4.2, C) },
  },
  {
    name: "classification-entity-attributes",
    config: {
      entity: "sensor.avg",
      classification: "entity",
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, {
        ...C,
        value_color: "#3fa7d6",
        value_level: "Server level",
        value_score: 7,
        value_zone: "comfort",
      }),
      "sensor.r1": st("sensor.r1", 21.1, { ...C, value_color: "#7ac74f", value_level: "Room A level" }),
      "sensor.r2": st("sensor.r2", 23.6, C),
    },
  },
  {
    name: "classification-custom-profile",
    config: {
      entity: "sensor.avg",
      classification: CUSTOM_CLASSIFICATION,
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1" },
        { name: "Room B", short: "RB", entity: "sensor.r2" },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.r1": st("sensor.r1", 17.4, C),
      "sensor.r2": st("sensor.r2", 26.9, C),
    },
  },
  {
    name: "views-explicit-order-without-scale",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: sevenRoomConfig(),
      views: [{ type: "extremes" }, { type: "range" }],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      ...sevenRoomStates(),
    },
  },
  {
    name: "views-solo-scale",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig(), views: ["scale"] },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "views-collapsed-empty-list",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig(), views: [] },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "views-requested-but-unavailable",
    config: { entity: "sensor.avg", views: [{ type: "range_scale" }] },
    states: { "sensor.avg": st("sensor.avg", 22.4, C) },
  },
  {
    name: "view-options-all-toggles",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: sevenRoomConfig(),
      views: [
        { type: "range", options: { show_time: false } },
        { type: "range_scale", options: { show_comfort_band: false, footer: "compact" } },
        { type: "scale", options: { show_optimal_band: false, footer: false, markers: "all" } },
        { type: "extremes", options: { show_value: false } },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      ...sevenRoomStates(),
    },
  },
  {
    name: "view-options-markers-average",
    config: {
      entity: "sensor.avg",
      rooms: sevenRoomConfig(),
      views: [{ type: "scale", options: { markers: "average" } }, { type: "extremes" }],
    },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "rooms-grid-capped",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig(), room_columns: 3, room_rows: 2 },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "rooms-sorted-by-name-full-label",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig(), room_sort: "name", room_label: "name" },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "rooms-hidden-chip-grid",
    config: { entity: "sensor.avg", rooms: sevenRoomConfig(), show_rooms: false },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "presentation-overrides",
    config: {
      entity: "sensor.avg",
      rooms: sevenRoomConfig(),
      title: "Custom title",
      avg_label: "Custom average",
      icon: "mdi:home-thermometer",
      decimals: 0,
      hide_footer: true,
    },
    states: { "sensor.avg": st("sensor.avg", 22.4, C), ...sevenRoomStates() },
  },
  {
    name: "carousel-disabled",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: sevenRoomConfig(),
      auto_slide: false,
      swipe: false,
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      ...sevenRoomStates(),
    },
  },
  {
    name: "carousel-custom-timing",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: sevenRoomConfig(),
      rotation_seconds: 7,
      slide_seconds: 2.5,
      start_view: "extremes",
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      ...sevenRoomStates(),
    },
  },
  {
    name: "actions-per-room-overrides",
    config: {
      entity: "sensor.avg",
      tap_action: { action: "navigate", navigation_path: "/lovelace/climate" },
      hold_action: { action: "none" },
      rooms: [
        { name: "Room A", short: "RA", entity: "sensor.r1", tap_action: { action: "toggle" } },
        { name: "Room B", short: "RB", entity: "sensor.r2", hold_action: { action: "more-info" } },
      ],
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, C),
      "sensor.r1": st("sensor.r1", 21.1, C),
      "sensor.r2": st("sensor.r2", 23.6, C),
    },
  },
  {
    name: "i18n-german-full",
    language: "de",
    config: {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      trend_entity: "sensor.trend",
      rooms: sevenRoomConfig(),
    },
    states: {
      "sensor.avg": st("sensor.avg", 22.4, { ...C, spread: 6.5 }),
      "sensor.range": st("sensor.range", 5.1, RANGE_ATTRS_C),
      "sensor.trend": st("sensor.trend", 0.42, { ...C, unit_of_measurement: "°C/h" }),
      ...sevenRoomStates(),
    },
  },
];

function buildHass(scenario) {
  const language = scenario.language || "en";
  return {
    language,
    locale: { language },
    states: scenario.states,
    callService: () => {},
  };
}

module.exports = { SCENARIOS, buildHass, st, FIXED_TS };

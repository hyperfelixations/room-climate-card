"use strict";

// A translator that echoes its key and vars, so an assertion can see exactly which
// key was used and with which values — far more diagnostic than comparing against
// real German text.
function stubTexts(overrides = {}) {
  return {
    language: "en",
    t: (key, vars) => (vars ? `${key}(${JSON.stringify(vars)})` : key),
    fmt: (value, digits) => `fmt:${value}:${digits ?? "auto"}`,
    fmtWithUnit: (value, digits, withSpace) => `unit:${value}:${digits ?? "auto"}:${withSpace === false ? "nospace" : "space"}`,
    formatTime: (isoString) => (isoString ? `time:${isoString}` : null),
    ...overrides,
  };
}

// Which parts a card draws, as normalizeConfig() resolves them when nobody says otherwise.
// Written out rather than imported so that a change to the defaults shows up here as a
// deliberate edit instead of travelling silently into every presentation test.
const SHOW_EVERYTHING = {
  accent_line: true,
  icon: true,
  title: true,
  subtitle: true,
  entity_label: true,
  pill: true,
  panel: true,
  rooms: "auto",
  unavailable_rooms: true,
};

// A NORMALIZED config, which is what the presentation layer is handed — never raw YAML.
// The `show` block is merged rather than replaced, so a test can name the one part it is
// about (`cfg({ show: { pill: false } })`) without restating the other eight.
function cfg(overrides = {}) {
  const { show, ...rest } = overrides;
  return {
    entity: "sensor.avg",
    rooms: [],
    title: { text: null, overflow: "wrap" },
    subtitle: { text: null, overflow: "clip" },
    entity_label: null,
    icon: null,
    room_label: "auto",
    room_sort: "value_asc",
    room_columns: null,
    room_rows: null,
    views: null,
    ...rest,
    show: { ...SHOW_EVERYTHING, ...show },
  };
}

function minimalDomainModel(overrides = {}) {
  return {
    empty: false,
    // The model resolves this and the view model reads it rather than recomputing —
    // deciding it needs `states`, which the presentation layer does not have. A fixture
    // therefore has to state which sources its card refers to, exactly as the real
    // model would (see resolveSourceTopology()).
    topology: { kind: "primaryOnly", headlineEntity: "sensor.avg", roomIndex: null },
    metric: { kind: "temperature", canonicalUnit: "°C", unit: "°C", displayUnitProfile: { key: "celsius" } },
    context: { diagnostics: [], consistent: true, excludedRoomIds: [], sourceKind: "primary", sourceEntity: "sensor.avg" },
    average: { value: 22, source: "sensor", entity: "sensor.avg", roomIndex: null },
    rooms: { declared: [], byValue: [], count: 0, comparable: false, missing: 0 },
    roomColors: {},
    extremes: null,
    comfort: { min: 20, max: 24, inComfort: 0, tooWarm: 0, tooCool: 0 },
    optimal: { min: 21, max: 23 },
    scaleConfig: {
      comfort: { min: 20, max: 24 },
      optimal: { min: 21, max: 23 },
      scale: { min: 19, max: 25 },
      step: 1,
      oneSided: false,
      headroom: undefined,
      anchorScale: true,
    },
    spread: 0,
    range: { hasRange: false, state: null, min: null, max: null, minTimestamp: null, maxTimestamp: null, minColor: null, maxColor: null, rangeScaleAvailable: false },
    trend: { value: null, unit: null, model: null },
    classification: {
      average: { color: "#79A86C", level: null, levelKey: "level.optimal", score: 6, zone: "optimal", source: "builtin", profileId: "indoor" },
      profileIcon: "mdi:thermometer",
    },
    subtitle: { kind: "inComfort", missingRooms: 0 },
    ...overrides,
  };
}

module.exports = { cfg, minimalDomainModel, stubTexts };

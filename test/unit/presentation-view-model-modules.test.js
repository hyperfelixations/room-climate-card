"use strict";

// Direct unit tests for src/presentation/view-model/*.
//
// This layer is where a reading stops being data and becomes something a person
// reads: a translated title, a formatted number with a unit, a chip label, a CSS
// colour. The tests below check the projection rules themselves — which label a
// chip gets, how the grid splits, which sentence a subtitle branch produces — with
// a stubbed translator, so a failure names the rule rather than a locale.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");

let metricMeta;
let roomLayout;
let scaleViewModel;
let cardViewModel;
let legacyData;
let viewContent;

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

function cfg(overrides = {}) {
  return {
    title: null,
    avg_label: null,
    icon: null,
    room_label: "auto",
    room_sort: "value_asc",
    room_columns: null,
    room_rows: null,
    show_rooms: true,
    views: null,
    ...overrides,
  };
}

function roomModel(index, name, short, value) {
  return { name, short, entity: `sensor.r${index}`, tap_action: null, hold_action: null, index, value };
}

test.before(async () => {
  metricMeta = await import("../../src/presentation/view-model/metric-meta.js");
  roomLayout = await import("../../src/presentation/view-model/room-layout.js");
  scaleViewModel = await import("../../src/presentation/view-model/scale-view-model.js");
  cardViewModel = await import("../../src/presentation/view-model/card-view-model.js");
  legacyData = require("../helpers/legacy-dto.js");
  viewContent = await import("../../src/presentation/view-model/view-content/index.js");
});

// ------------------------------------------------------------ metric meta --

test("every metric kind has complete presentation metadata", () => {
  for (const kind of ["temperature", "humidity", "co2", "pm25"]) {
    const meta = metricMeta.METRIC_META[kind];
    assert.match(meta.titleKey, /^title\./, `${kind}: titleKey`);
    assert.match(meta.icon, /^mdi:/, `${kind}: icon`);
    assert.match(meta.emptyIcon, /^mdi:/, `${kind}: emptyIcon`);
    assert.equal(typeof meta.unitFallback, "string", `${kind}: unitFallback`);
    assert.equal(typeof meta.decimals, "number", `${kind}: decimals`);
    assert.match(meta.lowRoomKey, /^card\./, `${kind}: lowRoomKey`);
    assert.match(meta.highRoomKey, /^card\./, `${kind}: highRoomKey`);
    assert.match(meta.aboveAdjectiveKey, /^adjective\./, `${kind}: aboveAdjectiveKey`);
    assert.match(meta.belowAdjectiveKey, /^adjective\./, `${kind}: belowAdjectiveKey`);
    assert.ok(meta.autoRoomColumns > 0, `${kind}: autoRoomColumns`);
  }
});

test("the unit fallback comes from the metric definition, not a second literal", () => {
  assert.equal(metricMeta.METRIC_META.temperature.unitFallback, "°C");
  assert.equal(metricMeta.METRIC_META.humidity.unitFallback, "%");
  assert.equal(metricMeta.METRIC_META.co2.unitFallback, "ppm");
  assert.equal(metricMeta.METRIC_META.pm25.unitFallback, "µg/m³");
});

test("an unknown metric kind resolves to temperature", () => {
  assert.equal(metricMeta.metricMetaFor("pressure"), metricMeta.METRIC_META.temperature);
  assert.equal(metricMeta.metricMetaFor(null), metricMeta.METRIC_META.temperature);
  assert.equal(metricMeta.autoRoomColumnsFor("pressure"), 7);
  assert.equal(metricMeta.autoRoomColumnsFor("co2"), 5, "the denser metrics fit fewer chips per row");
});

// ------------------------------------------------------------ room layout --

test("room_label picks between the short code and the full name", () => {
  const room = roomModel(0, "Wohnzimmer", "WZ", 22);
  assert.equal(roomLayout.decorateRoomForDisplay(room, "auto").displayLabel, "WZ");
  assert.equal(roomLayout.decorateRoomForDisplay(room, "short").displayLabel, "WZ");
  assert.equal(roomLayout.decorateRoomForDisplay(room, "name").displayLabel, "Wohnzimmer");
});

test("shortGuaranteed reflects the RESOLVED label, not the configured short", () => {
  const twoLetters = roomModel(0, "Wohnzimmer", "WZ", 22);
  assert.equal(roomLayout.decorateRoomForDisplay(twoLetters, "auto").shortGuaranteed, true);
  assert.equal(roomLayout.decorateRoomForDisplay(twoLetters, "name").shortGuaranteed, false, "the full name can ellipsize");
  const threeLetters = roomModel(1, "Wohnzimmer", "WOZ", 22);
  assert.equal(roomLayout.decorateRoomForDisplay(threeLetters, "auto").shortGuaranteed, false);
  const umlaut = roomModel(2, "Küche", "KÜ", 22);
  assert.equal(roomLayout.decorateRoomForDisplay(umlaut, "auto").shortGuaranteed, true);
});

test("all four room sortings behave as documented", () => {
  const rooms = [
    roomModel(0, "Zimmer", "ZI", 23),
    roomModel(1, "Arbeit", "AR", 21),
    roomModel(2, "Bad", "BA", 21),
  ];
  assert.deepEqual(roomLayout.resolveRoomDisplayOrder(rooms, "value_asc", "de").map((r) => r.name), ["Arbeit", "Bad", "Zimmer"]);
  assert.deepEqual(roomLayout.resolveRoomDisplayOrder(rooms, "value_desc", "de").map((r) => r.name), ["Zimmer", "Arbeit", "Bad"]);
  assert.deepEqual(roomLayout.resolveRoomDisplayOrder(rooms, "name", "de").map((r) => r.name), ["Arbeit", "Bad", "Zimmer"]);
  assert.deepEqual(roomLayout.resolveRoomDisplayOrder(rooms, "configured", "de").map((r) => r.name), ["Zimmer", "Arbeit", "Bad"]);
  // An unknown mode falls back to value_asc.
  assert.deepEqual(roomLayout.resolveRoomDisplayOrder(rooms, "bogus", "de").map((r) => r.name), ["Arbeit", "Bad", "Zimmer"]);
});

test("room sorting does not mutate the input list", () => {
  const rooms = [roomModel(0, "B", "B", 23), roomModel(1, "A", "A", 21)];
  const before = rooms.map((r) => r.name);
  roomLayout.resolveRoomDisplayOrder(rooms, "value_asc", "en");
  assert.deepEqual(rooms.map((r) => r.name), before);
});

test("the automatic grid splits evenly, earliest rows first", () => {
  assert.deepEqual(roomLayout.roomGridRows(7, null, null, 7).rowSizes, [{ itemCount: 7, columnCount: 7 }]);
  assert.deepEqual(roomLayout.roomGridRows(9, null, null, 7).rowSizes, [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 4, columnCount: 4 },
  ]);
  assert.deepEqual(roomLayout.roomGridRows(13, null, null, 7).rowSizes, [
    { itemCount: 7, columnCount: 7 },
    { itemCount: 6, columnCount: 6 },
  ]);
  assert.deepEqual(roomLayout.roomGridRows(0, null, null, 7), { rowSizes: [], capacity: 0 });
});

test("a fixed column count keeps every row the same width", () => {
  const grid = roomLayout.roomGridRows(7, 3, null, 7);
  assert.deepEqual(grid.rowSizes, [
    { itemCount: 3, columnCount: 3 },
    { itemCount: 3, columnCount: 3 },
    { itemCount: 1, columnCount: 3 },
  ]);
  assert.equal(grid.capacity, 7, "columns alone never caps");
});

test("columns AND rows together cap the visible chips", () => {
  const grid = roomLayout.roomGridRows(7, 3, 2, 7);
  assert.equal(grid.capacity, 6);
  assert.deepEqual(grid.rowSizes, [
    { itemCount: 3, columnCount: 3 },
    { itemCount: 3, columnCount: 3 },
  ]);
});

test("an over-large row count never produces empty rows", () => {
  assert.deepEqual(roomLayout.roomGridRows(2, null, 5, 7).rowSizes, [
    { itemCount: 1, columnCount: 1 },
    { itemCount: 1, columnCount: 1 },
  ]);
  assert.deepEqual(roomLayout.roomGridRows(2, 3, 5, 7).rowSizes, [{ itemCount: 2, columnCount: 3 }]);
});

test("the cap applies in declaration order, before the display sort", () => {
  // Capping after a value sort would make the visible set drift as values change.
  const declared = [
    roomModel(0, "First", "F1", 30),
    roomModel(1, "Second", "S2", 10),
    roomModel(2, "Third", "T3", 20),
  ];
  const layout = roomLayout.buildRoomLayout({
    declaredRooms: declared,
    config: cfg({ room_columns: 2, room_rows: 1, room_sort: "value_asc" }),
    metricKind: "temperature",
    language: "en",
  });
  assert.deepEqual(layout.visible.map((r) => r.name), ["Second", "First"], "the first two DECLARED rooms, then value-sorted");
});

// ------------------------------------------------------ scale view model --

const AXIS_CONFIG = {
  comfort: { min: 20, max: 24 },
  optimal: { min: 21, max: 23 },
  scale: { min: 19, max: 25 },
  step: 1,
  oneSided: false,
  headroom: undefined,
  anchorScale: true,
};

test("the axis is built here, from the policy plus the values it has to cover", () => {
  const axis = scaleViewModel.buildScaleAxis({
    scaleConfig: AXIS_CONFIG,
    displayUnitProfile: null,
    comfort: AXIS_CONFIG.comfort,
    optimal: AXIS_CONFIG.optimal,
    low: 20,
    high: 23,
    markers: { avg: 22 },
    formatBoundary: (value) => `label:${value}`,
  });
  assert.equal(axis.scaleMin, 19, "the anchored reference scale wins when the data fits inside it");
  assert.equal(axis.scaleMax, 25);
  assert.equal(axis.displayStep, 1);
  assert.deepEqual(axis.boundaryLabels, { min: "label:19", max: "label:25" });
  assert.ok(Math.abs(axis.markerPositions.avg - 50) < 1e-9, "22 sits halfway between 19 and 25");
  // The band rectangles are percentages of the rendered bar, not values.
  assert.ok(Math.abs(axis.comfortLeft - ((20 - 19) / 6) * 100) < 1e-9);
  assert.ok(Math.abs(axis.optimalCenter - ((22 - 19) / 6) * 100) < 1e-9);
});

test("the axis grows to cover a value outside the reference scale", () => {
  const axis = scaleViewModel.buildScaleAxis({
    scaleConfig: AXIS_CONFIG,
    displayUnitProfile: null,
    comfort: AXIS_CONFIG.comfort,
    optimal: AXIS_CONFIG.optimal,
    low: 20,
    high: 40,
    markers: { avg: 40 },
    formatBoundary: (value) => `${value}`,
  });
  assert.ok(axis.scaleMax >= 40, `axis max ${axis.scaleMax} must cover the value`);
  assert.ok(axis.markerPositions.avg <= 100);
  assert.ok(axis.markerPositions.avg > 0, "the marker must not be clamped to an edge");
});

test("two markers closer than the overlap threshold are nudged apart, not repositioned", () => {
  assert.deepEqual(scaleViewModel.resolveMarkerNudge(50, 50), { first: -4, second: 4 });
  assert.deepEqual(scaleViewModel.resolveMarkerNudge(50, 51.4), { first: -4, second: 4 }, "1.4 pct apart still merges visually");
  assert.deepEqual(scaleViewModel.resolveMarkerNudge(50, 51.6), { first: 0, second: 0 }, "exactly at the threshold is far enough");
  assert.deepEqual(scaleViewModel.resolveMarkerNudge(80, 20), { first: 0, second: 0 });
  // Symmetric: the order of the two arguments only decides which gets the negative
  // offset.
  assert.deepEqual(scaleViewModel.resolveMarkerNudge(51.4, 50), { first: -4, second: 4 });
});

// ------------------------------------------------------- card view model --

function minimalDomainModel(overrides = {}) {
  return {
    empty: false,
    metric: { kind: "temperature", canonicalUnit: "°C", unit: "°C", displayUnitProfile: { key: "celsius" } },
    context: { diagnostics: [], consistent: true, excludedRoomIds: [], sourceKind: "primary", sourceEntity: "sensor.avg" },
    average: { value: 22, source: "sensor", entity: "sensor.avg" },
    rooms: { declared: [], byValue: [], count: 0, hasRoomsView: false, missing: 0 },
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

test("the title and average label prefer the configured overrides", () => {
  const texts = stubTexts();
  const fromKeys = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts });
  assert.equal(fromKeys.title, "title.temperature");
  assert.equal(fromKeys.average.label, "avg.label");

  const overridden = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel(),
    config: cfg({ title: "My title", avg_label: "My label" }),
    texts,
  });
  assert.equal(overridden.title, "My title");
  assert.equal(overridden.average.label, "My label");
});

test("a built-in level is translated, a custom or entity level is not", () => {
  const texts = stubTexts();
  const builtin = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts });
  assert.equal(builtin.tone.label, "level.optimal");

  const custom = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel({
      classification: {
        average: { color: "#cc4444", level: "Custom warm", levelKey: undefined, score: 2, zone: "outside", source: "custom", profileId: "custom" },
        profileIcon: null,
      },
    }),
    config: cfg(),
    texts,
  });
  assert.equal(custom.tone.label, "Custom warm");
});

test("the icon precedence is config, then profile, then metric default", () => {
  const texts = stubTexts();
  const fromProfile = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts });
  assert.equal(fromProfile.tone.icon, "mdi:thermometer");

  const fromConfig = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg({ icon: "mdi:custom" }), texts });
  assert.equal(fromConfig.tone.icon, "mdi:custom");

  const fromMetric = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel({
      classification: { average: minimalDomainModel().classification.average, profileIcon: null },
    }),
    config: cfg(),
    texts,
  });
  assert.equal(fromMetric.tone.icon, "mdi:thermometer", "the metric's stable default");
});

test("the soft tone colour is derived here, not in the domain", () => {
  const result = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts: stubTexts() });
  assert.equal(result.tone.color, "#79A86C", "the validated profile colour comes from the domain unchanged");
  assert.equal(result.tone.soft, "rgba(121,168,108,0.2)", "the CSS-ready variant is a presentation derivation");
});

test("every subtitle branch produces its own key and variables", () => {
  const texts = stubTexts();
  const build = (subtitle) =>
    cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel({ subtitle }), config: cfg(), texts }).subtitle;

  assert.match(build({ kind: "aboveComfort", diff: 1, count: 2, total: 4, adjective: "above", missingRooms: 0 }), /^subtitle\.aboveComfort\(/);
  assert.match(build({ kind: "aboveComfort", diff: 1, count: 2, total: 4, adjective: "above", missingRooms: 0 }), /adjective\.warm/);
  assert.match(build({ kind: "aboveComfortNoRooms", diff: 1, missingRooms: 0 }), /^subtitle\.aboveComfortNoRooms\(/);
  assert.match(build({ kind: "belowComfort", diff: 1, count: 1, total: 4, adjective: "below", missingRooms: 0 }), /adjective\.cool/);
  assert.match(build({ kind: "belowComfortNoRooms", diff: 1, missingRooms: 0 }), /^subtitle\.belowComfortNoRooms\(/);
  assert.match(build({ kind: "inComfortIssue", name: "Küche", missingRooms: 0 }), /^subtitle\.inComfortIssue\(.*Küche/);
  assert.equal(build({ kind: "inComfortAllGood", missingRooms: 0 }), "subtitle.inComfortAllGood");
  assert.equal(build({ kind: "inComfort", missingRooms: 0 }), "subtitle.inComfort");
});

test("missing rooms are appended as their own clause", () => {
  const result = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel({ subtitle: { kind: "inComfort", missingRooms: 2 } }),
    config: cfg(),
    texts: stubTexts(),
  });
  assert.equal(result.subtitle, 'subtitle.inComfortsubtitle.missingRooms({"count":2})');
});

test("the metric-specific adjective is used, not a generic one", () => {
  const texts = stubTexts();
  const humidity = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel({
      metric: { kind: "humidity", canonicalUnit: "%", unit: "%", displayUnitProfile: { key: "percent" } },
      subtitle: { kind: "aboveComfort", diff: 5, count: 1, total: 3, adjective: "above", missingRooms: 0 },
    }),
    config: cfg(),
    texts,
  });
  assert.match(humidity.subtitle, /adjective\.humid/);
});

// A domain model with two comparable rooms. hasRoomsView, byValue, roomColors and
// extremes are set together on purpose: the real domain model guarantees they agree,
// and a fixture that separates them would exercise a state the pipeline cannot
// produce.
function withTwoRooms(overrides = {}) {
  const cool = roomModel(0, "A", "AA", 21);
  const warm = roomModel(1, "B", "BB", 23);
  return minimalDomainModel({
    rooms: { declared: [cool, warm], byValue: [cool, warm], count: 2, hasRoomsView: true, missing: 0 },
    roomColors: { 0: "#4488cc", 1: "#cc4444" },
    extremes: { coolest: cool, warmest: warm, coolestColor: "#4488cc", warmestColor: "#cc4444" },
    ...overrides,
  });
}

test("show_rooms hides the chips without touching anything else", () => {
  const domainModel = withTwoRooms();
  const shown = cardViewModel.buildCardViewModel({ domainModel, config: cfg(), texts: stubTexts() });
  const hidden = cardViewModel.buildCardViewModel({ domainModel, config: cfg({ show_rooms: false }), texts: stubTexts() });
  assert.equal(shown.rooms.showChips, true);
  assert.equal(hidden.rooms.showChips, false);
  assert.equal(hidden.rooms.count, 2, "the rooms remain full data sources");
  assert.deepEqual(hidden.rooms.visible.map((r) => r.name), shown.rooms.visible.map((r) => r.name));
  // The chips exist either way; showChips only decides whether they are drawn.
  assert.equal(hidden.rooms.chips.length, 2);
  assert.deepEqual(hidden.roomMarkers.map((m) => m.index), shown.roomMarkers.map((m) => m.index));
});

test("a chip carries every string and custom property its renderer needs", () => {
  const result = cardViewModel.buildCardViewModel({ domainModel: withTwoRooms(), config: cfg(), texts: stubTexts() });
  const [cool, warm] = result.rooms.chips;

  assert.equal(cool.room, result.rooms.visible[0], "the room object is carried by identity");
  assert.equal(cool.displayLabel, "AA");
  assert.equal(cool.color, "#4488cc");
  assert.equal(cool.valueText, "fmt:21:auto");
  assert.equal(cool.unitText, "°C");
  assert.equal(cool.title, "A: unit:21:auto:space");
  assert.equal(cool.ariaLabel, 'room.ariaOpen({"name":"A"})');
  // 21 is below the comfort band's 20? No — inside it, so the chip keeps the theme
  // surface and gets the neutral mark.
  assert.equal(cool.mark, "•");
  assert.equal(cool.out, false);
  assert.equal(cool.background, "var(--rtc-chip-bg)");
  assert.equal(cool.border, "var(--rtc-hairline)");
  assert.equal(cool.markBackground, "rgba(68,136,204,0.18)");
  assert.equal(warm.mark, "•");
});

test("a chip outside the comfort band is tinted and marked with its direction", () => {
  const domainModel = withTwoRooms({ comfort: { min: 22, max: 24, inComfort: 1, tooWarm: 0, tooCool: 1 } });
  const result = cardViewModel.buildCardViewModel({ domainModel, config: cfg(), texts: stubTexts() });
  const [cool, warm] = result.rooms.chips;
  assert.equal(cool.mark, "↓", "21 is below a 22–24 band");
  assert.equal(cool.out, true);
  assert.equal(cool.background, "rgba(68,136,204,0.1)");
  assert.equal(cool.border, "rgba(68,136,204,0.36)");
  assert.equal(warm.mark, "•", "23 is inside it");
  assert.equal(warm.out, false);
});

test("the chips are grouped into the rows the grid resolved", () => {
  const result = cardViewModel.buildCardViewModel({
    domainModel: withTwoRooms(),
    config: cfg({ room_columns: 1 }),
    texts: stubTexts(),
  });
  assert.deepEqual(result.rooms.rowSizes, [{ itemCount: 1, columnCount: 1 }, { itemCount: 1, columnCount: 1 }]);
  assert.deepEqual(
    result.rooms.chipRows.map((row) => [row.columnCount, row.chips.map((chip) => chip.displayLabel)]),
    [[1, ["AA"]], [1, ["BB"]]]
  );
});

test("range timestamps are formatted here, from the raw values", () => {
  const result = cardViewModel.buildCardViewModel({
    domainModel: minimalDomainModel({
      range: { hasRange: true, state: 5, min: 18, max: 25, minTimestamp: "2026-07-24T06:12:00Z", maxTimestamp: null, minColor: "#111111", maxColor: "#222222", rangeScaleAvailable: true },
    }),
    config: cfg(),
    texts: stubTexts(),
  });
  assert.equal(result.range.minTime, "time:2026-07-24T06:12:00Z");
  assert.equal(result.range.maxTime, null);
});

test("the empty view model carries the five data fields plus its own render model", () => {
  const result = cardViewModel.buildCardViewModel({
    domainModel: { empty: true, metric: { kind: "co2" }, missingRooms: 2, configurationState: "mixed_metric_kinds" },
    config: cfg({ rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }),
    texts: stubTexts(),
  });
  assert.deepEqual(Object.keys(result).sort(), ["configurationState", "empty", "emptyState", "metric", "missingRooms", "title"]);
  assert.equal(result.title, "title.co2");
  // The empty state is renderer-ready too: an icon, a title and one finished hint
  // sentence, with nothing left for the renderer to translate.
  assert.deepEqual(result.emptyState, {
    icon: "mdi:molecule-co2",
    title: "title.co2",
    subtitle: 'empty.title empty.hintMissingRooms({"count":2})',
  });
});

test("the empty hint distinguishes no rooms configured from rooms reporting nothing", () => {
  const build = (config, missingRooms) =>
    cardViewModel.buildCardViewModel({
      domainModel: { empty: true, metric: { kind: "temperature" }, missingRooms, configurationState: null },
      config,
      texts: stubTexts(),
    }).emptyState.subtitle;

  assert.match(build(cfg({ rooms: [] }), 0), /empty\.hintNoRooms/);
  assert.match(build(cfg({ rooms: [{ entity: "sensor.r1" }] }), 1), /empty\.hintMissingRooms/);
  assert.match(build(cfg({ rooms: [{ entity: "sensor.r1" }] }), 0), /empty\.hintNoRoomData/);
});

// ---------------------------------------------------------- legacy adapter --

test("the legacy adapter flattens the scale model to the top level", () => {
  const viewModel = cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts: stubTexts() });
  const data = legacyData.toLegacyData(viewModel);
  assert.equal(data.scaleMin, 19);
  assert.equal(data.scaleMax, 25);
  assert.equal(data.displayStep, 1);
  assert.deepEqual(data.boundaryLabels, { min: "unit:19:0:nospace", max: "unit:25:0:nospace" });
  assert.equal(data.avgPos, 50);
});

test("the legacy adapter substitutes the documented defaults with no extremes", () => {
  const data = legacyData.toLegacyData(
    cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts: stubTexts() })
  );
  assert.equal(data.coolest, null);
  assert.equal(data.warmest, null);
  assert.equal(data.coolestPos, 0);
  assert.equal(data.warmestPos, 0);
  assert.equal(data.coolestShift, 0);
  assert.equal(data.warmestShift, 0);
  assert.equal(data.coolestColor, null);
  assert.equal(data.warmestColor, null);
});

test("the legacy adapter zeroes the range-scale positions when that view is off", () => {
  const data = legacyData.toLegacyData(
    cardViewModel.buildCardViewModel({ domainModel: minimalDomainModel(), config: cfg(), texts: stubTexts() })
  );
  assert.equal(data.rangeScaleGeometry, null);
  assert.equal(data.rangeCurrentPos, 0);
  assert.equal(data.rangeMinPos, 0);
  assert.equal(data.rangeMaxPos, 0);
});

// ------------------------------------------------- lazy view content models --

// The daily-range scale is AVAILABLE whenever the range entity reports a usable
// min/max pair, but it is off unless a views: list explicitly asks for it. Building its
// axis, its three markers and its decluttered labels for a view nobody requested is
// work with no observable result — and, before this round, work the pipeline did on
// every single update of every card with a range entity.
//
// The axis therefore arrives as a thunk. These tests call buildViewContent() directly
// with a counting thunk, which is the only way to prove a negative like this.
function sharedFor(overrides = {}) {
  const texts = stubTexts();
  const geometry = {
    scaleMin: 19, scaleMax: 25, comfortLeft: 0, comfortWidth: 100, comfortVisible: true, comfortCenter: 50,
    optimalLeft: 25, optimalWidth: 50, optimalVisible: true, optimalCenter: 50, optimalMin: 21, optimalMax: 23,
    displayStep: 1, markerPositions: { avg: 50, current: 50, min: 10, max: 90 },
    boundaryLabels: { min: "19", max: "25" },
  };
  return {
    metricKind: "temperature",
    unit: "°C",
    texts,
    comfort: { min: 20, max: 24, inComfort: 1, tooWarm: 0, tooCool: 1 },
    optimal: { min: 21, max: 23 },
    spread: 2,
    hideFooter: false,
    rangeEntity: "sensor.range",
    average: { value: 22, label: "Average", position: 50, color: "#79A86C" },
    rooms: { hasRoomsView: true, count: 2, byValue: [] },
    roomColors: {},
    extremes: null,
    roomMarkers: [],
    range: { hasRange: true, state: 5, min: 18, max: 25, minTime: "06:10", maxTime: "15:20", minColor: "#1", maxColor: "#2" },
    trend: { value: null, unit: null, model: null, text: "" },
    scale: geometry,
    geometry,
    ...overrides,
  };
}

function stateWith(keys) {
  return {
    keys,
    entries: [],
    collapsed: keys.length === 0,
    hasRangeScale: keys.includes("range_scale"),
    options: {
      range: { show_time: true },
      range_scale: { show_comfort_band: true, show_optimal_band: true, footer: "detailed" },
      scale: { show_comfort_band: true, show_optimal_band: true, footer: true, markers: "extremes" },
      extremes: { show_value: true },
    },
  };
}

test("an available but not activated range-scale view builds no geometry at all", () => {
  let axisBuilds = 0;
  const shared = sharedFor({
    buildRangeScaleAxis: () => {
      axisBuilds += 1;
      return sharedFor().geometry;
    },
  });
  const byKey = viewContent.buildViewContent({ shared, viewState: stateWith(["scale"]) });
  assert.equal(axisBuilds, 0, "the axis builder must not be called for an inactive view");
  assert.equal(byKey.range_scale, null);
  assert.ok(byKey.scale, "the active view is still built");
});

test("an activated range-scale view builds its geometry exactly once", () => {
  let axisBuilds = 0;
  const shared = sharedFor({
    buildRangeScaleAxis: () => {
      axisBuilds += 1;
      return sharedFor().geometry;
    },
  });
  const byKey = viewContent.buildViewContent({ shared, viewState: stateWith(["range_scale", "scale"]) });
  assert.equal(axisBuilds, 1, "once, not once per marker or per label");
  assert.ok(byKey.range_scale);
  assert.equal(byKey.range_scale.markers.min.position, 10);
  assert.equal(byKey.range_scale.topLabels.current.position, 50);
});

test("every inactive view gets a null content model, and the key set is complete", () => {
  const byKey = viewContent.buildViewContent({ shared: sharedFor({ buildRangeScaleAxis: () => sharedFor().geometry }), viewState: stateWith([]) });
  assert.deepEqual(Object.keys(byKey).sort(), ["extremes", "range", "range_scale", "scale"]);
  assert.deepEqual(Object.values(byKey), [null, null, null, null]);
});

test("the whole view model omits the range-scale geometry when the view is off, even when the data allows it", () => {
  const available = minimalDomainModel({
    range: { hasRange: true, state: 5, min: 18, max: 25, minTimestamp: null, maxTimestamp: null, minColor: "#1", maxColor: "#2", rangeScaleAvailable: true },
  });
  const off = cardViewModel.buildCardViewModel({ domainModel: available, config: cfg(), texts: stubTexts() });
  assert.equal(off.rangeScale, null, "available is not the same as requested");
  assert.equal(off.views.byKey.range_scale, null);

  const on = cardViewModel.buildCardViewModel({
    domainModel: available,
    config: cfg({ views: [{ type: "range_scale", enabled: true, options: {} }] }),
    texts: stubTexts(),
  });
  assert.ok(on.rangeScale, "and requested is what builds it");
  assert.ok(on.views.byKey.range_scale.markers.min);
});

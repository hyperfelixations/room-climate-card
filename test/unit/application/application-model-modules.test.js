"use strict";

// Direct unit tests for auxiliary range/trend models and room aggregates.
//
// This is where the card decides what a number MEANS: which entity is allowed to
// determine the metric kind, which rooms may be averaged, whether a reading is a
// measurement at all, and what the resulting sentence should say. Tests exercise
// those decisions at their pure-function owners.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { TEMPERATURE_C, TEMPERATURE_F } = require("../../fixtures/attributes.js");

let auxiliary;
let aggregates;

const C = TEMPERATURE_C;
const F = TEMPERATURE_F;

const AUTO_POLICY = { source: "auto", profile: null, custom: null };
// The card's own ramp, so these models stay comparable to the colours everywhere else.
let PASTEL;

function st(state, attributes) {
  return { state: String(state), attributes: attributes || {} };
}

// A normalized-config stand-in: only the fields the pipeline reads, so a test does
// not have to run the whole normalizer to exercise one decision.
function cfg(overrides = {}) {
  return {
    entity: "sensor.avg",
    rooms: [],
    range_entity: null,
    trend_entity: null,
    classification: AUTO_POLICY,
    room_columns: null,
    room_rows: null,
    room_sort: "value_asc",
    room_label: "auto",
    show_rooms: "auto",
    views: null,
    title: null,
    entity_label: null,
    icon: null,
    decimals: null,
    ...overrides,
  };
}

test.before(async () => {
  auxiliary = await import("../../../src/application/model/auxiliary-models.js");
  aggregates = await import("../../../src/application/model/aggregates.js");
  ({ pastel: PASTEL } = await import("../../../src/domain/classification/palettes/pastel.js"));
});

// ------------------------------------------------------ auxiliary models --

test("the range state is a DELTA and its min/max are ABSOLUTE", () => {
  const states = {
    "sensor.range": st(8.1, { ...F, minimum: 64.4, maximum: 77.9 }),
  };
  const identity = (v) => v;
  const range = auxiliary.buildRangeModel({
    states,
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    palette: PASTEL,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: identity,
    toDisplayDelta: identity,
  });
  // 8.1 °F width is 4.5 °C — a delta, so no +32 offset.
  assert.ok(Math.abs(range.state - (8.1 * 5) / 9) < 1e-9, `state ${range.state}`);
  // 64.4 °F is 18 °C — an absolute, so the offset applies.
  assert.ok(Math.abs(range.min - 18) < 1e-9, `min ${range.min}`);
  assert.ok(Math.abs(range.max - 25.5) < 1e-9, `max ${range.max}`);
  assert.equal(range.hasRange, true);
  assert.equal(range.rangeScaleAvailable, true);
});

test("a negative range width is invalid, and takes min/max down with it", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(-1, { ...C, minimum: 18, maximum: 25 }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    palette: PASTEL,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.hasRange, false);
  assert.equal(range.min, null);
  assert.equal(range.max, null);
  assert.equal(range.rangeScaleAvailable, false);
});

test("an inverted min/max pair blocks the range-scale view but not the range view", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 25, maximum: 18 }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    palette: PASTEL,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.hasRange, true);
  assert.equal(range.rangeScaleAvailable, false);
});

test("a range entity with an unusable unit contributes nothing", () => {
  for (const attributes of [{ minimum: 18, maximum: 25 }, { unit_of_measurement: "hPa", minimum: 18, maximum: 25 }]) {
    const range = auxiliary.buildRangeModel({
      states: { "sensor.range": st(5, attributes) },
      config: cfg({ range_entity: "sensor.range" }),
      policy: AUTO_POLICY,
      metricKind: "temperature",
      displayUnitProfile: null,
      toDisplay: (v) => v,
      toDisplayDelta: (v) => v,
    });
    assert.equal(range.hasRange, false, JSON.stringify(attributes));
    assert.equal(range.state, null);
  }
});

test("range timestamps are returned raw, not formatted", () => {
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 18, maximum: 25, minimum_zeitpunkt: "2026-07-24T06:12:00Z" }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    palette: PASTEL,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.equal(range.minTimestamp, "2026-07-24T06:12:00Z");
  assert.equal(range.maxTimestamp, null, "a missing timestamp is null, not undefined");
});

test("historical range extremes classify numerically, never from the entity's colour", () => {
  // range_entity carries a live value_color; min/max must ignore it.
  const range = auxiliary.buildRangeModel({
    states: { "sensor.range": st(5, { ...C, minimum: 18, maximum: 25, value_color: "#ff0000", value_level: "Live" }) },
    config: cfg({ range_entity: "sensor.range" }),
    policy: AUTO_POLICY,
    palette: PASTEL,
    metricKind: "temperature",
    displayUnitProfile: null,
    toDisplay: (v) => v,
    toDisplayDelta: (v) => v,
  });
  assert.notEqual(range.minColor, "#ff0000");
  assert.notEqual(range.maxColor, "#ff0000");
  assert.notEqual(range.minColor, range.maxColor, "18 °C and 25 °C are different tiers");
});

test("the trend is a RATE and keeps its own deadband", () => {
  const identity = (v) => v;
  const build = (value, attributes) =>
    auxiliary.buildTrendContext({
      states: { "sensor.trend": st(value, attributes) },
      config: cfg({ trend_entity: "sensor.trend" }),
      metricKind: "temperature",
      unit: "°C",
      toDisplayDelta: identity,
    });
  assert.equal(build(0.4, { unit_of_measurement: "°C/h" }).model.direction, "rising");
  assert.equal(build(-0.4, { unit_of_measurement: "°C/h" }).model.direction, "falling");
  assert.equal(build(0.05, { unit_of_measurement: "°C/h" }).model.direction, "stable");
  // 1.8 °F/h is exactly 1 °C/h — a rate, so no offset.
  const fahrenheit = build(1.8, { unit_of_measurement: "°F/h" });
  assert.ok(Math.abs(fahrenheit.model.canonicalValue - 1) < 1e-9, `got ${fahrenheit.model.canonicalValue}`);
  assert.equal(fahrenheit.unit, "°C/h", "labelled in the display unit the number was converted to");
});

test("a trend entity that reports nothing usable yields a null model", () => {
  const identity = (v) => v;
  const none = auxiliary.buildTrendContext({ states: {}, config: cfg(), metricKind: "temperature", unit: "°C", toDisplayDelta: identity });
  assert.equal(none.model, null);
  assert.equal(none.value, null);
  assert.equal(none.unit, null, "no configured entity means no unit label either");

  const unusable = auxiliary.buildTrendContext({
    states: { "sensor.trend": st(0.4, { unit_of_measurement: "hPa/h" }) },
    config: cfg({ trend_entity: "sensor.trend" }),
    metricKind: "temperature",
    unit: "°C",
    toDisplayDelta: identity,
  });
  assert.equal(unusable.model, null);
  assert.equal(unusable.unit, "°C/h", "the label exists because the entity is configured");
});

test("buildTrendModel() rejects a non-finite value and a missing unit", () => {
  assert.equal(auxiliary.buildTrendModel("temperature", 0.5, NaN, "°C/h"), null);
  assert.equal(auxiliary.buildTrendModel("temperature", 0.5, 0.5, null), null);
  assert.equal(auxiliary.buildTrendModel("pressure", 0.5, 0.5, "hPa/h"), null, "an unregistered kind has no policy");
});

test("negative zero is carried through as a stable trend", () => {
  const model = auxiliary.buildTrendModel("temperature", -0, -0, "°C/h");
  assert.equal(model.direction, "stable");
  assert.ok(Object.is(model.value, -0), "the value keeps its sign; only the rendered text normalizes it");
});

// -------------------------------------------------------------- aggregates --

test("room model construction tolerates an omitted list and excludes non-participating declarations", () => {
  const context = { participatingRooms: [] };
  assert.deepEqual(aggregates.buildRoomModels({ config: {}, context, toDisplay: (value) => value }), []);
  assert.deepEqual(
    aggregates.buildRoomModels({
      config: { rooms: [{ entity: "sensor.absent", name: "Absent" }] },
      context,
      toDisplay: (value) => value,
    }),
    [],
  );
});

test("room model construction preserves declared ownership, order, actions and display conversion", () => {
  const config = {
    rooms: [
      {
        entity: "sensor.kitchen",
        name: "Kitchen",
        short: "KI",
        tap_action: { action: "navigate", navigation_path: "/kitchen" },
        hold_action: { action: "none" },
      },
      { entity: "sensor.excluded", name: "Excluded", short: "EX" },
      {
        entity: "sensor.bedroom",
        name: "Bedroom",
        short: "BE",
        tap_action: { action: "more-info" },
        hold_action: null,
      },
    ],
  };
  const context = {
    participatingRooms: [
      { entityId: "sensor.bedroom", canonicalValue: 20 },
      { entityId: "sensor.kitchen", canonicalValue: 10 },
    ],
  };
  const converted = [];

  const models = aggregates.buildRoomModels({
    config,
    context,
    toDisplay(value) {
      converted.push(value);
      return value + 32;
    },
  });

  assert.deepEqual(converted, [10, 20], "conversion follows YAML declaration order, not context order");
  assert.deepEqual(models, [
    {
      name: "Kitchen",
      short: "KI",
      entity: "sensor.kitchen",
      tap_action: { action: "navigate", navigation_path: "/kitchen" },
      hold_action: { action: "none" },
      index: 0,
      value: 42,
    },
    {
      name: "Bedroom",
      short: "BE",
      entity: "sensor.bedroom",
      tap_action: { action: "more-info" },
      hold_action: null,
      index: 2,
      value: 52,
    },
  ]);
});

test("comfort counting splits rooms into inside, too warm and too cool", () => {
  const rooms = [{ value: 18 }, { value: 20 }, { value: 22 }, { value: 24 }, { value: 26 }];
  assert.deepEqual(aggregates.computeComfortCounts(rooms, { min: 20, max: 24 }, true), {
    inComfort: 3,
    tooWarm: 1,
    tooCool: 1,
  });
  assert.deepEqual(aggregates.computeComfortCounts(rooms, { min: 20, max: 24 }, false), {
    inComfort: 0,
    tooWarm: 0,
    tooCool: 0,
  });
});

test("the spread prefers a valid sensor attribute and falls back otherwise", () => {
  const coolest = { value: 19 };
  const warmest = { value: 25 };
  assert.equal(aggregates.computeSpread({ attributeValue: 6.5, roomsComparable: true, coolest, warmest }), 6.5);
  assert.equal(aggregates.computeSpread({ attributeValue: null, roomsComparable: true, coolest, warmest }), 6);
  assert.equal(aggregates.computeSpread({ attributeValue: -1, roomsComparable: true, coolest, warmest }), 6, "a negative spread is impossible");
  assert.equal(aggregates.computeSpread({ attributeValue: 0, roomsComparable: true, coolest, warmest }), 0, "zero is a valid spread");
  assert.equal(aggregates.computeSpread({ attributeValue: null, roomsComparable: false, coolest: null, warmest: null }), 0);
});

test("the value sort breaks ties by name, deterministically", () => {
  const rooms = [
    { name: "Zimmer", value: 21 },
    { name: "Arbeit", value: 21 },
    { name: "Bad", value: 19 },
  ];
  assert.deepEqual(aggregates.sortRoomsByValue(rooms, "de").map((r) => r.name), ["Bad", "Arbeit", "Zimmer"]);
  assert.deepEqual(aggregates.sortRoomsByValue(rooms, "de"), aggregates.sortRoomsByValue(rooms, "de"));
});

test("every subtitle branch is reachable and carries its own numbers", () => {
  const comfort = { min: 20, max: 24 };
  const coolest = { name: "Bad", value: 18 };
  const warmest = { name: "Küche", value: 26 };
  const counts = { inComfort: 1, tooWarm: 1, tooCool: 1 };

  const above = aggregates.buildSubtitleModel({ avg: 25, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(above.kind, "aboveComfort");
  assert.equal(above.diff, 1);
  assert.equal(above.count, 1);
  assert.equal(above.total, 3);
  assert.equal(above.adjective, "above");

  const aboveNoRooms = aggregates.buildSubtitleModel({ avg: 25, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(aboveNoRooms.kind, "aboveComfortNoRooms");
  assert.equal(aboveNoRooms.diff, 1);

  const below = aggregates.buildSubtitleModel({ avg: 19, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(below.kind, "belowComfort");
  assert.equal(below.diff, 1);
  assert.equal(below.adjective, "below");

  const belowNoRooms = aggregates.buildSubtitleModel({ avg: 19, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(belowNoRooms.kind, "belowComfortNoRooms");
  assert.equal(belowNoRooms.diff, 1);

  for (const avg of [comfort.min, comfort.max]) {
    const boundary = aggregates.buildSubtitleModel({
      avg,
      comfort,
      roomsComparable: false,
      counts: { inComfort: 0, tooWarm: 0, tooCool: 0 },
      roomCount: 0,
      coolest: null,
      warmest: null,
      missingRooms: 0,
    });
    assert.equal(boundary.kind, "inComfort", `${avg} belongs to the inclusive comfort band`);
  }

  const issue = aggregates.buildSubtitleModel({ avg: 22, comfort, roomsComparable: true, counts, roomCount: 3, coolest, warmest, missingRooms: 0 });
  assert.equal(issue.kind, "inComfortIssue");
  assert.equal(issue.name, "Küche", "26 is 4 away from 22, 18 is 4 away — the warmest wins the tie");

  const allGood = aggregates.buildSubtitleModel({
    avg: 22, comfort, roomsComparable: true,
    counts: { inComfort: 3, tooWarm: 0, tooCool: 0 },
    roomCount: 3, coolest: { name: "A", value: 21 }, warmest: { name: "B", value: 23 }, missingRooms: 0,
  });
  assert.equal(allGood.kind, "inComfortAllGood");

  const plain = aggregates.buildSubtitleModel({ avg: 22, comfort, roomsComparable: false, counts, roomCount: 0, coolest: null, warmest: null, missingRooms: 0 });
  assert.equal(plain.kind, "inComfort");
});

test("the out-of-comfort room furthest from the average is the one named", () => {
  const comfort = { min: 20, max: 24 };
  const counts = { inComfort: 1, tooWarm: 1, tooCool: 1 };
  const base = { avg: 22, comfort, roomsComparable: true, counts, roomCount: 3, missingRooms: 0 };
  // Only the warmest is out.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 21 }, warmest: { name: "Warm", value: 30 } }).name,
    "Warm"
  );
  // Only the coolest is out.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 10 }, warmest: { name: "Warm", value: 23 } }).name,
    "Cool"
  );
  // Both are out; the further one wins.
  assert.equal(
    aggregates.buildSubtitleModel({ ...base, coolest: { name: "Cool", value: 5 }, warmest: { name: "Warm", value: 25 } }).name,
    "Cool"
  );
  // An endpoint exactly on the comfort boundary is not an issue. These asymmetric
  // distances distinguish the one genuinely outlying endpoint from a boundary value.
  assert.equal(
    aggregates.buildSubtitleModel({
      ...base,
      avg: 20,
      coolest: { name: "Cool", value: 19 },
      warmest: { name: "Boundary warm", value: 24 },
    }).name,
    "Cool",
  );
  assert.equal(
    aggregates.buildSubtitleModel({
      ...base,
      avg: 24,
      coolest: { name: "Boundary cool", value: 20 },
      warmest: { name: "Warm", value: 25 },
    }).name,
    "Warm",
  );
});

test("missing rooms are reported alongside whichever sentence applies", () => {
  const model = aggregates.buildSubtitleModel({
    avg: 22, comfort: { min: 20, max: 24 }, roomsComparable: false,
    counts: { inComfort: 0, tooWarm: 0, tooCool: 0 }, roomCount: 0, coolest: null, warmest: null, missingRooms: 3,
  });
  assert.equal(model.kind, "inComfort");
  assert.equal(model.missingRooms, 3);
});

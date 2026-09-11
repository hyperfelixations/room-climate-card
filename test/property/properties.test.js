"use strict";

// Tests the property predicates themselves with deliberately broken synthetic models.
// A property runner is only useful if its oracle can fail, and these cases cover the two
// structural blind spots that randomized cards cannot reliably construct on demand.
// No product module is imported: this file verifies the independent test oracle.

const test = require("node:test");
const assert = require("node:assert/strict");

const { MODEL_INVARIANTS, walk } = require("./properties.js");

test("comfort counts must partition every comparable room exactly", () => {
  const model = {
    empty: false,
    roomMarkers: [{}, {}, {}],
    comfort: { inComfort: 1, tooCool: 0, tooWarm: 1 },
  };
  assert.deepEqual(MODEL_INVARIANTS.comfortCountsAddUp(model), [
    "comfort counts total 2 but there are 3 rooms with values",
  ]);
});

test("non-finite averages say whether finite inputs overflowed or an input was already broken", () => {
  const aggregation = {
    average: { value: Infinity, source: "calculated" },
    roomMarkers: [{ value: 1e308 }, { value: 1e308 }],
  };
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(aggregation), [
    "average.value is Infinity (source calculated; finite room inputs)",
  ]);

  const conversion = {
    average: { value: -Infinity, source: "room", entity: "sensor.room0" },
    roomMarkers: [{ value: -Infinity, entity: "sensor.room0" }],
  };
  const conversionContext = {
    states: {
      "sensor.room0": { state: "-1e308", attributes: { unit_of_measurement: "°F" } },
    },
  };
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(conversion, conversionContext), [
    "average.value is -Infinity (source room; a finite Fahrenheit entity state overflowed during conversion)",
    "roomMarkers[0].value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
  ]);

  const calculatedFromConversion = {
    average: { value: -Infinity, source: "calculated" },
    roomMarkers: [{ value: -Infinity, entity: "sensor.room0" }],
    spread: Infinity,
  };
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(calculatedFromConversion, conversionContext), [
    "average.value is -Infinity (source calculated; a finite Fahrenheit entity state overflowed during conversion)",
    "roomMarkers[0].value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "spread is Infinity (derived from a finite Fahrenheit entity state that overflowed during conversion)",
  ]);

  const visibleButNotComparable = {
    rooms: { visible: [{ value: -Infinity, entity: "sensor.room0" }] },
    roomMarkers: [],
  };
  const compatibilitySymbolContext = {
    states: {
      "sensor.room0": { state: "-1e308", attributes: { unit_of_measurement: "℉" } },
    },
  };
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(visibleButNotComparable, compatibilitySymbolContext), [
    "rooms.visible[0].value is -Infinity (a finite Fahrenheit entity state overflowed during conversion)",
  ]);

  const unrelated = {
    average: { value: -Infinity, source: "room", entity: "sensor.room0" },
    roomMarkers: [{ value: -Infinity, entity: "sensor.room0" }],
  };
  const celsiusContext = {
    states: {
      "sensor.room0": { state: "-1e308", attributes: { unit_of_measurement: "°C" } },
    },
  };
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(unrelated, celsiusContext), [
    "average.value is -Infinity (source room)",
    "roomMarkers[0].value is -Infinity",
  ]);
});

test("a reading that overflows only on its way into the display unit is named as such", () => {
  // °C and K are finite when canonicalized; only the later projection into °F scales them.
  const projected = {
    metric: { unit: "°F" },
    rooms: { visible: [{ value: Infinity, entity: "sensor.room0" }] },
    roomMarkers: [{ value: Infinity, entity: "sensor.room0" }],
    spread: Infinity,
  };
  const withUnit = (unit) => ({
    states: { "sensor.room0": { state: "1e308", attributes: { unit_of_measurement: unit } } },
  });
  for (const unit of ["°C", "K"]) {
    assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(projected, withUnit(unit)), [
      "rooms.visible[0].value is Infinity (a finite reading overflowed on projection into the display unit)",
      "roomMarkers[0].value is Infinity (a finite reading overflowed on projection into the display unit)",
      "spread is Infinity (derived from a finite reading that overflowed on projection into the display unit)",
    ], unit);
  }

  // A display unit that does not scale cannot overflow a finite reading: no provenance.
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite({ ...projected, metric: { unit: "°C" } }, withUnit("°C")), [
    "rooms.visible[0].value is Infinity",
    "roomMarkers[0].value is Infinity",
    "spread is Infinity",
  ]);

  // A Fahrenheit reading overflows on its way in; that provenance keeps precedence.
  assert.deepEqual(MODEL_INVARIANTS.everyNumberIsFinite(projected, withUnit("°F")), [
    "rooms.visible[0].value is Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "roomMarkers[0].value is Infinity (a finite Fahrenheit entity state overflowed during conversion)",
    "spread is Infinity (derived from a finite Fahrenheit entity state that overflowed during conversion)",
  ]);
});

test("the model walker reaches values deeper than the former depth limit", () => {
  const root = {};
  let cursor = root;
  for (let index = 0; index < 30; index++) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.position = 150;
  const paths = [...walk(root)].map(({ path }) => path);
  assert.ok(paths.some((path) => path.endsWith("position")), "a deep position disappeared from the oracle");
  assert.equal(MODEL_INVARIANTS.positionsAreOnTheTrack(root).length, 1);
});

test("the model walker terminates on cycles without skipping shared branches", () => {
  const shared = { position: 20 };
  const root = { left: shared, right: shared };
  root.self = root;
  const paths = [...walk(root)].map(({ path }) => path);
  assert.ok(paths.includes("left.position"));
  assert.ok(paths.includes("right.position"));
  assert.ok(paths.includes("self"));
  assert.ok(paths.length < 20, `cycle produced ${paths.length} paths`);
});

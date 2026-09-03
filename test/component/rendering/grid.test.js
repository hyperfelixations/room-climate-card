"use strict";

// Room-chip grid (_roomGridRows(count, columns, rows)), a pure function:
// 0-20 rooms; auto-distribution for 8/9/13/14/15; only columns, only
// rows, both; capacity smaller than room count; no empty rows; stable
// column width in a shorter last row; capped chips still count toward
// average/extrema/comfort/spread.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
let el;

test.before(() => {
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card"); // pure function, no config/hass needed
});
test.after(() => {
  env.cleanupAll();
});

function totalItems(rowSizes) {
  return rowSizes.reduce((sum, r) => sum + r.itemCount, 0);
}

test("count <= 0 returns no rows and zero capacity", () => {
  assert.deepEqual(normalize(el._roomGridRows(0, null, null)), { rowSizes: [], capacity: 0 });
  assert.deepEqual(normalize(el._roomGridRows(-3, null, null)), { rowSizes: [], capacity: 0 });
});

test("fully automatic distribution for 1-20 rooms: no empty rows, every room accounted for", () => {
  for (let count = 1; count <= 20; count++) {
    const result = normalize(el._roomGridRows(count, null, null));
    assert.equal(result.capacity, count, `count=${count}`);
    assert.ok(result.rowSizes.every((r) => r.itemCount > 0), `count=${count}: no row may be empty`);
    assert.equal(totalItems(result.rowSizes), count, `count=${count}: rows must sum to count`);
  }
});

test("automatic distribution matches the documented default (max 7 per row, evenly split, earliest rows get the remainder)", () => {
  assert.deepEqual(normalize(el._roomGridRows(8, null, null)).rowSizes, [
    { itemCount: 4, columnCount: 4 },
    { itemCount: 4, columnCount: 4 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(9, null, null)).rowSizes, [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 4, columnCount: 4 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(13, null, null)).rowSizes, [
    { itemCount: 7, columnCount: 7 },
    { itemCount: 6, columnCount: 6 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(14, null, null)).rowSizes, [
    { itemCount: 7, columnCount: 7 },
    { itemCount: 7, columnCount: 7 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(15, null, null)).rowSizes, [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 5, columnCount: 5 },
    { itemCount: 5, columnCount: 5 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(1, null, null)).rowSizes, [{ itemCount: 1, columnCount: 1 }]);
  assert.deepEqual(normalize(el._roomGridRows(7, null, null)).rowSizes, [{ itemCount: 7, columnCount: 7 }]);
});

test("autoMaxColumns=7 (default, explicit and implicit) matches the documented cases", () => {
  for (const autoMaxColumns of [undefined, 7]) {
    const call = (count) => normalize(el._roomGridRows(count, null, null, autoMaxColumns)).rowSizes;
    assert.deepEqual(call(7), [{ itemCount: 7, columnCount: 7 }]);
    assert.deepEqual(call(8), [
      { itemCount: 4, columnCount: 4 },
      { itemCount: 4, columnCount: 4 },
    ]);
    assert.deepEqual(call(9), [
      { itemCount: 5, columnCount: 5 },
      { itemCount: 4, columnCount: 4 },
    ]);
    assert.deepEqual(call(13), [
      { itemCount: 7, columnCount: 7 },
      { itemCount: 6, columnCount: 6 },
    ]);
    assert.deepEqual(call(14), [
      { itemCount: 7, columnCount: 7 },
      { itemCount: 7, columnCount: 7 },
    ]);
    assert.deepEqual(call(15), [
      { itemCount: 5, columnCount: 5 },
      { itemCount: 5, columnCount: 5 },
      { itemCount: 5, columnCount: 5 },
    ]);
  }
});

// CO2/PM2.5 use a stricter autoMaxColumns=5 (see _autoRoomColumnsFor()) —
// same balanced base-plus-remainder distribution, just a lower per-row cap.
test("autoMaxColumns=5 matches the CO2/PM2.5 documented cases", () => {
  const call = (count) => normalize(el._roomGridRows(count, null, null, 5)).rowSizes;
  assert.deepEqual(call(5), [{ itemCount: 5, columnCount: 5 }]);
  assert.deepEqual(call(6), [
    { itemCount: 3, columnCount: 3 },
    { itemCount: 3, columnCount: 3 },
  ]);
  assert.deepEqual(call(7), [
    { itemCount: 4, columnCount: 4 },
    { itemCount: 3, columnCount: 3 },
  ]);
  assert.deepEqual(call(9), [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 4, columnCount: 4 },
  ]);
  assert.deepEqual(call(10), [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 5, columnCount: 5 },
  ]);
  assert.deepEqual(call(11), [
    { itemCount: 4, columnCount: 4 },
    { itemCount: 4, columnCount: 4 },
    { itemCount: 3, columnCount: 3 },
  ]);
});

// An explicit room_columns/room_rows override must take priority
// over autoMaxColumns regardless of its value — the parameter is only
// consulted in the fully-automatic branch (see _roomGridRows() comment).
test("explicit room_columns/room_rows overrides are unaffected by autoMaxColumns", () => {
  const withColumns = normalize(el._roomGridRows(8, 7, null, 5));
  assert.deepEqual(withColumns.rowSizes, [
    { itemCount: 7, columnCount: 7 },
    { itemCount: 1, columnCount: 7 },
  ]);
  assert.equal(withColumns.capacity, 8);

  const withRows = normalize(el._roomGridRows(8, null, 2, 5));
  assert.deepEqual(withRows.rowSizes, [
    { itemCount: 4, columnCount: 4 },
    { itemCount: 4, columnCount: 4 },
  ]);

  const withBoth = normalize(el._roomGridRows(10, 4, 2, 5));
  assert.equal(withBoth.capacity, 8, "purely visual cap, unaffected by autoMaxColumns");
});

test("only columns fixed: rows grow automatically, no capping, no empty rows", () => {
  for (const count of [0, 1, 5, 8, 9, 20]) {
    const result = normalize(el._roomGridRows(count, 3, null));
    if (count === 0) {
      assert.deepEqual(result, { rowSizes: [], capacity: 0 });
      continue;
    }
    assert.equal(result.capacity, count);
    assert.equal(totalItems(result.rowSizes), count);
    assert.ok(result.rowSizes.every((r) => r.itemCount > 0 && r.columnCount === 3));
    assert.equal(result.rowSizes.length, Math.ceil(count / 3));
  }
});

test("only columns fixed: a shorter last row keeps the same columnCount as the others (stable chip width)", () => {
  const result = normalize(el._roomGridRows(8, 3, null)); // 3,3,2
  assert.deepEqual(result.rowSizes, [
    { itemCount: 3, columnCount: 3 },
    { itemCount: 3, columnCount: 3 },
    { itemCount: 2, columnCount: 3 },
  ]);
});

test("only rows fixed: distributes as evenly as possible, earliest rows get the remainder, capped to count", () => {
  assert.deepEqual(normalize(el._roomGridRows(9, null, 2)).rowSizes, [
    { itemCount: 5, columnCount: 5 },
    { itemCount: 4, columnCount: 4 },
  ]);
  assert.deepEqual(normalize(el._roomGridRows(13, null, 2)).rowSizes, [
    { itemCount: 7, columnCount: 7 },
    { itemCount: 6, columnCount: 6 },
  ]);
  // room_rows requesting more rows than there are rooms must not create empty rows.
  const overRequested = normalize(el._roomGridRows(2, null, 5));
  assert.equal(overRequested.rowSizes.length, 2, "capped to count, no empty trailing rows");
  assert.ok(overRequested.rowSizes.every((r) => r.itemCount > 0));
});

test("both columns and rows fixed: literal columns x rows grid, capacity = columns*rows capped to count", () => {
  const result = normalize(el._roomGridRows(20, 3, 3));
  assert.equal(result.capacity, 9, "9 rooms shown (3x3), 11 configured rooms dropped");
  assert.equal(result.rowSizes.length, 3);
  assert.ok(result.rowSizes.every((r) => r.itemCount === 3 && r.columnCount === 3));
});

test("both fixed, count smaller than capacity: no empty rows are produced", () => {
  const result = normalize(el._roomGridRows(2, 3, 3)); // capacity 9, only 2 rooms
  assert.equal(result.capacity, 2);
  assert.equal(result.rowSizes.length, 1, "must not create empty trailing rows for the unused capacity");
  assert.deepEqual(result.rowSizes, [{ itemCount: 2, columnCount: 3 }]);
});

test("both fixed, a shorter last partial row still reports the fixed columnCount", () => {
  const result = normalize(el._roomGridRows(5, 3, 2)); // capacity 6, 5 shown -> rows [3,2]
  assert.equal(result.capacity, 5);
  assert.deepEqual(result.rowSizes, [
    { itemCount: 3, columnCount: 3 },
    { itemCount: 2, columnCount: 3 },
  ]);
});

test("both fixed, rows requesting more than count*columns needs never produces empty rows", () => {
  const result = normalize(el._roomGridRows(2, 2, 10)); // capacity 20, but only 2 rooms
  assert.equal(result.capacity, 2);
  assert.equal(result.rowSizes.length, 1);
});

// The grid cap is a display-only filter — capped-out
// rooms must still count in average/extrema/comfort/spread/roomCount.
test("DATA-01 integration: rooms hidden by room_columns/room_rows still count in average/extrema/comfort/spread", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
  };
  const rooms = [];
  // 10 rooms, values 15..24 (10 distinct values so coolest/warmest are unambiguous).
  for (let i = 0; i < 10; i++) {
    const entity = `sensor.r${i}`;
    states[entity] = mkState(entity, 15 + i, TEMPERATURE_C);
    rooms.push({ name: `R${i}`, entity });
  }
  const hass = mkHass(states);
  const capped = env.createCard({ entity: "sensor.avg", rooms, room_columns: 4, room_rows: 2 }, hass); // only 8 of 10 visible
  const uncapped = env.createCard({ entity: "sensor.avg", rooms }, hass);
  const cappedData = capped._computeViewModel();
  const uncappedData = uncapped._computeViewModel();

  assert.equal(cappedData.rooms.visible.length, 8, "only 8 chips actually rendered");
  assert.equal(cappedData.rooms.count, 10, "roomCount reflects all valid rooms, not just visible chips");
  assert.equal(cappedData.extremes.coolest.name, uncappedData.extremes.coolest.name, "coolest must be R0 (15°C) even though it might be capped out");
  assert.equal(cappedData.extremes.warmest.name, uncappedData.extremes.warmest.name, "warmest must be R9 (24°C) even if capped out");
  assert.equal(cappedData.spread, uncappedData.spread);
  assert.equal(cappedData.average.value, uncappedData.average.value);

  env.cleanup(capped);
  env.cleanup(uncapped);
});

test("DATA-01 integration: which rooms get capped-out is decided by configuration order, not by value (a room near the middle of the value range never flickers in/out as values change through the day)", () => {
  // Values are not in config order, so "cap by config order" (R0/R1/R2) and "cap by value"
  // (R1/R3/R2) pick different sets. Selection must be config order; display is sorted by value.
  const states = { "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) };
  const rooms = [
    { name: "R0", entity: "sensor.r0" }, // 23
    { name: "R1", entity: "sensor.r1" }, // 20
    { name: "R2", entity: "sensor.r2" }, // 22
    { name: "R3", entity: "sensor.r3" }, // 21
    { name: "R4", entity: "sensor.r4" }, // 24
  ];
  const values = { R0: 23, R1: 20, R2: 22, R3: 21, R4: 24 };
  for (const room of rooms) states[room.entity] = mkState(room.entity, values[room.name], TEMPERATURE_C);
  const hass = mkHass(states);
  const el2 = env.createCard({ entity: "sensor.avg", rooms, room_columns: 3, room_rows: 1 }, hass); // cap to 3
  const data = el2._computeViewModel();
  assert.equal(data.rooms.visible.length, 3);
  const visibleNames = new Set(normalize(data.rooms.visible).map((r) => r.name));
  assert.deepEqual(visibleNames, new Set(["R0", "R1", "R2"]), "capped selection must be the first 3 declared (R0/R1/R2), not the 3 lowest values (R1/R3/R2)");
  // Within the visible set, display order is still sorted by value ascending: R1(20), R2(22), R0(23).
  assert.deepEqual(normalize(data.rooms.visible).map((r) => r.name), ["R1", "R2", "R0"]);
  env.cleanup(el2);
});

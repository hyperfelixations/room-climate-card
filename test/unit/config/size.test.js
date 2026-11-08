"use strict";

// The `size` option: a step (small, medium, large) or a factor from 1 to 2 for the whole card, or a
// block naming `header`, `panel`, `rooms` and `dynamic`. A part the block does not write is small;
// the rooms have steps of their own (1.5 and 2), and the card-wide step gives them the matching
// room factor. `dynamic` defaults to true. `hierarchy` records whether the rooms stay at or below
// the panel. An invalid value falls back with one warning; an unknown key in the block refuses.
// Boundary: card-size.test.js owns what the factors draw. See internal dev doc §3
// "Konfigurationsvertrag".

const test = require("node:test");
const assert = require("node:assert/strict");

let sizeModule;

test.before(async () => {
  sizeModule = await import("../../../src/config/size.js");
});

function normalize(value) {
  const diagnostics = [];
  const size = sizeModule.normalizeSizeConfig(value, diagnostics);
  return { size, diagnostics };
}

const card = (factor, rooms) => ({ header: factor, panel: factor, rooms, dynamic: true, hierarchy: true });

test("a size not written, and an empty block, is the drawn card", () => {
  for (const value of [undefined, null, {}]) {
    assert.deepEqual(normalize(value), { size: card(1, 1), diagnostics: [] }, JSON.stringify(value));
  }
});

test("a step or a factor sizes the whole card, the rooms on their own steps", () => {
  const cases = [["small", card(1, 1)], ["medium", card(1.25, 1.5)], ["large", card(1.5, 2)], [1.4, card(1.4, 1.8)], ["1.2", card(1.2, 1.4)], [" 1.75 ", card(1.75, 2)], [2, card(2, 2)]];
  for (const [value, expected] of cases) {
    assert.deepEqual(normalize(value), { size: expected, diagnostics: [] }, JSON.stringify(value));
  }
  assert.equal(sizeModule.roomFactorFor(1), 1);
  assert.equal(sizeModule.roomFactorFor(sizeModule.SIZE_STEPS.medium), sizeModule.ROOM_SIZE_STEPS.medium, "the steps continue linearly");
  assert.equal(sizeModule.roomFactorFor(sizeModule.SIZE_STEPS.large), sizeModule.ROOM_SIZE_STEPS.large);
});

test("a block sizes each part on its own; a part not written is small", () => {
  assert.deepEqual(normalize({ panel: "large" }).size, { header: 1, panel: 1.5, rooms: 1, dynamic: true, hierarchy: true });
  assert.deepEqual(normalize({ rooms: "medium" }).size, { header: 1, panel: 1, rooms: 1.5, dynamic: true, hierarchy: false });
  assert.deepEqual(normalize({ rooms: 1.4, panel: "medium", dynamic: false }).size, { header: 1, panel: 1.25, rooms: 1.4, dynamic: false, hierarchy: true });
  assert.deepEqual(normalize({ header: "large", panel: "large", rooms: "large" }).size, card(1.5, 2), "the same parts as the step");
  assert.deepEqual(normalize({ panel: "large", rooms: null }).size.rooms, 1, "null is not written");
});

test("the rooms keep below the panel unless the block asks for more", () => {
  assert.equal(normalize({ panel: "medium", rooms: "medium" }).size.hierarchy, true);
  assert.equal(normalize({ panel: "medium", rooms: "large" }).size.hierarchy, false);
  assert.equal(normalize({ panel: "large", rooms: "medium" }).size.hierarchy, true);
  assert.equal(normalize({ panel: 1.25, rooms: 1.5 }).size.hierarchy, true, "the matching factors");
  assert.equal(normalize({ panel: 1.25, rooms: 1.51 }).size.hierarchy, false);
});

test("an invalid size falls back to small with one warning", () => {
  for (const value of ["huge", "Large", "", 0.5, 0, 2.5, -1, true, [], ["large"], "1,5"]) {
    const { size, diagnostics } = normalize(value);
    assert.deepEqual(size, card(1, 1), JSON.stringify(value));
    assert.equal(diagnostics.length, 1, JSON.stringify(value));
    assert.deepEqual(
      { code: diagnostics[0].code, path: diagnostics[0].path, value: diagnostics[0].value, fallback: diagnostics[0].fallback },
      { code: "value.invalid", path: "size", value, fallback: { value: "small" } }
    );
  }
});

test("an invalid part is small, an invalid dynamic is true, each with one warning", () => {
  const part = normalize({ panel: "large", rooms: "huge" });
  assert.deepEqual(part.size, { header: 1, panel: 1.5, rooms: 1, dynamic: true, hierarchy: true });
  assert.deepEqual(part.diagnostics.map(({ path, value, fallback }) => ({ path, value, fallback })), [{ path: "size.rooms", value: "huge", fallback: { value: "small" } }]);
  const dynamic = normalize({ rooms: "large", dynamic: "yes" });
  assert.equal(dynamic.size.dynamic, true);
  assert.deepEqual(dynamic.diagnostics.map(({ path, fallback }) => ({ path, fallback })), [{ path: "size.dynamic", fallback: { value: true } }]);
});

test("an unknown key in the block refuses, naming the key it was probably meant to be", () => {
  const refusal = (value) => {
    try {
      normalize(value);
    } catch (error) {
      return { code: error.code, params: error.params };
    }
    return null;
  };
  assert.deepEqual(refusal({ room: 2 }), { code: "config.unknown_key", params: { key: "size.room", suggestion: "size.rooms" } });
  assert.deepEqual(refusal({ dynamc: true }), { code: "config.unknown_key", params: { key: "size.dynamc", suggestion: "size.dynamic" } });
  assert.deepEqual(refusal({ card: "large" }), { code: "config.unknown_key", params: { key: "size.card", suggestion: null } });
});

test("the steps grow from the drawn card and stay within the factor bounds", () => {
  const { SIZE_STEPS, ROOM_SIZE_STEPS, SIZE_FACTOR } = sizeModule;
  for (const steps of [SIZE_STEPS, ROOM_SIZE_STEPS]) {
    assert.deepEqual(Object.keys(steps), ["small", "medium", "large"]);
    assert.equal(steps.small, 1);
    assert.ok(steps.small < steps.medium && steps.medium < steps.large && steps.large <= SIZE_FACTOR.max);
  }
  assert.ok(ROOM_SIZE_STEPS.medium > SIZE_STEPS.medium, "a chip has room to spare");
});

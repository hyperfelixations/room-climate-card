"use strict";

// The contract between what a renderer EMITS and what a patcher can UPDATE.
//
// A DOM patcher can only change nodes that exist. Every optional part of the markup —
// a footer that only appears with rooms, the two extrema markers, a band and its
// label — is therefore a structural decision: when its presence changes, patching is
// not enough and the card has to be rebuilt.
//
// Before this contract existed, that was expressed as a hand-maintained list of
// booleans in _render(): the chip grid, the view key list, the collapsed state. Any
// optional part NOT on that list was simply missed. The reproduction below is the
// cheapest way to see it: with show_rooms:false the chip grid is absent either way,
// so a second room becoming valid changed nothing on the list — while the scale
// view's footer and its extrema markers genuinely had to appear.
//
// The fix is not another boolean. Each view now declares its own structure signature
// over exactly the optional parts it does NOT reconcile itself, the card shell
// composes those with its own, and _render() compares one value. A new view, or a new
// optional element in an existing view, extends that view's own signature — index.js
// never learns about it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const C = { device_class: "temperature", unit_of_measurement: "°C" };

// show_rooms:false is what isolates the bug: it pins the chip grid to "absent" in both
// states, so the only thing that changes when the second room becomes valid is inside
// the scale view.
function config(overrides = {}) {
  return {
    entity: "sensor.avg",
    show_rooms: false,
    rooms: [
      { name: "Alpha", short: "AL", entity: "sensor.a" },
      { name: "Beta", short: "BE", entity: "sensor.b" },
    ],
    views: [{ type: "scale" }],
    ...overrides,
  };
}

// A real attribute-only change always bumps last_updated; two mkState() calls in the
// same millisecond would otherwise collide and be treated as a no-op update.
function bumped(states, offsetMs) {
  if (offsetMs) {
    for (const state of Object.values(states)) {
      state.last_updated = new Date(Date.now() + offsetMs).toISOString();
    }
  }
  return mkHass(states);
}

// The second room is present but unusable, so exactly one room is valid.
function oneValidRoom(offsetMs = 0) {
  return bumped(
    {
      "sensor.avg": mkState("sensor.avg", 22, C),
      "sensor.a": mkState("sensor.a", 21, C),
      "sensor.b": mkState("sensor.b", "unavailable", C),
    },
    offsetMs
  );
}

function twoValidRooms(offsetMs = 0, warmValue = 23) {
  return bumped(
    {
      "sensor.avg": mkState("sensor.avg", 22, C),
      "sensor.a": mkState("sensor.a", 21, C),
      "sensor.b": mkState("sensor.b", warmValue, C),
    },
    offsetMs
  );
}

function structure(el) {
  const root = el.shadowRoot;
  return {
    footer: Boolean(root.querySelector(".rtc-scale-footer")),
    coldMarker: Boolean(root.querySelector(".rtc-marker-cold")),
    warmMarker: Boolean(root.querySelector(".rtc-marker-warm")),
    averageMarker: Boolean(root.querySelector(".rtc-marker-avg")),
    chipGrid: Boolean(root.querySelector(".rtc-room-grid")),
    scaleView: Boolean(root.querySelector(".rtc-scale-view")),
  };
}

test("one valid room to two: the footer and both extrema markers appear", () => {
  const el = env.createCard(config(), oneValidRoom());
  assert.deepEqual(
    structure(el),
    { footer: false, coldMarker: false, warmMarker: false, averageMarker: true, chipGrid: false, scaleView: true },
    "with one room there is nothing to compare, so neither footer nor extrema exist"
  );

  el.hass = twoValidRooms(1000);
  assert.deepEqual(
    structure(el),
    { footer: true, coldMarker: true, warmMarker: true, averageMarker: true, chipGrid: false, scaleView: true },
    "a second valid room must bring the footer and both extrema markers into the DOM"
  );
  env.cleanup(el);
});

test("two valid rooms back to one: the footer and both extrema markers disappear", () => {
  const el = env.createCard(config(), twoValidRooms());
  assert.equal(structure(el).footer, true);
  assert.equal(structure(el).coldMarker, true);

  el.hass = oneValidRoom(1000);
  assert.deepEqual(
    structure(el),
    { footer: false, coldMarker: false, warmMarker: false, averageMarker: true, chipGrid: false, scaleView: true },
    "losing the comparison must remove exactly what it added"
  );
  env.cleanup(el);
});

test("the round trip is idempotent: one to two to one leaves the original structure", () => {
  const el = env.createCard(config(), oneValidRoom());
  const before = structure(el);
  el.hass = twoValidRooms(1000);
  el.hass = oneValidRoom(2000);
  assert.deepEqual(structure(el), before);
  env.cleanup(el);
});

test("the values and the visible view stay consistent across the structural flip", () => {
  const el = env.createCard(config(), oneValidRoom());
  const before = el._computeViewModel();
  assert.equal(before.rooms.comparable, false);
  assert.deepEqual([...el._views], ["scale"]);
  assert.equal(el._activeView, 0);

  el.hass = twoValidRooms(1000);
  const after = el._computeViewModel();
  assert.equal(after.rooms.comparable, true);
  assert.equal(after.rooms.count, 2);
  assert.deepEqual([...el._views], ["scale"], "the view list itself did not change");
  assert.equal(el._activeView, 0, "and the visible view is preserved");
  assert.ok(after.scale.scaleMin <= 21 && after.scale.scaleMax >= 23, "the axis covers both rooms");
  for (const position of [after.average.position, (after.extremes?.coolestPosition ?? 0), (after.extremes?.warmestPosition ?? 0)]) {
    assert.ok(position >= 0 && position <= 100, `marker position ${position} must be on the bar`);
  }
  env.cleanup(el);
});

test("the extrema markers name the right rooms, and a later value update patches instead of rebuilding", () => {
  const el = env.createCard(config(), oneValidRoom());
  el.hass = twoValidRooms(1000);
  const cold = el.shadowRoot.querySelector(".rtc-marker-cold");
  const warm = el.shadowRoot.querySelector(".rtc-marker-warm");
  assert.match(cold.getAttribute("title"), /Alpha/);
  assert.match(warm.getAttribute("title"), /Beta/);

  const averageBefore = el.shadowRoot.querySelector(".rtc-marker-avg");
  el.hass = twoValidRooms(2000, 25);
  assert.equal(el.shadowRoot.querySelector(".rtc-marker-avg"), averageBefore, "a value-only update patches, never rebuilds");
  assert.equal(el.shadowRoot.querySelector(".rtc-marker-cold"), cold);
  env.cleanup(el);
});

test("focus on the average button survives a value update after the structural flip", () => {
  const el = env.createCard(config(), oneValidRoom());
  el.hass = twoValidRooms(1000);
  const button = el.shadowRoot.querySelector("button.rtc-avg-button");
  assert.ok(button, "the average is interactive in this configuration");
  button.focus();
  assert.equal(el.shadowRoot.activeElement, button);

  el.hass = twoValidRooms(2000, 25);
  assert.equal(el.shadowRoot.activeElement, button, "the focused node is patched, not replaced");
  env.cleanup(el);
});

test("markers:average never gains extrema markers, in either room state", () => {
  // The signature must follow the RESOLVED option, not just the room count.
  const el = env.createCard(config({ views: [{ type: "scale", options: { markers: "average" } }] }), oneValidRoom());
  assert.equal(structure(el).coldMarker, false);
  el.hass = twoValidRooms(1000);
  assert.equal(structure(el).coldMarker, false, "markers:average has no extrema pair to add");
  assert.equal(structure(el).footer, true, "but the footer still follows the room count");
  env.cleanup(el);
});

test("hide_footer keeps the footer absent while the extrema markers still appear", () => {
  const el = env.createCard(config({ hide_footer: true }), oneValidRoom());
  assert.equal(structure(el).footer, false);
  el.hass = twoValidRooms(1000);
  assert.equal(structure(el).footer, false, "hide_footer wins over the room count");
  assert.equal(structure(el).coldMarker, true, "the markers are an independent decision");
  env.cleanup(el);
});

test("markers:all reconciles its room markers without a rebuild", () => {
  // The counterpart to the rule: a part a view DOES reconcile must stay out of the
  // signature, or every room appearing would cost a full rebuild and reset the
  // carousel.
  const el = env.createCard(
    config({ show_rooms: true, views: [{ type: "scale", options: { markers: "all" } }] }),
    twoValidRooms()
  );
  const bar = el.shadowRoot.querySelector(".rtc-scale-bar");
  assert.equal(bar.querySelectorAll(".rtc-marker-room").length, 2);

  el.hass = oneValidRoom(1000);
  assert.equal(
    el.shadowRoot.querySelector(".rtc-scale-bar").querySelectorAll(".rtc-marker-room").length,
    0,
    "room markers follow availability"
  );
  env.cleanup(el);
});

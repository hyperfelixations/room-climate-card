"use strict";

// UI-02 (v2.15.0 audit): _handlePointerCancel() must derive _activeView from
// the frozen drag position (pointer.startTranslate), not from a stale
// this._activeView that was never updated during the drag itself — matching
// _handlePointerUp()'s already-correct threshold-swipe path. These are pure
// method-call tests (no real pointer/touch events needed — that belongs to
// the Playwright layer for the actual gesture recognition); they construct
// the exact _pointer shape _handlePointerDown() would produce mid-drag.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function threeViewCard() {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  return env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  );
}

test("UI-02: pointercancel derives _activeView from the frozen drag position, not the stale pre-swipe value", () => {
  const el = threeViewCard();
  assert.equal(el._views.length, 3, "range, scale, extremes");
  const viewWidthPct = el._viewWidthPct();

  // Simulate: the visible swipe froze at index 2 ("extremes"), but
  // _activeView itself was never updated during the drag (stale at 0) —
  // exactly the bug scenario UI-02 describes.
  el._activeView = 0;
  el._isDragging = true;
  el._pointer = {
    id: 1,
    x: 0,
    y: 0,
    time: Date.now(),
    rotator: true,
    entityTarget: null,
    startTranslate: -2 * viewWidthPct,
    dragging: true,
    width: 300,
  };

  el._handlePointerCancel({ pointerId: 1 });

  assert.equal(el._activeView, 2, "must derive from the frozen position (2), not the stale this._activeView (0)");
  assert.equal(el._isDragging, false);
  assert.equal(el._pointer, null);
  env.cleanup(el);
});

test("UI-02: pointercancel with a mismatched pointerId is ignored entirely", () => {
  const el = threeViewCard();
  el._activeView = 1;
  el._isDragging = true;
  el._pointer = { id: 1, startTranslate: 0, dragging: true, rotator: true, width: 100 };

  el._handlePointerCancel({ pointerId: 999 }); // different pointer, e.g. a second/secondary touch

  assert.equal(el._activeView, 1, "unrelated pointer's cancel must not touch state");
  assert.equal(el._isDragging, true);
  assert.notEqual(el._pointer, null);
  env.cleanup(el);
});

test("UI-02: pointercancel with no active pointer at all is a safe no-op", () => {
  const el = threeViewCard();
  el._pointer = null;
  el._isDragging = false;
  assert.doesNotThrow(() => el._handlePointerCancel({ pointerId: 1 }));
  env.cleanup(el);
});

test("UI-02: at each of the 3 possible frozen positions, pointercancel lands on the correct view index", () => {
  const el = threeViewCard();
  const viewWidthPct = el._viewWidthPct();
  for (let targetIndex = 0; targetIndex <= 2; targetIndex++) {
    el._activeView = (targetIndex + 1) % 3; // deliberately stale/wrong
    el._isDragging = true;
    el._pointer = {
      id: 7,
      startTranslate: -targetIndex * viewWidthPct,
      dragging: true,
      rotator: true,
      width: 300,
      x: 0,
      y: 0,
      time: Date.now(),
      entityTarget: null,
    };
    el._handlePointerCancel({ pointerId: 7 });
    assert.equal(el._activeView, targetIndex, `frozen at index ${targetIndex}`);
  }
  env.cleanup(el);
});

test("pointercancel while NOT dragging (a tap that never became a swipe) does not touch _activeView", () => {
  const el = threeViewCard();
  el._activeView = 1;
  el._isDragging = false;
  el._pointer = { id: 5, startTranslate: 0, dragging: false, rotator: true, width: 100 };
  el._handlePointerCancel({ pointerId: 5 });
  assert.equal(el._activeView, 1);
  assert.equal(el._pointer, null, "the pointer itself is still cleared");
  env.cleanup(el);
});

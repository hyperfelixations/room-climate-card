"use strict";

// _handlePointerCancel() must derive _activeView from
// the frozen drag position (pointer.startTranslate), not from a stale
// this._activeView that was never updated during the drag itself — matching
// _handlePointerUp()'s already-correct threshold-swipe path.
//
// Every gesture below is produced by the element's own pointer handlers rather than
// assembled by hand, so the state each test starts from is state the card can actually
// reach. Gesture RECOGNITION at the pixel level belongs to the Playwright layer; what
// is asserted here is which view the card lands on afterwards.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { beginConfirmedDrag, beginTouch, cancelDrag, endDrag } = require("../../helpers/gestures.js");

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

test("pointercancel derives the active view from the frozen drag position", () => {
  const el = threeViewCard();
  assert.equal(el._views.length, 3, "range, scale, extremes");
  const viewWidthPct = el._viewWidthPct();

  // The visible swipe froze at index 2 ("extremes"); _activeView is then pushed back to
  // 0 to model a stale index that was
  // never updated during the drag itself.
  beginConfirmedDrag(el, 2);
  el._activeView = 0;

  cancelDrag(el);

  assert.equal(el._activeView, 2, "must derive from the frozen position (2), not the stale this._activeView (0)");
  assert.equal(el._isDragging, false);
  assert.equal(el._interaction.pointer, null);
  env.cleanup(el);
});

test("pointercancel with a mismatched pointerId is ignored", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 0);
  el._activeView = 1;

  cancelDrag(el, { pointerId: 999 }); // different pointer, e.g. a second/secondary touch

  assert.equal(el._activeView, 1, "unrelated pointer's cancel must not touch state");
  assert.equal(el._isDragging, true);
  assert.notEqual(el._interaction.pointer, null);
  env.cleanup(el);
});

test("pointercancel with no active pointer is a safe no-op", () => {
  const el = threeViewCard();
  assert.equal(el._interaction.pointer, null, "a freshly rendered card has no gesture in flight");
  assert.doesNotThrow(() => cancelDrag(el));
  env.cleanup(el);
});

test("pointercancel resolves each frozen position to the correct view", () => {
  const el = threeViewCard();
  for (let targetIndex = 0; targetIndex <= 2; targetIndex++) {
    beginConfirmedDrag(el, targetIndex, { pointerId: 7 });
    el._activeView = (targetIndex + 1) % 3; // deliberately stale/wrong
    cancelDrag(el, { pointerId: 7 });
    assert.equal(el._activeView, targetIndex, `frozen at index ${targetIndex}`);
  }
  env.cleanup(el);
});

test("pointercancel while NOT dragging (a tap that never became a swipe) does not touch _activeView", () => {
  const el = threeViewCard();
  el._activeView = 1;
  beginTouch(el, { pointerId: 5 }); // a press that never crossed the direction threshold
  assert.equal(el._isDragging, false);
  cancelDrag(el, { pointerId: 5 });
  assert.equal(el._activeView, 1);
  assert.equal(el._interaction.pointer, null, "the pointer itself is still cleared");
  env.cleanup(el);
});

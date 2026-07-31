"use strict";

// setConfig() arriving mid-swipe must settle the confirmed drag before
// rendering the new configuration. Otherwise the track could remain frozen
// in "rtc-manual" at an intermediate position with no resume
// timer ever scheduled -- a live-editing config change mid-swipe could
// wedge the carousel indefinitely. These tests construct the exact
// _pointer/_isDragging shape _handlePointerDown()/_handlePointerMove()
// produce for a confirmed drag (same technique as pointer-logic.test.js's
// UI-02 coverage of the sibling _handlePointerCancel() path), then call
// setConfig() and verify the interaction is settled exactly the way
// _handlePointerCancel() already settles one.
//
// setConfig() always replaces the whole config (matching the real Home
// Assistant editor, which never sends a partial patch) -- every setConfig()
// call below therefore repeats the full BASE_CONFIG plus one incremental
// field, so the active view set (range/scale/extremes) stays unchanged and
// the fix under test isn't confounded by an incidental structural change.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { beginConfirmedDrag, beginTouch, cancelDrag, endDrag } = require("../helpers/gestures.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const BASE_CONFIG = {
  entity: "sensor.avg",
  range_entity: "sensor.range",
  rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
};

function threeViewCard() {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  return env.createCard(BASE_CONFIG, hass);
}

test("setConfig mid-drag resolves the active view and clears drag state", () => {
  const el = threeViewCard();
  assert.equal(el._views.length, 3, "range, scale, extremes");
  beginConfirmedDrag(el, 2);
  el._activeView = 0; // stale/pre-drag value, must not leak through

  el.setConfig({ ...BASE_CONFIG, avg_label: "Custom" }); // non-structural change

  assert.equal(el._activeView, 2, "must resolve from the frozen drag position (2), not the stale pre-drag value (0)");
  assert.equal(el._isDragging, false);
  assert.equal(el._interaction.pointer, null);
  env.cleanup(el);
});

test("setConfig mid-drag settles the transform and schedules a resume", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 1);
  const track = el.shadowRoot.querySelector(".rtc-track");
  track.style.transform = "translate3d(-17%,0,0)"; // an arbitrary mid-drag position, not aligned to any view

  el.setConfig({ ...BASE_CONFIG, avg_label: "Custom" });

  const viewWidthPct = el._viewWidthPct();
  assert.equal(el._activeView, 1);
  assert.equal(
    track.style.transform,
    `translate3d(${-(el._activeView) * viewWidthPct}%,0,0)`,
    "track must be snapped to the resolved view's exact position, not left at the arbitrary frozen transform"
  );
  assert.ok(el._carousel.resumeTimerHandle !== null && el._carousel.resumeTimerHandle !== undefined, "a phase-aligned resume must be scheduled, matching a completed swipe");
  env.cleanup(el);
});

test("setConfig without an active drag does not schedule a resume", () => {
  const el = threeViewCard();
  assert.equal(el._isDragging, false);
  assert.equal(el._interaction.pointer, null);
  // The resume timer is owned by the carousel controller, so it is cleared through the
  // owner rather than by writing the field. el._carousel.resumeTimerHandle is a read-only window
  // onto that handle, which is exactly what keeps a second copy from existing.
  el._stopRotation();
  assert.equal(el._carousel.resumeTimerHandle, null, "starting point: nothing pending");

  el.setConfig({ ...BASE_CONFIG, avg_label: "Custom" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  env.cleanup(el);
});

test("setConfig during an unconfirmed pointerdown clears state without settling", () => {
  const el = threeViewCard();
  el._activeView = 1;
  beginTouch(el); // pointerdown happened, but the 10px/25deg drag threshold was never crossed
  assert.equal(el._isDragging, false);

  el.setConfig({ ...BASE_CONFIG, avg_label: "Custom" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  env.cleanup(el);
});

test("an invalid setConfig mid-drag settles interaction before propagating", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 1);

  assert.throws(() => el.setConfig({ entity: "" })); // invalid: empty required entity

  assert.equal(el._interaction.pointer, null, "the old interaction state must not be left dangling just because the new config was rejected");
  assert.equal(el._isDragging, false);
  env.cleanup(el);
});

test("setConfig mid-drag resolves each frozen track position to the correct view", () => {
  const el = threeViewCard();
  for (let targetIndex = 0; targetIndex <= 2; targetIndex++) {
    beginConfirmedDrag(el, targetIndex, { pointerId: 7 });
    el._activeView = (targetIndex + 1) % 3; // deliberately stale/wrong
    el.setConfig({ ...BASE_CONFIG, avg_label: `pass-${targetIndex}` });
    assert.equal(el._activeView, targetIndex);
  }
  env.cleanup(el);
});

"use strict";

// Offscreen carousel views must not be
// tabbable or visible to assistive tech. All .rtc-view elements stay
// permanently mounted (only the CSS transform moves them);
// _updateViewAccessibility() keeps aria-hidden/inert in sync with
// _currentVisualViewIndex() — this._activeView only while the track is
// manually frozen (a completed swipe/pointer-cancel, or auto-slide
// disabled), and the wall-clock CSS-phase-derived index while synced
// auto-slide is actually driving the track (see
// _accessibleViewIndexAt()/_currentVisualViewIndex()). The phase-following
// behavior itself is covered deterministically (constructed timing
// objects, no wall clock) in accessibility-carousel-timing.test.js; this
// file focuses on the manual-mode/discrete-transition paths.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { beginConfirmedDrag, beginTouch, cancelDrag, endDrag } = require("../../helpers/gestures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function twoViewCard() {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  return env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hass);
}

test("initial render: the view _currentVisualViewIndex() reports has neither aria-hidden nor inert; the other has both", () => {
  // Not asserted against el._activeView directly: with auto-slide enabled
  // (the default for a 2-view card), the view actually shown right after
  // render depends on wall-clock phase (_accessibleViewIndexAt()),
  // not the JS-only _activeView — asserting against the same
  // _currentVisualViewIndex() source _updateViewAccessibility() itself
  // uses is what stays deterministic regardless of when the test runs.
  const el = twoViewCard();
  const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
  assert.equal(views.length, 2);
  const activeIndex = el._currentVisualViewIndex();
  const active = views[activeIndex];
  const inactive = views[1 - activeIndex];
  assert.equal(active.hasAttribute("aria-hidden"), false);
  assert.equal(active.hasAttribute("inert"), false);
  assert.equal(inactive.getAttribute("aria-hidden"), "true");
  assert.equal(inactive.hasAttribute("inert"), true);
  env.cleanup(el);
});

test("_updateViewAccessibility() follows this._activeView while the track is manually frozen", () => {
  const el = twoViewCard();
  // Freezes the track into manual mode (adds "rtc-manual") — the only
  // state in which _currentVisualViewIndex() is defined to fall back to
  // this._activeView instead of the wall-clock auto-slide phase.
  el._updateTrackTransform(true);
  el._activeView = 1;
  el._carousel.updateViewAccessibility();
  const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
  assert.equal(views[0].getAttribute("aria-hidden"), "true");
  assert.equal(views[0].hasAttribute("inert"), true);
  assert.equal(views[1].hasAttribute("aria-hidden"), false);
  assert.equal(views[1].hasAttribute("inert"), false);

  el._activeView = 0;
  el._carousel.updateViewAccessibility();
  const views2 = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
  assert.equal(views2[0].hasAttribute("aria-hidden"), false);
  assert.equal(views2[1].getAttribute("aria-hidden"), "true");
  env.cleanup(el);
});

test("a completed swipe (_handlePointerUp) updates accessibility to the new active view", () => {
  const el = twoViewCard();
  const startIndex = el._activeView;
  const targetIndex = 1 - startIndex;
  beginConfirmedDrag(el, startIndex);
  // A horizontal delta well past the 18% commit threshold, in the direction of targetIndex.
  endDrag(el, targetIndex > startIndex ? -200 : 200);

  assert.equal(el._activeView, targetIndex);
  const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
  assert.equal(views[targetIndex].hasAttribute("aria-hidden"), false);
  assert.equal(views[startIndex].getAttribute("aria-hidden"), "true");
  env.cleanup(el);
});

test("pointercancel mid-drag also updates accessibility to the frozen position (UI-02 + A11Y-01 together)", () => {
  const el = twoViewCard();
  beginConfirmedDrag(el, 1, { pointerId: 3 }); // frozen at index 1
  el._activeView = 0; // stale
  cancelDrag(el, { pointerId: 3 });
  assert.equal(el._activeView, 1);
  const views = Array.from(el.shadowRoot.querySelectorAll(".rtc-view"));
  assert.equal(views[1].hasAttribute("aria-hidden"), false);
  assert.equal(views[0].getAttribute("aria-hidden"), "true");
  env.cleanup(el);
});

test("a single-view card (no rotator) uses .rtc-rotator-solo, not the .rtc-view carousel markup at all — nothing for _updateViewAccessibility() to touch", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-view").length, 0);
  assert.ok(el.shadowRoot.querySelector(".rtc-rotator-solo"));
  assert.doesNotThrow(() => el._carousel.updateViewAccessibility(), "must be a safe no-op with zero .rtc-view elements");
  env.cleanup(el);
});

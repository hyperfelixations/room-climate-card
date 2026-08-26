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
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { beginConfirmedDrag, beginTouch, cancelDrag, endDrag } = require("../../helpers/gestures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;
// The render paths, imported from the source module so the assertions name the same
// constants production does.
let RENDER_PATH;

test.before(async () => {
  ({ RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
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

const C = TEMPERATURE_C;

// A fresh hass with a given average. `offsetMs` moves last_updated so a repeat push
// with the same value is still a new state as far as the render signature is concerned.
function states(average = 22, offsetMs = 0) {
  const all = {
    "sensor.avg": mkState("sensor.avg", average, C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, C),
    "sensor.r2": mkState("sensor.r2", 23, C),
  };
  if (offsetMs) {
    for (const state of Object.values(all)) state.last_updated = new Date(Date.now() + offsetMs).toISOString();
  }
  return mkHass(all);
}

function threeViewCard() {
  return env.createCard(BASE_CONFIG, states(22));
}

test("setConfig mid-drag resolves the active view and clears drag state", () => {
  const el = threeViewCard();
  assert.equal(el._views.length, 3, "range, scale, extremes");
  beginConfirmedDrag(el, 2);
  el._activeView = 0; // stale/pre-drag value, must not leak through

  el.setConfig({ ...BASE_CONFIG, entity_label: "Custom" }); // non-structural change

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

  el.setConfig({ ...BASE_CONFIG, entity_label: "Custom" });

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

  el.setConfig({ ...BASE_CONFIG, entity_label: "Custom" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  env.cleanup(el);
});

test("setConfig during an unconfirmed pointerdown clears state without settling", () => {
  const el = threeViewCard();
  el._activeView = 1;
  beginTouch(el); // pointerdown happened, but the 10px/25deg drag threshold was never crossed
  assert.equal(el._isDragging, false);

  el.setConfig({ ...BASE_CONFIG, entity_label: "Custom" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  env.cleanup(el);
});

// ---------------------------------------------- strong exception safety --
//
// A REJECTED setConfig() must change nothing at all.
//
// The previous contract was weaker and, on one path, actively harmful: setConfig()
// ended the gesture first and only then validated. A configuration the editor rejects
// therefore still destroyed the gesture — and with it the pointerup that was going to
// settle a render deferred during that gesture. The card kept displaying a value Home
// Assistant had already superseded, with no event left that would have applied it.
//
// So the rule is now all-or-nothing: normalize into a local first, and touch no state
// until that has succeeded. An earlier assertion in this file demanded the opposite
// ("the old interaction state must not be left dangling") — it described the behaviour
// that caused the defect, and is replaced below.

test("an invalid setConfig leaves the running gesture completely untouched", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 1);
  const pointerBefore = el._interaction.pointer;

  assert.throws(() => el.setConfig({ entity: "" })); // invalid: no current-value source remains

  assert.equal(el._interaction.pointer, pointerBefore, "a rejected configuration must not end the gesture");
  assert.equal(el._isDragging, true, "the drag is still in progress; nothing about it changed");
  env.cleanup(el);
});

test("a render deferred by a drag survives an invalid setConfig and is settled by the pointerup", () => {
  // The reported sequence, end to end. Nothing here reconnects the card and nothing
  // pushes a second hass: the only thing that may settle the debt is the gesture ending,
  // which is exactly what the old ordering destroyed.
  const el = threeViewCard();
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /22/);

  beginConfirmedDrag(el, 1);
  el.hass = states(30);
  assert.equal(el._renderController.isRenderPending, true, "the mid-drag update is deferred");
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /22/);

  assert.throws(() => el.setConfig({ range_entity: "sensor.range" }), /entity/i);

  // Nothing was consumed by the rejected call.
  assert.equal(el._renderController.isRenderPending, true, "the debt is still owed");
  assert.equal(el._isDragging, true, "and the gesture that will pay it is still alive");
  assert.equal(el._config.entity, "sensor.avg", "the last valid configuration is untouched");

  endDrag(el, -4); // a tiny move: the gesture ends without committing a swipe
  assert.match(
    el.shadowRoot.querySelector(".rtc-avg-value-num").textContent,
    /30/,
    "ending the gesture must apply the update received during it"
  );
  assert.equal(el._renderController.isRenderPending, false);
  env.cleanup(el);
});

test("a pointercancel settles the debt just as well after a rejected setConfig", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 1);
  el.hass = states(30);
  assert.throws(() => el.setConfig({ entity: 42 }));

  cancelDrag(el);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);
  assert.equal(el._renderController.isRenderPending, false);
  env.cleanup(el);
});

test("an invalid setConfig with no interaction leaves configuration, DOM and signatures intact", () => {
  const el = threeViewCard();
  const configBefore = el._config;
  const markupBefore = el.shadowRoot.innerHTML;

  assert.throws(() => el.setConfig({ rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r1" }] }));

  assert.equal(el._config, configBefore, "the previous configuration object is still installed, not partially replaced");
  assert.equal(el.shadowRoot.innerHTML, markupBefore, "nothing was re-rendered");
  // The signature was not invalidated either: an unchanged card still skips.
  assert.equal(el._render(), RENDER_PATH.SKIPPED, "a rejected config must not force a pointless re-render later");
  env.cleanup(el);
});

test("an invalid setConfig does not disturb a pending resume or the carousel", () => {
  const el = threeViewCard();
  beginConfirmedDrag(el, 1);
  endDrag(el, -200); // a committed swipe arms the phase-aware resume
  const resumeBefore = el._carousel.resumeTimerHandle;
  const activeBefore = el._activeView;
  assert.notEqual(resumeBefore, null);

  assert.throws(() => el.setConfig({ entity: null, rooms: [] }));

  assert.equal(el._carousel.resumeTimerHandle, resumeBefore, "the pending resume must survive a rejected configuration");
  assert.equal(el._activeView, activeBefore);
  env.cleanup(el);
});

test("a valid setConfig mid-drag still settles the gesture exactly as before", () => {
  // The strong-exception-safety rewrite must not weaken the accepted path: a VALID
  // configuration still aborts the drag, snaps the track and schedules the resume.
  const el = threeViewCard();
  beginConfirmedDrag(el, 2);
  el._activeView = 0; // stale

  el.setConfig({ ...BASE_CONFIG, entity_label: "Custom" });

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  assert.equal(el._activeView, 2, "resolved from the frozen drag position");
  assert.notEqual(el._carousel.resumeTimerHandle, null, "and a phase-aware resume is scheduled");
  env.cleanup(el);
});

test("setConfig mid-drag resolves each frozen track position to the correct view", () => {
  const el = threeViewCard();
  for (let targetIndex = 0; targetIndex <= 2; targetIndex++) {
    beginConfirmedDrag(el, targetIndex, { pointerId: 7 });
    el._activeView = (targetIndex + 1) % 3; // deliberately stale/wrong
    el.setConfig({ ...BASE_CONFIG, entity_label: `pass-${targetIndex}` });
    assert.equal(el._activeView, targetIndex);
  }
  env.cleanup(el);
});

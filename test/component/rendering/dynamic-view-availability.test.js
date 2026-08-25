"use strict";

// Start-view preservation and dynamic view availability. _renderAll()'s fallback cascade
// (previously visible key -> start_view -> first active view -> null
// state), the timer self-cleanup in _scheduleAccessibilitySync()/
// _resumeSynchronizedSlideWhenAligned(), and the mid-drag deferred-render
// deferral must behave identically for setConfig()-driven and hass-driven
// structural changes. These tests cover both paths.

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

function threeViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
}

function threeViewCard(extraConfig) {
  return env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], ...extraConfig },
    threeViewHass()
  );
}

function withMockedNow(fixedMs, fn) {
  const original = env.window.Date.now;
  env.window.Date.now = () => fixedMs;
  try {
    return fn();
  } finally {
    env.window.Date.now = original;
  }
}

// ---- previousActiveKey must use the old timing definition,
// never the new rotation_seconds/slide_seconds a live setConfig() is about
// to install. ----

test("a live rotation_seconds/slide_seconds change preserves the view visible under the old timing", () => {
  // 3 views -> holdSequence positions = [0,1,2,1], length 4.
  // OLD (10s hold / 2s slide): segMs=12000, cycleMs=48000. At phaseMs=29000
  // (segment index 2, well inside its hold, before the flip point at
  // holdMs+slideMs/2=11000ms into the segment) the visible position is
  // positions[2] = view index 2.
  // NEW (3s hold / 1s slide): segMs=4000, cycleMs=16000. At the SAME
  // absolute instant, phaseMs=29000%16000=13000 -> segment index 3,
  // subPhase=1000 (before its own flip point at 3500ms) -> positions[3] = 1.
  // The two configs genuinely disagree on which view is visible at this
  // instant -- exactly what exposes the bug.
  withMockedNow(29000, () => {
    const el = threeViewCard({ rotation_seconds: 10, slide_seconds: 2 });
    assert.equal(el._views.length, 3, "range, scale, extremes");
    const track = el.shadowRoot.querySelector(".rtc-track");
    assert.equal(track.classList.contains("rtc-manual"), false, "must still be auto-engaged (no manual swipe happened)");
    assert.equal(el._currentVisualViewIndex(), 2, "sanity check: OLD config must actually resolve to view index 2 at this mocked instant");

    el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], rotation_seconds: 3, slide_seconds: 1 });

    assert.equal(el._views[el._activeView], el._views[2], "the view visible under the OLD 10s/2s timing (index 2) must be preserved, not the view the NEW 3s/1s timing would compute (index 1)");
    env.cleanup(el);
  });
});

// ---- An in-flight but not yet classified pointer gesture
// (pointerdown happened, drag threshold never crossed) must not survive a
// structural rebuild triggered by a pure hass update. ----

test("a bare pointerdown is invalidated by a hass-driven structural rebuild", () => {
  const el = threeViewCard();
  el._handlePointerDown({ pointerId: 1, button: 0, clientX: 100, clientY: 50 });
  assert.ok(el._interaction.pointer, "sanity check: pointerdown must register");
  assert.equal(el._isDragging, false, "sanity check: must not have crossed the drag threshold");

  // Pure hass-driven structural change (no setConfig()): rooms drop from 2
  // to 1, changing roomsComparable / view composition.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });

  assert.equal(el._interaction.pointer, null, "the stale pointer-down must be cleared by the structural rebuild, not carried over with pre-rebuild geometry");
  const activeViewAfterRebuild = el._activeView;

  // The same physical touch releasing afterwards must be a safe no-op (the
  // !this._interaction.pointer guard in _handlePointerUp() short-circuits it) rather
  // than computing a swipe from stale pre-rebuild geometry.
  assert.doesNotThrow(() => el._handlePointerUp({ pointerId: 1, clientX: 100, clientY: 50 }));
  assert.equal(el._activeView, activeViewAfterRebuild, "a pointerup on an already-invalidated pointer must not change _activeView");
  env.cleanup(el);
});

test("a bare pointerdown does not block accessibility resync after a hass-driven structural rebuild", () => {
  const el = threeViewCard();
  el._handlePointerDown({ pointerId: 1, button: 0, clientX: 100, clientY: 50 });

  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });

  // Still 3 views (>=2) after this rebuild -> _applyAutoSlideStyles() must
  // have run to completion and (re-)armed the a11y sync timer; before the
  // fix it bailed out early because this._interaction.pointer was still truthy.
  assert.equal(el._views.length, 3);
  assert.notEqual(el._carousel.accessibilityTimerHandle, null, "_scheduleAccessibilitySync() must have re-armed, proving _applyAutoSlideStyles() wasn't blocked by the stale pointer");
  env.cleanup(el);
});

// ---- Hass-driven availability changes ----

test("a live availability cycle preserves a still-existing view without an extra jump", () => {
  const el = threeViewCard();
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"]);
  el._activeView = el._views.indexOf("scale");
  // Freeze the track into manual mode so _currentVisualViewIndex() (which
  // _renderAll() uses to determine the "previously visible" view) reads
  // this._activeView deterministically instead of the wall-clock auto-slide
  // phase -- without this, the real time elapsed between the two hass
  // updates below could make the actually-visible view drift away from
  // whatever this._activeView was set to, making the test non-deterministic.
  el._updateTrackTransform(false);

  // range_entity becomes unavailable -> "range" view disappears.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"], "range must be gone");
  assert.equal(el._views[el._activeView], "scale", "the still-existing previously-active view must be preserved");

  // The first _renderAll() above re-engaged auto-slide (_applyAutoSlideStyles()
  // removes "rtc-manual" whenever there's no pending resume) -- re-freeze
  // before the second update for the same determinism reason as above.
  el._updateTrackTransform(false);

  // range_entity comes back -> "range" reappears.
  el.hass = threeViewHass();
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"]);
  assert.equal(el._views[el._activeView], "scale", "must stay on the still-active view, no extra jump just because a different view reappeared");
  env.cleanup(el);
});

test("a live change falls back to the first active view when the previous and start views disappear", () => {
  const el = threeViewCard({ start_view: "extremes" });
  el._activeView = el._views.indexOf("range");
  el._updateTrackTransform(false); // deterministic previousActiveKey, see the round-trip test above

  // range_entity AND rooms both drop out in the same update -> "range"
  // (the previous key) and "extremes" (start_view) are both gone at once;
  // only "scale" is left.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), ["scale"], "range and extremes must both be gone, leaving only scale");
  assert.equal(el._activeView, 0, "falls through to the first (only) remaining active view once both the previous key and start_view are gone");
  env.cleanup(el);
});

test("an available start_view wins over index 0 when the active view disappears", () => {
  // Deliberately start_view:"extremes", NOT "scale" -- "scale" would be
  // index 0 of the post-change views list regardless of start_view, which
  // wouldn't distinguish "start_view was consulted" from "index-0 fallback
  // happened to land there anyway". "extremes" ends up at index 1, so only
  // an actual start_view lookup (not a coincidental index-0 match) can
  // produce it.
  const el = threeViewCard({ start_view: "extremes" });
  el._activeView = el._views.indexOf("range");
  el._updateTrackTransform(false); // deterministic previousActiveKey, see the round-trip test above

  // Only range_entity disappears; rooms (hence "extremes") survive.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"]);
  assert.equal(el._views[el._activeView], "extremes", "start_view must be consulted and win over the coincidental index-0 fallback ('scale')");
  env.cleanup(el);
});

// ---- Dropping to fewer than two active views renders a track-less solo/empty
// layout (no ".rtc-track" element at all -- see the render template's
// `data.views.length >= 2 ? <rotator+track> : ...`). _applyAutoSlideStyles()
// bails out on its very first line when there's no track
// (`if (!track || ...) return;`), which means it never reaches
// _scheduleAccessibilitySync() -- the ONLY place that clears
// this._carousel.accessibilityTimerHandle. A timer armed while >=2 views were active is left
// with a stale (though harmless once it eventually fires and self-corrects)
// handle instead of being cleared immediately, violating "Timer nur ab
// zwei aktiven Views" for the window until it fires. ----

test("timers remain safe over a live 2-view -> 1-view -> 2-view cycle", () => {
  const hassTwoViews = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hassTwoViews);
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"]);
  assert.notEqual(el._carousel.accessibilityTimerHandle, null, "auto-slide must be engaged with 2 views");

  // Rooms disappear -> "extremes" gone -> only "scale" left (1 view).
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), ["scale"]);
  assert.equal(el._carousel.resumeTimerHandle, null, "no resume timer may linger with <2 active views");
  assert.equal(el._carousel.accessibilityTimerHandle, null, "no a11y sync timer may linger with <2 active views");

  // Rooms come back -> 2 views again -> schedule a resume instead of synchronizing
  // immediately because a non-first rebuild freezes visually first. _a11ySyncTimer
  // itself only gets
  // (re-)armed once that scheduled resume actually fires and hands off to
  // _applyAutoSlideStyles() -- checking that exact hand-off isn't this
  // test's concern; only scheduling and absence of abandoned timers matter here.
  el.hass = hassTwoViews;
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"]);
  assert.notEqual(el._carousel.resumeTimerHandle, null, "a phase-aware resume must be scheduled once >=2 views are active again");
  env.cleanup(el);
});

// previousActiveKey/_activeView must be reflected in the rendered track, not only
// preserved as JavaScript bookkeeping. Every non-first, non-empty rebuild freezes
// visually on the resolved _activeView before scheduling a phase-aware resume; an
// immediate synchronized animation could otherwise jump to the ambient phase.

test("a non-first structural rebuild freezes visually on the resolved view instead of jumping to the ambient auto-slide phase", () => {
  const el = threeViewCard();
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), false, "sanity check: the very first render engages synced auto-slide directly, no freeze");

  // Pure hass-driven structural change (no setConfig()), NOT the first render.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const trackAfter = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(trackAfter.classList.contains("rtc-manual"), true, "a non-first rebuild must freeze the track visually on _activeView, not immediately re-engage the wall-clock-driven synced animation");
  assert.notEqual(el._carousel.resumeTimerHandle, null, "a phase-aware resume back into sync must be scheduled");
  env.cleanup(el);
});

test("setConfig() leaves a structural rebuild frozen until its phase-aware resume", () => {
  const el = threeViewCard();
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }] }); // rooms drop to 1 -> "extremes" gone, structural change, not first render
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), true, "must stay frozen after setConfig() -- a trailing _restartRotation() must not immediately re-engage sync and undo the freeze");
  env.cleanup(el);
});

// ---- The pre-config visual snapshot is
// taken before this._render(false) runs and released AFTER it -- if _render()
// (or anything it calls) throws and the release is not in a finally, the stash
// survives and leaks into a later, unrelated hass-driven rebuild. ----

test("the pre-config visual snapshot is released even if _render() throws mid-setConfig()", () => {
  const el = threeViewCard();
  const originalRender = el._render;
  el._render = () => {
    throw new Error("simulated render failure");
  };
  assert.throws(() => el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range" }), /simulated render failure/, "setConfig() must still propagate the error -- HA's config-validation contract must not be swallowed");
  el._render = originalRender;

  // The snapshot is private to the controller, so the leak is proven by its effect
  // instead: a later hass-driven structural rebuild must resolve its active view from
  // what is actually on screen, not from a stale snapshot of a previous config. With
  // the release outside a finally, the stashed key would win here.
  const stillMounted = Array.from(el._views);
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), stillMounted.filter((key) => key !== "extremes"), "dropping to one room removes the extremes view");
  assert.ok(el._views.includes(el._views[el._activeView]), "the resolved active view must be one that actually exists");
  env.cleanup(el);
});

test("a hass-driven structural change arriving mid-drag is applied after the drag ends", () => {
  const el = threeViewCard();
  // A real gesture through the handlers, so the test keeps its meaning without a
  // writable window into the interaction runtime.
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown({ pointerId: 7, button: 0, isPrimary: true, clientX: 0, clientY: 0, composedPath: () => [rotator] });
  el._handlePointerMove({ pointerId: 7, clientX: -60, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(el._isDragging, true, "the drag is live");

  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.equal(el._renderController.isRenderPending, true, "the structural update must be deferred, not applied mid-drag");
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"], "the OLD structure must still be mounted while the drag is in progress");

  el._handlePointerUp({ pointerId: 7, clientX: 0, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} });

  assert.deepEqual(Array.from(el._views), ["scale", "extremes"], "the deferred structural change must be applied once the drag ends");
  assert.equal(el._renderController.isRenderPending, false);
  env.cleanup(el);
});

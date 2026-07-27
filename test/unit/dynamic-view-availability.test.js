"use strict";

// AP-07 (audit sections 14.1, 14.2, 14.5): startview preservation and
// dynamic view-availability changes. _renderAll()'s fallback cascade
// (previously visible key -> start_view -> first active view -> null
// state), the timer self-cleanup in _scheduleAccessibilitySync()/
// _resumeSynchronizedSlideWhenAligned(), and the mid-drag _renderPending
// deferral were all already correct BEFORE this file existed -- but only
// ever exercised via the setConfig()-triggered structural-change path.
// 14.2 explicitly requires availability to change WITHOUT a config change
// (a pure `hass` update) to behave the same way, and that path was
// completely untested -- which is exactly where two real bugs lived,
// invisible via setConfig()-driven tests alone (see the two "Bug"-labeled
// tests below). Everything else in this file is new coverage for
// already-correct behavior, added because it was previously only proven
// for the setConfig() path.

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

// ---- Bug A (14.1): previousActiveKey must use the OLD timing definition,
// never the new rotation_seconds/slide_seconds a live setConfig() is about
// to install. ----

test("AP-07 Bug A: a live rotation_seconds/slide_seconds change preserves the view visible under the OLD timing, not what the NEW timing would compute", () => {
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

// ---- Bug B (14.2): an in-flight-but-not-yet-classified pointer gesture
// (pointerdown happened, drag threshold never crossed) must not survive a
// structural rebuild triggered by a pure hass update. ----

test("AP-07 Bug B: a bare pointerdown (no drag yet) is invalidated by a hass-driven structural rebuild, and a later pointerup on it is a safe no-op", () => {
  const el = threeViewCard();
  el._handlePointerDown({ pointerId: 1, button: 0, clientX: 100, clientY: 50 });
  assert.ok(el._pointer, "sanity check: pointerdown must register");
  assert.equal(el._isDragging, false, "sanity check: must not have crossed the drag threshold");

  // Pure hass-driven structural change (no setConfig()): rooms drop from 2
  // to 1, changing hasRoomsView / view composition.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
  });

  assert.equal(el._pointer, null, "the stale pointer-down must be cleared by the structural rebuild, not carried over with pre-rebuild geometry");
  const activeViewAfterRebuild = el._activeView;

  // The same physical touch releasing afterwards must be a safe no-op (the
  // !this._pointer guard in _handlePointerUp() short-circuits it) rather
  // than computing a swipe from stale pre-rebuild geometry.
  assert.doesNotThrow(() => el._handlePointerUp({ pointerId: 1, clientX: 100, clientY: 50 }));
  assert.equal(el._activeView, activeViewAfterRebuild, "a pointerup on an already-invalidated pointer must not change _activeView");
  env.cleanup(el);
});

test("AP-07 Bug B: a bare pointerdown no longer blocks accessibility resync after a hass-driven structural rebuild", () => {
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
  // fix it bailed out early because this._pointer was still truthy.
  assert.equal(el._views.length, 3);
  assert.notEqual(el._a11ySyncTimer, null, "_scheduleAccessibilitySync() must have re-armed, proving _applyAutoSlideStyles() wasn't blocked by the stale pointer");
  env.cleanup(el);
});

// ---- Already-correct behavior (audit 14.5), now proven over the
// previously-untested hass-driven (non-setConfig()) trigger path. ----

test("AP-07: live availability change (available -> unavailable -> available, no setConfig()) preserves the still-existing view and causes no extra jump on reappearance", () => {
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

test("AP-07: falls all the way to the first remaining active view when BOTH the previous key and start_view disappear via a live change", () => {
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

test("AP-07: start_view (still available) wins over the plain index-0 fallback when only the active view disappears via a live change", () => {
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

// ---- Bug C (14.2, found while writing the "already correct" coverage
// below): dropping to <2 active views renders a track-less solo/empty
// layout (no ".rtc-track" element at all -- see the render template's
// `data.views.length >= 2 ? <rotator+track> : ...`). _applyAutoSlideStyles()
// bails out on its very first line when there's no track
// (`if (!track || ...) return;`), which means it never reaches
// _scheduleAccessibilitySync() -- the ONLY place that clears
// this._a11ySyncTimer. A timer armed while >=2 views were active is left
// with a stale (though harmless once it eventually fires and self-corrects)
// handle instead of being cleared immediately, violating "Timer nur ab
// zwei aktiven Views" for the window until it fires. ----

test("AP-07 Bug C: timer safety over a full live 2-views -> 1-view -> 2-views cycle", () => {
  const hassTwoViews = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  const el = env.createCard({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, hassTwoViews);
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"]);
  assert.notEqual(el._a11ySyncTimer, null, "auto-slide must be engaged with 2 views");

  // Rooms disappear -> "extremes" gone -> only "scale" left (1 view).
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.deepEqual(Array.from(el._views), ["scale"]);
  assert.equal(el._resumeAutoTimer, null, "no resume timer may linger with <2 active views");
  assert.equal(el._a11ySyncTimer, null, "no a11y sync timer may linger with <2 active views");

  // Rooms come back -> 2 views again -> a resume must be SCHEDULED (not an
  // immediate resync -- see the P1 fix below: a non-first-render rebuild
  // always freezes visually first). _a11ySyncTimer itself only gets
  // (re-)armed once that scheduled resume actually fires and hands off to
  // _applyAutoSlideStyles() -- checking that exact hand-off isn't this
  // test's concern (see the P1 tests below), just that a resume was
  // scheduled at all and no timer is simply abandoned.
  el.hass = hassTwoViews;
  assert.deepEqual(Array.from(el._views), ["scale", "extremes"]);
  assert.notEqual(el._resumeAutoTimer, null, "a phase-aware resume must be scheduled once >=2 views are active again");
  env.cleanup(el);
});

// ---- Reviewer finding (P1, post-AP-07): previousActiveKey/_activeView was
// correctly PRESERVED (AP-07 fix) but that was only ever a JS bookkeeping
// value -- _renderAll()'s non-pending-resume branch called
// _applyAutoSlideStyles(), which re-engages the wall-clock-driven synced
// CSS animation immediately, completely ignoring _activeView. The
// preserved view could be shown for zero time before the ambient auto-slide
// phase (computed fresh against whatever the CURRENT view count/timing is)
// jumped to something else entirely. setConfig()'s trailing
// _restartRotation() call made this worse by undoing even the one case
// that WAS handled correctly (hadPendingResume). Fix: every non-first-render,
// non-empty rebuild now freezes visually on the resolved _activeView first
// (matching what only the hadPendingResume branch used to do), then
// schedules a phase-aware resume -- exactly the AP-07 acceptance criterion
// ("keine Sprünge") applied to the case that was actually missing it.

test("P1 fix: a non-first structural rebuild freezes visually on the resolved view instead of jumping to the ambient auto-slide phase", () => {
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
  assert.notEqual(el._resumeAutoTimer, null, "a phase-aware resume back into sync must be scheduled");
  env.cleanup(el);
});

test("P1 fix: setConfig() no longer undoes the freeze via a trailing _restartRotation()", () => {
  const el = threeViewCard();
  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }] }); // rooms drop to 1 -> "extremes" gone, structural change, not first render
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), true, "must stay frozen after setConfig() -- a trailing _restartRotation() must not immediately re-engage sync and undo the freeze");
  env.cleanup(el);
});

// ---- Reviewer finding (P2, post-AP-07): this._preConfigChangeVisualKey is
// set before this._render(false) runs and cleared by a plain statement
// AFTER it -- if _render() (or anything it calls) throws, that cleanup
// statement is skipped and the stash survives, ready to leak into a later,
// unrelated hass-driven rebuild. ----

test("P2 fix: this._preConfigChangeVisualKey is cleared even if _render() throws mid-setConfig()", () => {
  const el = threeViewCard();
  const originalRender = el._render;
  el._render = () => {
    throw new Error("simulated render failure");
  };
  assert.throws(() => el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range" }), /simulated render failure/, "setConfig() must still propagate the error -- HA's config-validation contract must not be swallowed");
  el._render = originalRender;
  assert.equal(el._preConfigChangeVisualKey, undefined, "the snapshot must be cleared even though _render() threw, or it would leak into a later, unrelated rebuild");
  env.cleanup(el);
});

test("AP-07: a hass update carrying a structural (view-availability) change that arrives mid-drag is deferred and correctly applied once the drag ends", () => {
  const el = threeViewCard();
  el._pointer = { id: 7, x: 0, y: 0, time: Date.now(), rotator: true, entityTarget: null, startTranslate: -el._activeView * el._viewWidthPct(), dragging: true, width: 300 };
  el._isDragging = true;

  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 21, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r2": mkState("sensor.r2", 23, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
  assert.equal(el._renderPending, true, "the structural update must be deferred, not applied mid-drag");
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"], "the OLD structure must still be mounted while the drag is in progress");

  el._handlePointerUp({ pointerId: 7, clientX: 0, clientY: 0, preventDefault: () => {}, stopPropagation: () => {} });

  assert.deepEqual(Array.from(el._views), ["scale", "extremes"], "the deferred structural change must be applied once the drag ends");
  assert.equal(el._renderPending, false);
  env.cleanup(el);
});

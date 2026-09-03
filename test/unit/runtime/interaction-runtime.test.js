"use strict";

// Direct tests for the interaction and action controllers. Gesture maths is a pure function
// of numbers and the runtime takes a fake carousel, so a failure names the threshold rule
// rather than rendered-card setup. The thresholds asserted below are the card's feel, pinned
// so they stay stable across implementation changes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { createFakePlatform } = require("../../helpers/fake-platform.js");

let logic;
let interaction;
let actions;

test.before(async () => {
  logic = await import("../../../src/controllers/runtime/interaction-logic.js");
  interaction = await import("../../../src/controllers/runtime/interaction-runtime.js");
  actions = await import("../../../src/controllers/runtime/action-runtime.js");
});

// ------------------------------------------------------------- pure logic ----

test("the direction threshold is 10px AND a 1.25 horizontal-to-vertical ratio", () => {
  assert.equal(logic.SWIPE_DIRECTION_MIN_PX, 10);
  assert.equal(logic.SWIPE_DIRECTION_RATIO, 1.25);

  assert.equal(logic.isHorizontalSwipe(9, 0), false, "under the minimum distance");
  assert.equal(logic.isHorizontalSwipe(10, 0), true, "exactly at it");
  assert.equal(logic.isHorizontalSwipe(-40, 0), true, "direction is irrelevant");
  // The ratio protects vertical dashboard scrolling from a diagonal flick, and it is a
  // strict comparison: exactly at the ratio is not horizontal enough.
  assert.equal(logic.isHorizontalSwipe(20, 16), false, "20 > 16 * 1.25 is false — they are equal");
  assert.equal(logic.isHorizontalSwipe(21, 16), true, "a hair more horizontal is a swipe");
  assert.equal(logic.isHorizontalSwipe(50, 30), true);
  assert.equal(logic.isHorizontalSwipe(30, 50), false, "mostly vertical is never a swipe");
});

test("the drag offset follows the finger and is capped at one view in each direction", () => {
  assert.equal(logic.dragOffsetPct(-150, 300, 33), -16.5, "half a rotator width is half a view");
  assert.equal(logic.dragOffsetPct(-3000, 300, 33), -33, "a fast flick cannot fling past the neighbour");
  assert.equal(logic.dragOffsetPct(3000, 300, 33), 33);
  assert.equal(logic.dragOffsetPct(0, 300, 33), 0);
});

test("the commit threshold is 18% of the rotator, and a committed swipe moves exactly one view", () => {
  assert.equal(logic.SWIPE_COMMIT_FRACTION, 0.18);
  const base = { pointerWidthPx: 300, startTranslate: 0, viewWidthPct: 100 / 3, maxIndex: 2, maxTrackOffsetPct: -200 / 3 };

  assert.equal(logic.resolveSwipeTarget({ ...base, dx: -54 }), 1, "exactly at the threshold commits");
  assert.equal(logic.resolveSwipeTarget({ ...base, dx: -53 }), 0, "one pixel short snaps back");
  assert.equal(logic.resolveSwipeTarget({ ...base, dx: -280 }), 1, "a huge drag still moves exactly one");

  const fromLast = { ...base, startTranslate: -200 / 3 };
  assert.equal(logic.resolveSwipeTarget({ ...fromLast, dx: 54 }), 1, "backwards, one view");
  assert.equal(logic.resolveSwipeTarget({ ...fromLast, dx: -54 }), 2, "and never past the last view");
  assert.equal(logic.resolveSwipeTarget({ ...base, dx: 54 }), 0, "nor before the first");
});

test("a sub-threshold drag snaps to the nearest view, not back to where it started", () => {
  const base = { pointerWidthPx: 300, viewWidthPct: 100 / 3, maxIndex: 2, maxTrackOffsetPct: -200 / 3 };
  // Frozen most of the way to view 1 by a synchronized slide, then nudged a little.
  assert.equal(logic.resolveSwipeTarget({ ...base, startTranslate: -30, dx: -10 }), 1);
  assert.equal(logic.resolveSwipeTarget({ ...base, startTranslate: -5, dx: -10 }), 0);
});

test("the view index always comes from the frozen translate, clamped to the real range", () => {
  assert.equal(logic.viewIndexFromTranslate(0, 100 / 3, 2), 0);
  assert.equal(logic.viewIndexFromTranslate(-100 / 3, 100 / 3, 2), 1);
  assert.equal(logic.viewIndexFromTranslate(-1000, 100 / 3, 2), 2, "clamped to the last view");
  assert.equal(logic.viewIndexFromTranslate(1000, 100 / 3, 2), 0);
});

test("a press that moved more than 12px is no longer a tap", () => {
  assert.equal(logic.TAP_CANCEL_PX, 12);
  assert.equal(logic.isTapCancelledByMovement(12, 0), false, "exactly at the limit is still a tap");
  assert.equal(logic.isTapCancelledByMovement(13, 0), true);
  assert.equal(logic.isTapCancelledByMovement(0, 13), true, "vertical counts too");
});

test("tap versus hold is decided at the configured hold duration", () => {
  assert.equal(logic.resolveTapOrHold(0.4, 0.5), "tap");
  assert.equal(logic.resolveTapOrHold(0.5, 0.5), "hold", "exactly at the duration is a hold");
  assert.equal(logic.resolveTapOrHold(2, 0.5), "hold");
});

test("the click suppression window is 450ms", () => {
  assert.equal(logic.CLICK_SUPPRESSION_MS, 450);
});

// -------------------------------------------------------------- fixtures ----

// A carousel stand-in that records what it was asked to do; the interaction runtime never
// touches the DOM itself, so everything it needs shows up here.
function fakeCarousel({ viewCount = 3, trackManual = false } = {}) {
  const calls = [];
  return {
    calls,
    activeIndex: 0,
    viewKeys: Array.from({ length: viewCount }, (_, index) => `view${index}`),
    viewWidthPct: () => 100 / viewCount,
    maxTrackOffsetPct: () => -((viewCount - 1) * 100) / viewCount,
    isTrackManual: () => trackManual,
    freezeTrackAtCurrentPosition() {
      calls.push("freeze");
      return -this.activeIndex * (100 / viewCount);
    },
    setTrackTranslate: (pct) => calls.push(`translate:${Math.round(pct)}`),
    setTrackTransition: (on) => calls.push(`transition:${on}`),
    updateTrackTransform: (on) => calls.push(`transform:${on}`),
    scheduleAccessibilitySync: () => calls.push("a11y"),
    resumeWhenAligned: (index, delay) => calls.push(`resumeAligned:${index}:${delay}`),
    resumeAfterInteraction: (delay) => calls.push(`resume:${delay}`),
    stop: () => calls.push("stop"),
  };
}

function makeRuntime({ carousel = fakeCarousel(), platform = createFakePlatform(), swipeEnabled = true, holdSeconds = 0.5, rotatorWidth = 300, entityTarget = null } = {}) {
  const fired = [];
  const renders = [];
  const runtime = interaction.createInteractionRuntime({
    platform,
    carousel,
    findInPath: (event, selector) => (selector === "[data-entity]" ? event.__entity ?? entityTarget : event.__rotator ?? null),
    getRotator: (event) => (event.__rotator ? { getBoundingClientRect: () => ({ width: rotatorWidth }) } : null),
    isSwipeEnabled: () => swipeEnabled,
    getHoldSeconds: () => holdSeconds,
    fireAction: (target, action) => fired.push(action),
    requestRender: (info) => renders.push(info),
  });
  return { runtime, carousel, platform, fired, renders };
}

const noop = () => {};
const down = (extra = {}) => ({ pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0, __rotator: true, ...extra });
const move = (dx, dy = 0, extra = {}) => ({ pointerId: 1, clientX: dx, clientY: dy, preventDefault: noop, stopPropagation: noop, ...extra });
const up = (dx, dy = 0, extra = {}) => ({ pointerId: 1, clientX: dx, clientY: dy, preventDefault: noop, stopPropagation: noop, ...extra });

// ---------------------------------------------------- the runtime, wired ----

test("a pointerdown records the gesture but deliberately does not pause the animation", () => {
  const { runtime, carousel } = makeRuntime();
  runtime.handlePointerDown(down());
  assert.equal(runtime.pointer.rotator, true);
  assert.equal(runtime.pointer.width, 300);
  assert.equal(runtime.isDragging, false);
  assert.deepEqual(carousel.calls, [], "pausing here would jump on a pointercancel");
});

test("a non-primary or secondary-button pointerdown is ignored", () => {
  const { runtime } = makeRuntime();
  runtime.handlePointerDown(down({ button: 2 }));
  assert.equal(runtime.pointer, null);
  runtime.handlePointerDown(down({ isPrimary: false }));
  assert.equal(runtime.pointer, null);
});

test("swipe:false makes a rotator pointerdown behave like one outside the rotator", () => {
  const { runtime, carousel } = makeRuntime({ swipeEnabled: false });
  runtime.handlePointerDown(down());
  assert.equal(runtime.pointer.rotator, false);
  runtime.handlePointerMove(move(-200));
  assert.equal(runtime.isDragging, false);
  assert.deepEqual(carousel.calls, [], "no drag, no track manipulation");
});

test("confirming a horizontal drag freezes the track and clears any pending resume, exactly once", () => {
  const { runtime, carousel } = makeRuntime();
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-4, 0));
  assert.deepEqual(carousel.calls, [], "under the threshold, nothing happens");

  runtime.handlePointerMove(move(-40, 0));
  assert.equal(runtime.isDragging, true);
  assert.deepEqual(carousel.calls.slice(0, 2), ["freeze", "stop"]);

  const before = carousel.calls.length;
  runtime.handlePointerMove(move(-60, 0));
  assert.ok(!carousel.calls.slice(before).includes("freeze"), "the freeze happens once per gesture");
  assert.ok(carousel.calls.slice(before).some((call) => call.startsWith("translate:")));
});

test("a vertical drag inside the rotator never becomes a swipe", () => {
  const { runtime, carousel } = makeRuntime();
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(8, 60));
  assert.equal(runtime.isDragging, false);
  assert.deepEqual(carousel.calls, []);
});

test("a completed swipe moves one view, settles the track and schedules one aligned resume", () => {
  const { runtime, carousel, renders } = makeRuntime();
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  runtime.handlePointerUp(up(-200));

  assert.equal(carousel.activeIndex, 1);
  assert.equal(runtime.isDragging, false);
  assert.equal(runtime.pointer, null);
  assert.deepEqual(carousel.calls.slice(-4), ["transition:true", "transform:true", "a11y", "resumeAligned:1:10000"]);
  assert.deepEqual(renders, [{ viewChanged: true }]);
});

test("a sub-threshold swipe snaps back and reports no view change", () => {
  const { runtime, carousel, renders } = makeRuntime();
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  runtime.handlePointerUp(up(-20));
  assert.equal(carousel.activeIndex, 0);
  assert.deepEqual(renders, [{ viewChanged: false }]);
});

test("a tap fires exactly one action and suppresses the synthesized click for 450ms", () => {
  const platform = createFakePlatform();
  const { runtime, fired } = makeRuntime({ platform });
  runtime.handlePointerDown(down({ __rotator: null, __entity: { dataset: { entity: "sensor.x" } } }));
  runtime.handlePointerUp(up(0, 0, { __entity: { dataset: { entity: "sensor.x" } } }));
  assert.deepEqual(fired, ["tap"]);

  // The click the browser synthesizes right afterwards must do nothing.
  runtime.handleClick({ __entity: { dataset: { entity: "sensor.x" } }, preventDefault: noop, stopPropagation: noop });
  assert.deepEqual(fired, ["tap"], "no second action");

  platform.setNow(platform.now() + 451);
  runtime.handleClick({ __entity: { dataset: { entity: "sensor.x" } }, preventDefault: noop, stopPropagation: noop });
  assert.deepEqual(fired, ["tap", "tap"], "and a genuinely later click works again");
});

test("a long press fires hold, a short one fires tap", () => {
  const platform = createFakePlatform();
  const entity = { dataset: { entity: "sensor.x" } };
  const { runtime, fired } = makeRuntime({ platform, holdSeconds: 0.5 });
  runtime.handlePointerDown(down({ __rotator: null, __entity: entity }));
  platform.setNow(platform.now() + 600);
  runtime.handlePointerUp(up(0, 0, { __entity: entity }));
  assert.deepEqual(fired, ["hold"]);

  const quick = makeRuntime({ platform: createFakePlatform(), holdSeconds: 0.5 });
  quick.runtime.handlePointerDown(down({ __rotator: null, __entity: entity }));
  quick.runtime.handlePointerUp(up(0, 0, { __entity: entity }));
  assert.deepEqual(quick.fired, ["tap"]);
});

test("a press that drifted more than 12px fires nothing but still swallows the click", () => {
  const entity = { dataset: { entity: "sensor.x" } };
  const { runtime, fired, platform } = makeRuntime();
  runtime.handlePointerDown(down({ __rotator: null, __entity: entity }));
  runtime.handlePointerUp(up(20, 0, { __entity: entity }));
  assert.deepEqual(fired, [], "it was a drag, not a tap");
  assert.ok(runtime.suppressClickUntil > platform.now());
});

test("a tap inside the rotator resumes only when the track is genuinely manual", () => {
  const notManual = makeRuntime({ carousel: fakeCarousel({ trackManual: false }) });
  notManual.runtime.handlePointerDown(down());
  notManual.runtime.handlePointerUp(up(0));
  assert.ok(!notManual.carousel.calls.some((call) => call.startsWith("resume")), "a tap never detached the track");

  const manual = makeRuntime({ carousel: fakeCarousel({ trackManual: true }) });
  manual.runtime.handlePointerDown(down());
  manual.runtime.handlePointerUp(up(0));
  assert.ok(manual.carousel.calls.includes("resume:0"), "an earlier swipe had, so rejoin phase-aware");
});

test("a pointercancel mid-drag settles on the frozen position, not on the pre-gesture index", () => {
  const carousel = fakeCarousel();
  carousel.activeIndex = 0;
  const { runtime, renders } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  // A cancel must land where the track actually is, read from the frozen translate.
  runtime.pointer.startTranslate = -100 / 3;
  runtime.handlePointerCancel({ pointerId: 1 });

  assert.equal(carousel.activeIndex, 1);
  assert.equal(runtime.isDragging, false);
  assert.equal(runtime.pointer, null);
  assert.deepEqual(carousel.calls.slice(-3), ["transform:true", "a11y", "resume:1200"]);
  assert.deepEqual(renders, [{ viewChanged: false }]);
});

test("a pointercancel without a confirmed drag only rejoins a manual track", () => {
  const manual = makeRuntime({ carousel: fakeCarousel({ trackManual: true }) });
  manual.runtime.handlePointerDown(down());
  manual.runtime.handlePointerCancel({ pointerId: 1 });
  assert.equal(manual.runtime.pointer, null);
  assert.ok(manual.carousel.calls.includes("resume:0"));

  const outside = makeRuntime();
  outside.runtime.handlePointerDown(down({ __rotator: null }));
  outside.runtime.handlePointerCancel({ pointerId: 1 });
  assert.deepEqual(outside.carousel.calls, [], "a gesture outside the rotator resumes nothing");
});

test("a pointer event for a different pointer id is ignored throughout", () => {
  const { runtime, carousel } = makeRuntime();
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-200, 0, { pointerId: 99 }));
  assert.equal(runtime.isDragging, false);
  runtime.handlePointerUp(up(-200, 0, { pointerId: 99 }));
  assert.notEqual(runtime.pointer, null, "the tracked gesture is still live");
  runtime.handlePointerCancel({ pointerId: 99 });
  assert.notEqual(runtime.pointer, null);
  assert.deepEqual(carousel.calls, []);
});

test("a configuration change mid-drag settles the track and schedules an aligned resume", () => {
  const carousel = fakeCarousel();
  const { runtime } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  runtime.pointer.startTranslate = -100 / 3;

  runtime.cancelForConfigChange();
  assert.equal(carousel.activeIndex, 1);
  assert.equal(runtime.pointer, null);
  assert.equal(runtime.isDragging, false);
  assert.deepEqual(carousel.calls.slice(-4), ["transition:true", "transform:true", "a11y", "resumeAligned:1:10000"]);
});

test("a configuration change with no confirmed drag just clears the pointer", () => {
  const carousel = fakeCarousel();
  const { runtime } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  const before = carousel.calls.length;
  runtime.cancelForConfigChange();
  assert.equal(runtime.pointer, null);
  assert.equal(carousel.calls.length, before, "nothing was frozen, so nothing needs settling");
});

test("Enter and Space activate, but a key repeat does not", () => {
  const entity = { dataset: { entity: "sensor.x" } };
  const { runtime, fired } = makeRuntime();
  runtime.handleKeydown({ key: "Enter", __entity: entity, preventDefault: noop, stopPropagation: noop });
  runtime.handleKeydown({ key: " ", __entity: entity, preventDefault: noop, stopPropagation: noop });
  assert.deepEqual(fired, ["tap", "tap"]);

  runtime.handleKeydown({ key: "Enter", repeat: true, __entity: entity, preventDefault: noop, stopPropagation: noop });
  runtime.handleKeydown({ key: "a", __entity: entity, preventDefault: noop, stopPropagation: noop });
  assert.deepEqual(fired, ["tap", "tap"], "a held key and an unrelated key both do nothing");
});

test("the context menu is suppressed on an entity and left alone elsewhere", () => {
  const { runtime } = makeRuntime();
  let prevented = 0;
  runtime.handleContextMenu({ __entity: { dataset: { entity: "sensor.x" } }, preventDefault: () => (prevented += 1) });
  assert.equal(prevented, 1, "a long press is already a card action");
  runtime.handleContextMenu({ __entity: null, preventDefault: () => (prevented += 1) });
  assert.equal(prevented, 1);
});

// ------------------------------------------------------------- the actions --

function makeActions({ rooms = [], cardActions = {} } = {}) {
  const dispatched = [];
  const runtime = actions.createActionRuntime({
    platform: createFakePlatform(),
    getRooms: () => rooms,
    getCardActions: () => cardActions,
    dispatch: (event) => dispatched.push(event),
  });
  return { runtime, dispatched };
}

const chip = (entity, roomIndex) => ({ dataset: roomIndex === undefined ? { entity } : { entity, roomIndex: String(roomIndex) } });

test("an action without a configured entity does nothing at all", () => {
  const { runtime, dispatched } = makeActions();
  runtime.fire(null, "tap");
  runtime.fire({ dataset: {} }, "tap");
  assert.deepEqual(dispatched, []);
});

test("more-info inherits the clicked entity, so a card-wide default works everywhere", () => {
  const { runtime, dispatched } = makeActions({ cardActions: { tap_action: { action: "more-info" } } });
  runtime.fire(chip("sensor.kitchen"), "tap");
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0].detail.config.tap_action, { action: "more-info", entity: "sensor.kitchen" });
  assert.equal(dispatched[0].detail.action, "tap");
  assert.equal(dispatched[0].type, "hass-action");
  assert.equal(dispatched[0].bubbles, true);
  assert.equal(dispatched[0].composed, true);
});

test("an explicit entity on the action is never overwritten", () => {
  const { runtime, dispatched } = makeActions({ cardActions: { tap_action: { action: "more-info", entity: "sensor.other" } } });
  runtime.fire(chip("sensor.kitchen"), "tap");
  assert.equal(dispatched[0].detail.config.tap_action.entity, "sensor.other");
});

test("a room's own action wins over the card-level one", () => {
  const { runtime, dispatched } = makeActions({
    rooms: [{ tap_action: { action: "toggle" } }, {}],
    cardActions: { tap_action: { action: "navigate", navigation_path: "/x" } },
  });
  runtime.fire(chip("sensor.a", 0), "tap");
  assert.deepEqual(dispatched[0].detail.config.tap_action, { action: "toggle" });

  runtime.fire(chip("sensor.b", 1), "tap");
  assert.deepEqual(dispatched[1].detail.config.tap_action, { action: "navigate", navigation_path: "/x" }, "a room without an override falls back");
});

test("an element without a room index uses the card actions, even with rooms configured", () => {
  const { runtime, dispatched } = makeActions({
    rooms: [{ tap_action: { action: "toggle" } }],
    cardActions: { tap_action: { action: "more-info" } },
  });
  runtime.fire(chip("sensor.range"), "tap");
  assert.deepEqual(dispatched[0].detail.config.tap_action, { action: "more-info", entity: "sensor.range" });
});

test("action:none is a deliberate configuration and dispatches nothing", () => {
  const { runtime, dispatched } = makeActions({ cardActions: { tap_action: { action: "none" }, hold_action: { action: "more-info" } } });
  runtime.fire(chip("sensor.x"), "tap");
  assert.deepEqual(dispatched, []);
  runtime.fire(chip("sensor.x"), "hold");
  assert.equal(dispatched.length, 1, "the other gesture still works");
});

test("an unknown gesture name is treated as a tap rather than dropped", () => {
  const { runtime, dispatched } = makeActions({ cardActions: { tap_action: { action: "toggle" } } });
  runtime.fire(chip("sensor.x"), "something-else");
  assert.equal(dispatched[0].detail.action, "tap");
});

test("cloneAction never mutates what it was given", () => {
  const original = { action: "more-info" };
  const cloned = actions.cloneAction(original, "sensor.x");
  assert.notEqual(cloned, original);
  assert.equal(original.entity, undefined, "the configuration object stays untouched");
  assert.equal(cloned.entity, "sensor.x");
  assert.deepEqual(actions.cloneAction(null, "sensor.y"), { action: "more-info", entity: "sensor.y" });
});

test("the dispatched event comes from the platform, so it belongs to the card's realm", () => {
  const jsdom = new JSDOM("<!doctype html><html><body></body></html>");
  const dispatched = [];
  const runtime = actions.createActionRuntime({
    platform: {
      createEvent: (type, init) => new jsdom.window.Event(type, init),
    },
    getRooms: () => [],
    getCardActions: () => ({ tap_action: { action: "toggle" } }),
    dispatch: (event) => dispatched.push(event),
  });
  runtime.fire(chip("sensor.x"), "tap");
  assert.ok(dispatched[0] instanceof jsdom.window.Event);
  assert.equal(dispatched[0].type, "hass-action");
});

// ------------------------------------------------------ the disconnect contract --
//
// Home Assistant reinserts cards on the same element instance, so a gesture the runtime was
// mid-way through survives unless explicitly ended — and it blocks the reconnected card:
// isInteracting() stays true, the carousel refuses to start, updates defer forever.

test("disconnect ends a confirmed drag without settling a track nobody will see", () => {
  const carousel = fakeCarousel();
  const { runtime } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  assert.equal(runtime.isDragging, true);

  const before = carousel.calls.length;
  runtime.disconnect();

  assert.equal(runtime.pointer, null);
  assert.equal(runtime.isDragging, false);
  assert.equal(runtime.isInteracting(), false, "the carousel must be free to start on reconnect");
  assert.equal(carousel.calls.length, before, "no snap, no transition and above all no resume into a detached card");
});

test("disconnect ends an unconfirmed gesture too", () => {
  // A bare pointerdown never becomes a drag, but it still makes isInteracting() true.
  const { runtime } = makeRuntime();
  runtime.handlePointerDown(down());
  assert.equal(runtime.isInteracting(), true);
  runtime.disconnect();
  assert.equal(runtime.pointer, null);
  assert.equal(runtime.isInteracting(), false);
});

test("disconnect clears the click suppression, so the first action after a reconnect works", () => {
  const platform = createFakePlatform();
  const entity = { dataset: { entity: "sensor.x" } };
  const { runtime, fired } = makeRuntime({ platform });
  runtime.handlePointerDown(down({ __rotator: null, __entity: entity }));
  runtime.handlePointerUp(up(0, 0, { __entity: entity }));
  assert.ok(runtime.suppressClickUntil > platform.now(), "a completed tap arms the suppression");

  runtime.disconnect();
  assert.equal(runtime.suppressClickUntil, 0);
  runtime.handleClick({ __entity: entity, preventDefault: noop, stopPropagation: noop });
  assert.deepEqual(fired, ["tap", "tap"], "the first click of the new life is not swallowed");
});

test("disconnect is idempotent and a gesture started afterwards behaves normally", () => {
  const carousel = fakeCarousel();
  const { runtime } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  runtime.disconnect();
  runtime.disconnect();
  runtime.disconnect();
  assert.equal(runtime.pointer, null);
  assert.equal(runtime.isDragging, false);

  // A fresh gesture after the reconnect must work from a clean slate.
  runtime.handlePointerDown(down({ pointerId: 7 }));
  runtime.handlePointerMove(move(-40, 0, { pointerId: 7 }));
  assert.equal(runtime.isDragging, true);
  assert.ok(carousel.calls.includes("freeze"));
});

test("a pointer event from the previous life is ignored after a disconnect", () => {
  // The listeners live on the shadow root and survive a rebuild, so a stray move or up can
  // still arrive; with the pointer cleared they are no-ops.
  const carousel = fakeCarousel();
  const { runtime } = makeRuntime({ carousel });
  runtime.handlePointerDown(down());
  runtime.handlePointerMove(move(-40));
  runtime.disconnect();

  const before = carousel.calls.length;
  runtime.handlePointerMove(move(-200));
  runtime.handlePointerUp(up(-200));
  runtime.handlePointerCancel({ pointerId: 1 });
  assert.equal(carousel.calls.length, before, "no stale gesture may touch the new track");
  assert.equal(runtime.pointer, null);
});

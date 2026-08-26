"use strict";

// The ownership contract between the element and the carousel controller.
//
// Since the runtime extraction the controller owns the active index and both timers,
// and the element exposes them only as accessors. `_views` and `_activeView` write
// through; `_resumeAutoTimer` and `_a11ySyncTimer` are READ-ONLY windows onto the
// controller's real handles, because a writable window would be a second copy of the
// same fact and could drift from it.
//
// A read-only accessor has a sharp edge in strict mode — and the shipped bundle is
// strict: assigning to it throws a TypeError rather than being silently ignored. That
// is what makes the tests below worth having permanently. The first one reproduces the
// exact sequence a user performs: swipe once, then start a second swipe before the
// phase-aware resume from the first one has fired.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// range + scale + extremes, auto_slide on: three views is the smallest configuration in
// which a swipe genuinely moves and a phase-aware resume is genuinely scheduled.
function threeViewCard(overrides = {}) {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
  return env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      auto_slide: true,
      ...overrides,
    },
    hass
  );
}

// One complete swipe, driven through the real handlers rather than by setting fields:
// down, a confirmed horizontal move, then up past the 18% threshold.
function completeSwipe(el, { pointerId = 1, from = 0, distancePx = 200 } = {}) {
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._activeView = from;
  el._handlePointerDown(pointerDownEvent(el, pointerId));
  el._handlePointerMove(pointerMoveEvent(pointerId, -distancePx));
  el._handlePointerUp(pointerUpEvent(el, pointerId, -distancePx));
}

function pointerDownEvent(el, pointerId) {
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  return {
    pointerId,
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
    composedPath: () => [rotator],
  };
}

function pointerMoveEvent(pointerId, dx, dy = 0) {
  return {
    pointerId,
    clientX: dx,
    clientY: dy,
    preventDefault() {},
    stopPropagation() {},
  };
}

function pointerUpEvent(el, pointerId, dx, dy = 0) {
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  return {
    pointerId,
    clientX: dx,
    clientY: dy,
    composedPath: () => [rotator],
    preventDefault() {},
    stopPropagation() {},
  };
}

// ---------------------------------------------------------- the reproduction --

test("a second swipe started while the first swipe's resume is still pending does not throw", () => {
  const el = threeViewCard();
  assert.equal(el._views.length, 3, "range, scale, extremes");

  completeSwipe(el, { pointerId: 1 });
  assert.equal(el._activeView, 1, "the first swipe moved exactly one view");
  assert.notEqual(el._carousel.resumeTimerHandle, null, "and armed the phase-aware resume this test needs");

  // A second swipe before resume must mutate controller-owned state through its public
  // operations; assigning a getter-only compatibility accessor would throw in strict mode.
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown(pointerDownEvent(el, 2));
  assert.doesNotThrow(
    () => el._handlePointerMove(pointerMoveEvent(2, -60)),
    "confirming a horizontal drag must not throw"
  );

  assert.equal(el._carousel.resumeTimerHandle, null, "the pending resume is cleared through its owner");
  assert.equal(el._carousel.accessibilityTimerHandle, null, "and no accessibility timer is left running mid-drag");
  assert.equal(el._isDragging, true, "the drag is live");
  assert.equal(el._interaction.pointer.dragging, true);
  env.cleanup(el);
});

test("the second swipe completes normally: one view, exactly one new resume", () => {
  const el = threeViewCard();
  completeSwipe(el, { pointerId: 1 });
  const afterFirst = el._activeView;

  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown(pointerDownEvent(el, 2));
  el._handlePointerMove(pointerMoveEvent(2, -60));
  el._handlePointerUp(pointerUpEvent(el, 2, -200));

  assert.equal(el._activeView, afterFirst + 1, "exactly one further view, never two");
  assert.equal(el._isDragging, false);
  assert.equal(el._interaction.pointer, null);
  assert.notEqual(el._carousel.resumeTimerHandle, null, "exactly one new resume is scheduled");

  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.ok(track.classList.contains("rtc-manual"), "the track stays under manual control until the resume fires");
  assert.match(track.style.transform, /translate3d\(-66\./, "and sits on the new view");
  env.cleanup(el);
});

test("a pointercancel during the second swipe also cleans up completely", () => {
  const el = threeViewCard();
  completeSwipe(el, { pointerId: 1 });

  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown(pointerDownEvent(el, 2));
  el._handlePointerMove(pointerMoveEvent(2, -60));
  assert.doesNotThrow(() => el._handlePointerCancel({ pointerId: 2 }));

  assert.equal(el._interaction.pointer, null);
  assert.equal(el._isDragging, false);
  assert.notEqual(el._carousel.resumeTimerHandle, null, "cancelling still rejoins the synchronized animation eventually");
  env.cleanup(el);
});

test("a swipe that never crosses the direction threshold leaves the pending resume alone", () => {
  // The resume is only cleared once a swipe is CONFIRMED. A vertical scroll that starts
  // in the rotator must not disturb it.
  const el = threeViewCard();
  completeSwipe(el, { pointerId: 1 });
  const pending = el._carousel.resumeTimerHandle;
  assert.notEqual(pending, null);

  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  el._handlePointerDown(pointerDownEvent(el, 2));
  el._handlePointerMove(pointerMoveEvent(2, 4, 80));
  assert.equal(el._isDragging, false, "vertical movement is not a swipe");
  assert.equal(el._carousel.resumeTimerHandle, pending, "and the pending resume is untouched");
  env.cleanup(el);
});

// ------------------------------------------------------- the ownership guard --

test("the read-only controller windows cannot be assigned to", () => {
  // The permanent guard. These are the element's window onto state a controller owns;
  // assigning to them would either create a second copy or, as it did, throw in strict
  // mode. Both are wrong, so the accessors have no setter and this test pins that.
  //
  // _isDragging is on this list rather than the writable one below because a gesture can
  // only begin with a pointer event: a test that assigned a hand-built drag state could
  // describe a state the card is unable to reach (see test/helpers/gestures.js, which
  // drives the real handlers instead). The in-flight pointer itself is not exposed here
  // at all — nothing in production reads it, so it is asked of its owner.
  const el = threeViewCard();
  assert.equal(Object.getOwnPropertyDescriptor(el, "_pointer"), undefined, "the element carries no window it does not itself use");
  for (const name of ["_isDragging"]) {
    const descriptor = findAccessor(el, name);
    assert.ok(descriptor, `${name} must be an accessor, not a data field`);
    assert.equal(typeof descriptor.get, "function", `${name} must be readable`);
    assert.equal(descriptor.set, undefined, `${name} must have no setter`);
  }
  env.cleanup(el);
});

test("the writable controller windows write through to the owner, storing nothing themselves", () => {
  const el = threeViewCard();
  for (const name of ["_views", "_activeView"]) {
    const descriptor = findAccessor(el, name);
    assert.ok(descriptor, `${name} must be an accessor`);
    assert.equal(typeof descriptor.get, "function");
    assert.equal(typeof descriptor.set, "function", `${name} is assigned by the render path`);
    assert.ok(!Object.hasOwn(el, name), `${name} must not also exist as an own data property`);
  }

  el._activeView = 2;
  assert.equal(el._activeView, 2);
  el._views = ["a", "b"];
  assert.deepEqual([...el._views], ["a", "b"], "the setter reaches the controller");
  assert.equal(el._viewWidthPct(), 50, "and the controller's derived values follow immediately");
  env.cleanup(el);
});

function findAccessor(instance, name) {
  let prototype = Object.getPrototypeOf(instance);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (descriptor) return descriptor;
    prototype = Object.getPrototypeOf(prototype);
  }
  return null;
}

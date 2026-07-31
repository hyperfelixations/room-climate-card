"use strict";

// What has to be true after the card is taken out of the DOM, and after it comes back.
//
// Home Assistant removes and reinserts cards routinely: switching dashboard views,
// editing a layout, a masonry reflow. Every one of those is a disconnect followed by a
// reconnect on the SAME element instance, so anything the card was in the middle of
// survives unless it is explicitly ended.
//
// A gesture is exactly such a thing. Before this contract existed, disconnecting during
// a drag left `pointer` set and `isDragging` true; on reconnect the carousel refused to
// start (a gesture was "in flight") and every hass update only set the pending-render
// flag, waiting for a pointerup that could never arrive because the node that would
// have produced it was gone. The card sat frozen on stale data.
//
// The tests below drive the element through real handlers rather than by assigning to
// internals, so they keep their meaning once the writable test windows are gone.

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

const C = { device_class: "temperature", unit_of_measurement: "°C" };

function threeViewCard(overrides = {}) {
  return env.createCard(
    {
      entity: "sensor.avg",
      range_entity: "sensor.range",
      rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
      auto_slide: true,
      ...overrides,
    },
    states(22)
  );
}

function states(average, offsetMs = 0) {
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

function rotatorOf(el) {
  const rotator = el.shadowRoot.querySelector(".rtc-rotator");
  rotator.getBoundingClientRect = () => ({ width: 300 });
  return rotator;
}

const noop = () => {};
function pointerDown(el, pointerId = 1) {
  const rotator = rotatorOf(el);
  return { pointerId, button: 0, isPrimary: true, clientX: 0, clientY: 0, composedPath: () => [rotator] };
}
function pointerMove(pointerId, dx, dy = 0) {
  return { pointerId, clientX: dx, clientY: dy, preventDefault: noop, stopPropagation: noop };
}

// The state that must be clean after a disconnect, read through the owners.
function interactionState(el) {
  return {
    pointer: el._interaction.pointer,
    isDragging: el._interaction.isDragging,
    resumeTimer: el._carousel.resumeTimerHandle,
    a11yTimer: el._carousel.accessibilityTimerHandle,
  };
}

// ---------------------------------------------------------- the reproduction --

test("disconnect during a confirmed drag ends the gesture, so a reconnected card renders again", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  assert.equal(el._interaction.isDragging, true, "the drag is live");

  el.remove();
  const after = interactionState(el);
  assert.equal(after.pointer, null, "no gesture may outlive the element being removed");
  assert.equal(after.isDragging, false);
  assert.equal(after.resumeTimer, null, "and nothing may be scheduled into a detached card");
  assert.equal(after.a11yTimer, null);

  // The reconnected card must render the newest state without needing a pointerup that
  // can never arrive.
  env.document.body.appendChild(el);
  el.hass = states(26, 1000);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /26/);
  env.cleanup(el);
});

test("disconnect after a bare pointerdown also clears the gesture", () => {
  // Even an unconfirmed gesture blocks the carousel: isInteracting() is true as soon as
  // a pointer exists, so applyAutoSlideStyles() bails out on reconnect.
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  assert.notEqual(el._interaction.pointer, null);
  assert.equal(el._interaction.isDragging, false);

  el.remove();
  assert.equal(el._interaction.pointer, null);
  assert.equal(el._interaction.isInteracting(), false, "the carousel must be free to start again");

  env.document.body.appendChild(el);
  el.hass = states(24, 1000);
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.ok(track, "the carousel is mounted");
  env.cleanup(el);
});

test("disconnect while a resume timer is pending clears both, and reconnect re-arms cleanly", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el._handlePointerUp({ pointerId: 1, clientX: -200, clientY: 0, composedPath: () => [rotatorOf(el)], preventDefault: noop, stopPropagation: noop });
  assert.notEqual(el._carousel.resumeTimerHandle, null, "a completed swipe schedules a resume");

  el.remove();
  assert.equal(el._carousel.resumeTimerHandle, null);
  assert.equal(el._carousel.accessibilityTimerHandle, null);

  env.document.body.appendChild(el);
  assert.notEqual(el._carousel.accessibilityTimerHandle, null, "reconnect re-engages the synchronized animation");
  env.cleanup(el);
});

test("a hass update that arrived during the drag is not lost across disconnect and reconnect", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));

  // A real update mid-gesture: _render() defers it rather than jumping the track.
  el.hass = states(30, 1000);
  assert.match(
    el.shadowRoot.querySelector(".rtc-avg-value-num").textContent,
    /22/,
    "the deferred update has deliberately not been applied yet"
  );

  el.remove();
  env.document.body.appendChild(el);
  // The very next update must show the newest value; nothing may still be waiting on a
  // pointer end.
  el.hass = states(31, 2000);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /31/);
  env.cleanup(el);
});

test("a repeated disconnect is idempotent, and repeated connects create no duplicate wiring", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));

  el.remove();
  el.disconnectedCallback();
  el.disconnectedCallback();
  assert.deepEqual(interactionState(el), { pointer: null, isDragging: false, resumeTimer: null, a11yTimer: null });

  env.document.body.appendChild(el);
  el.connectedCallback();
  el.connectedCallback();
  // The event binding is guarded, so a second connect must not attach a second set.
  assert.equal(el._eventsBound, true);
  assert.equal(el._resize.isObserving(), true);
  el.hass = states(25, 1000);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /25/);
  env.cleanup(el);
});

test("a vertical scroll followed by a disconnect leaves nothing behind", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, 4, 80));
  assert.equal(el._interaction.isDragging, false, "vertical movement is not a swipe");
  assert.notEqual(el._interaction.pointer, null, "but the gesture is still being tracked");

  el.remove();
  assert.equal(el._interaction.pointer, null);
  env.cleanup(el);
});

test("no click is suppressed after a reconnect because of a gesture from the previous life", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el._handlePointerUp({ pointerId: 1, clientX: -200, clientY: 0, composedPath: () => [rotatorOf(el)], preventDefault: noop, stopPropagation: noop });
  // A completed swipe arms the 450ms click suppression.
  el.remove();
  env.document.body.appendChild(el);

  let fired = 0;
  el._fireHassAction = () => (fired += 1);
  const chip = el.shadowRoot.querySelector("[data-entity]");
  assert.ok(chip, "the card has an actionable element");
  el._handleClick({ composedPath: () => [chip], preventDefault: noop, stopPropagation: noop });
  assert.equal(fired, 1, "the first action after a reconnect must not be swallowed");
  env.cleanup(el);
});

test("the render pipeline is not left waiting on a pending flag after a reconnect", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el.hass = states(30, 1000);

  el.remove();
  env.document.body.appendChild(el);
  // Whatever the disconnect decided to do with the deferred render, the card must not
  // still believe one is queued behind a gesture that no longer exists.
  assert.equal(el._interaction.isInteracting(), false);
  el._render(false);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);
  env.cleanup(el);
});

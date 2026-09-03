"use strict";

// What must be true after the card leaves the DOM, and after it comes back. HA removes and
// reinserts cards routinely (view switch, layout edit, masonry reflow) — always a
// disconnect/reconnect on the same instance, so anything in flight survives unless
// explicitly ended. A gesture is such a thing: before this contract, disconnecting mid-drag
// left `pointer` set and `isDragging` true, the carousel refused to start on reconnect, and
// every hass update only set the pending flag — the card froze on stale data. Tests drive
// the element through real handlers so they survive removal of the writable test windows.

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

const C = TEMPERATURE_C;

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
  // Even an unconfirmed gesture blocks the carousel: isInteracting() is true once a pointer exists.
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

// ---- the deferred render across a disconnect ----
// Two obligations end differently at a disconnect: the gesture must not survive (its
// geometry, click suppression and timers refer to an offscreen card), but the data must —
// `_hass` holds the newest state the card was not yet allowed to show. Tests below assert
// the visible value after reconnect with no further hass assignment; reconnect settles the debt.

test("a hass update deferred by a drag becomes visible on reconnect, with no further update", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));

  // A real update mid-gesture: the render controller defers it rather than jumping the
  // track out from under the finger.
  el.hass = states(30, 1000);
  assert.match(
    el.shadowRoot.querySelector(".rtc-avg-value-num").textContent,
    /22/,
    "the deferred update has deliberately not been applied yet"
  );

  el.remove();
  env.document.body.appendChild(el);

  // Nothing else happens: HA already sent 30 and won't resend; the card owes this render.
  assert.match(
    el.shadowRoot.querySelector(".rtc-avg-value-num").textContent,
    /30/,
    "the value received before the removal must be on screen after the reconnect"
  );
  env.cleanup(el);
});

test("the deferred render is paid exactly once, not on every subsequent connect", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el.hass = states(30, 1000);

  el.remove();
  env.document.body.appendChild(el);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);

  // A second connect has nothing to catch up on; the signature fast path makes the repeat free.
  let renders = 0;
  const realComputeViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = () => {
    renders += 1;
    return realComputeViewModel();
  };
  el.remove();
  env.document.body.appendChild(el);
  assert.equal(renders, 0, "an unchanged card must not recompute a view model on reconnect");
  env.cleanup(el);
});

test("a disconnect with no deferred render owes nothing on reconnect", () => {
  const el = threeViewCard();
  let renders = 0;
  const realComputeViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = () => {
    renders += 1;
    return realComputeViewModel();
  };

  el.remove();
  env.document.body.appendChild(el);
  assert.equal(renders, 0, "nothing was owed, so nothing is recomputed");
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /22/);
  env.cleanup(el);
});

test("a bare pointerdown defers nothing, so a disconnect during one owes nothing", () => {
  // Only a CONFIRMED drag defers a render; an unclassified press renders normally.
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el.hass = states(28, 1000);
  assert.match(
    el.shadowRoot.querySelector(".rtc-avg-value-num").textContent,
    /28/,
    "an unconfirmed press does not defer anything"
  );

  el.remove();
  env.document.body.appendChild(el);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /28/);
  env.cleanup(el);
});

test("a structural update deferred by a drag rebuilds correctly on reconnect", () => {
  // A deferred update can be structural, not just a value — losing it leaves stale view markup.
  const el = threeViewCard();
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"]);

  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));

  // The second room drops out: "extremes" needs two, so the view list itself changes.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 24, C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, C),
  });
  assert.deepEqual(Array.from(el._views), ["range", "scale", "extremes"], "still deferred");

  el.remove();
  env.document.body.appendChild(el);
  assert.deepEqual(Array.from(el._views), ["range", "scale"], "the structural change is applied on reconnect");
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /24/);
  env.cleanup(el);
});

test("a card that fell into the no-data state mid-drag shows the no-data state on reconnect", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));

  el.hass = mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", C) });
  assert.equal(el.shadowRoot.querySelector(".rtc-root").dataset.state, "data", "still deferred");

  el.remove();
  env.document.body.appendChild(el);
  assert.equal(el.shadowRoot.querySelector(".rtc-root").dataset.state, "no-data", "crossing into no data survives the disconnect too");
  env.cleanup(el);
});

test("a successful setConfig during the disconnect settles the debt by rendering", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el.hass = states(30, 1000);

  el.remove();
  // A live config edit while detached renders against the newest hass, settling the earlier debt.
  el.setConfig({
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    auto_slide: true,
    entity_label: "Custom",
  });
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);

  let renders = 0;
  const realComputeViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = () => {
    renders += 1;
    return realComputeViewModel();
  };
  env.document.body.appendChild(el);
  assert.equal(renders, 0, "the reconnect has nothing left to catch up on");
  env.cleanup(el);
});

test("a render that throws while catching up leaves the debt outstanding", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el.hass = states(30, 1000);

  el.remove();
  const realComputeViewModel = el._computeViewModel.bind(el);
  el._computeViewModel = () => {
    throw new Error("induced failure during the reconnect render");
  };
  const originalConsoleError = env.window.console.error;
  const logged = [];
  env.window.console.error = (...args) => logged.push(args);
  env.document.body.appendChild(el);
  env.window.console.error = originalConsoleError;

  assert.equal(logged.length, 1, "a failing catch-up render is logged, not thrown into the dashboard");
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /22/, "nothing was committed");

  // Commit-on-success: the debt is still owed, so the next connect pays it properly.
  el._computeViewModel = realComputeViewModel;
  el.remove();
  env.document.body.appendChild(el);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);
  env.cleanup(el);
});

test("catching up happens after the events and the carousel are wired, not before", () => {
  // Order matters: the catch-up render can rebuild the shadow DOM, so the carousel must start after it.
  const el = threeViewCard();
  el._handlePointerDown(pointerDown(el));
  el._handlePointerMove(pointerMove(1, -60));
  el.hass = states(30, 1000);
  el.remove();

  const order = [];
  const realBindEvents = el._bindEvents.bind(el);
  const realStartRotation = el._startRotation.bind(el);
  const realComputeViewModel = el._computeViewModel.bind(el);
  el._bindEvents = () => {
    order.push("events");
    realBindEvents();
  };
  el._startRotation = () => {
    order.push("carousel");
    realStartRotation();
  };
  el._computeViewModel = () => {
    order.push("render");
    return realComputeViewModel();
  };

  env.document.body.appendChild(el);
  assert.deepEqual(order, ["events", "carousel", "render"]);
  assert.equal(el._carousel.accessibilityTimerHandle !== null, true, "and the carousel is running afterwards");
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
  // Reconnect settles the deferred render and ends the gesture — no update left queued.
  assert.equal(el._interaction.isInteracting(), false);
  el._render(false);
  assert.match(el.shadowRoot.querySelector(".rtc-avg-value-num").textContent, /30/);
  env.cleanup(el);
});

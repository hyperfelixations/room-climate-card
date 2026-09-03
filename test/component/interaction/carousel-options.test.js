"use strict";

// auto_slide and swipe are independent carousel options: auto_slide gates only the
// automatic rotation timer (_hasAutoSlide()), swipe gates only the manual horizontal drag
// gesture (_handlePointerDown()'s this._interaction.pointer.rotator flag). Both default
// true. Reduced Motion and 0/1-view behaviour stay correct regardless of either option.

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

function threeViewHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
}

function threeViewCard(extraConfig) {
  return env.createCard(
    { entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], ...extraConfig },
    threeViewHass()
  );
}

// A pointerdown whose composed path optionally includes .rtc-rotator / a chip.
function pointerDownEvent(el, { insideRotator, insideEntity } = {}) {
  const path = [];
  if (insideEntity) {
    const chip = el.shadowRoot.querySelector("[data-entity]");
    if (chip) path.push(chip);
  }
  if (insideRotator) {
    const rotator = el.shadowRoot.querySelector(".rtc-rotator");
    if (rotator) path.push(rotator);
  }
  return { pointerId: 1, button: 0, clientX: 100, clientY: 50, composedPath: () => path };
}

// ==== _normalizeConfig() ====

test("integration: auto_slide/swipe default to true when unset", () => {
  const el = threeViewCard();
  assert.equal(el._config.auto_slide, true);
  assert.equal(el._config.swipe, true);
  env.cleanup(el);
});

test("integration: auto_slide:false and swipe:false are honored independently", () => {
  const el = threeViewCard({ auto_slide: false, swipe: true });
  assert.equal(el._config.auto_slide, false);
  assert.equal(el._config.swipe, true);
  env.cleanup(el);

  const el2 = threeViewCard({ auto_slide: true, swipe: false });
  assert.equal(el2._config.auto_slide, true);
  assert.equal(el2._config.swipe, false);
  env.cleanup(el2);
});

test("integration: any non-false value is treated as true (same tolerant style as hide_footer)", () => {
  const el = threeViewCard({ auto_slide: "yes", swipe: 0 });
  assert.equal(el._config.auto_slide, true);
  assert.equal(el._config.swipe, true, "0 is not === false, so it is not treated as a disable request");
  env.cleanup(el);
});

// ==== _hasAutoSlide() ====

test("_hasAutoSlide(): auto_slide:false disables the timer even with >=2 views and no reduced motion", () => {
  const el = threeViewCard({ auto_slide: false });
  assert.equal(el._views.length, 3);
  assert.equal(el._carousel.hasAutoSlide(), false);
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.ok(track, "sanity check: carousel must still render (auto_slide only affects rotation, not the carousel itself)");
  assert.equal(track.classList.contains("rtc-manual"), true, "the track must be statically parked, not animating");
  assert.equal(el._carousel.resumeTimerHandle, null);
  env.cleanup(el);
});

test("_hasAutoSlide(): true by default with >=2 views and no reduced motion (regression)", () => {
  const el = threeViewCard();
  assert.equal(el._carousel.hasAutoSlide(), true);
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), false, "must be auto-engaged by default");
  env.cleanup(el);
});

test("_hasAutoSlide(): auto_slide:true does not override Reduced Motion", () => {
  env.setReducedMotion(true);
  const el = threeViewCard({ auto_slide: true });
  assert.equal(el._carousel.hasAutoSlide(), false);
  env.cleanup(el);
  env.setReducedMotion(false);
});

test("_hasAutoSlide(): auto_slide:false on 0/1-view configs changes nothing visible (was already false)", () => {
  const soloHass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) });
  const elOneView = env.createCard({ entity: "sensor.avg", auto_slide: false }, soloHass);
  assert.equal(elOneView._views.length, 1);
  assert.equal(elOneView._carousel.hasAutoSlide(), false);
  assert.equal(elOneView.shadowRoot.querySelector(".rtc-track"), null, "solo view never has a carousel track at all");
  env.cleanup(elOneView);

  const elNoViews = env.createCard({ entity: "sensor.avg", auto_slide: false, views: [] }, soloHass);
  assert.equal(elNoViews._views.length, 0);
  assert.equal(elNoViews._carousel.hasAutoSlide(), false);
  env.cleanup(elNoViews);
});

// ==== swipe: false gates _handlePointerDown()'s this._interaction.pointer.rotator ====

test("swipe:false: a pointerdown inside the rotator is NOT tracked as a rotator gesture", () => {
  const el = threeViewCard({ swipe: false });
  el._handlePointerDown(pointerDownEvent(el, { insideRotator: true }));
  assert.ok(el._interaction.pointer, "pointerdown itself must still register (needed for tap detection)");
  assert.equal(el._interaction.pointer.rotator, false, "swipe:false must suppress rotator tracking even though the pointerdown targeted .rtc-rotator");
  env.cleanup(el);
});

test("swipe:true (default): a pointerdown inside the rotator IS tracked as a rotator gesture (regression)", () => {
  const el = threeViewCard();
  el._handlePointerDown(pointerDownEvent(el, { insideRotator: true }));
  assert.equal(el._interaction.pointer.rotator, true);
  env.cleanup(el);
});

test("swipe:false: a confirmed drag inside the rotator does not move the track or preventDefault", () => {
  const el = threeViewCard({ swipe: false });
  el._handlePointerDown(pointerDownEvent(el, { insideRotator: true }));
  let prevented = false;
  el._handlePointerMove({ pointerId: 1, clientX: 140, clientY: 50, preventDefault: () => { prevented = true; } });
  assert.equal(el._isDragging, false, "_handlePointerMove() early-returns once this._interaction.pointer.rotator is false");
  assert.equal(prevented, false);
  env.cleanup(el);
});

test("swipe:false: tap on a room chip still fires its action (entityTarget-based, independent of .rotator)", () => {
  const el = threeViewCard({ swipe: false });
  let calls = 0;
  el._fireHassAction = (entity, action) => { calls++; };
  const event = pointerDownEvent(el, { insideRotator: true, insideEntity: true });
  el._handlePointerDown(event);
  el._handlePointerUp({ pointerId: 1, clientX: 100, clientY: 50, preventDefault: () => {}, stopPropagation: () => {} });
  assert.equal(calls, 1, "swipe:false must not suppress ordinary tap/hold actions");
  env.cleanup(el);
});

// ==== both together / independence ====

test("auto_slide:false and swipe:false together: rotation stays off AND manual dragging stays off", () => {
  const el = threeViewCard({ auto_slide: false, swipe: false });
  assert.equal(el._carousel.hasAutoSlide(), false);
  el._handlePointerDown(pointerDownEvent(el, { insideRotator: true }));
  assert.equal(el._interaction.pointer.rotator, false);
  env.cleanup(el);
});

test("auto_slide:false alone leaves swipe fully functional", () => {
  const el = threeViewCard({ auto_slide: false });
  el._handlePointerDown(pointerDownEvent(el, { insideRotator: true }));
  assert.equal(el._interaction.pointer.rotator, true, "swipe must remain unaffected by auto_slide:false");
  env.cleanup(el);
});

test("swipe:false alone leaves auto-rotation fully functional", () => {
  const el = threeViewCard({ swipe: false });
  assert.equal(el._carousel.hasAutoSlide(), true, "auto_slide must remain unaffected by swipe:false");
  env.cleanup(el);
});

// A live setConfig() toggling only auto_slide must rebuild the carousel, so
// structuralConfigSignature includes auto_slide; both directions take effect immediately.
test("setConfig(): live auto_slide true -> false stops the running animation", () => {
  const el = threeViewCard();
  let track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), false, "sanity check: starts auto-engaged");

  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], auto_slide: false });
  track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(el._carousel.hasAutoSlide(), false);
  assert.equal(track.classList.contains("rtc-manual"), true, "the track must now be statically parked");
  assert.equal(el._carousel.resumeTimerHandle, null);
  env.cleanup(el);
});

test("setConfig(): live auto_slide false -> true schedules the phase-aware resume", () => {
  const el = threeViewCard({ auto_slide: false });
  const track = el.shadowRoot.querySelector(".rtc-track");
  assert.equal(track.classList.contains("rtc-manual"), true, "sanity check: starts statically parked");
  assert.equal(el._carousel.resumeTimerHandle, null, "sanity check: no resume scheduled while auto_slide is off");

  el.setConfig({ entity: "sensor.avg", range_entity: "sensor.range", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }], auto_slide: true });
  assert.equal(el._carousel.hasAutoSlide(), true);
  // A non-first structural rebuild freezes on the current view, then schedules a phase-aware
  // resume — no immediate class flip. The armed resume timer is what proves auto_slide:true took effect.
  assert.notEqual(el._carousel.resumeTimerHandle, null, "a resume must now be scheduled");
  env.cleanup(el);
});

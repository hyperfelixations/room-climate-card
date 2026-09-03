"use strict";

// Keyed DOM patching for Average, Rooms, Range and Extrema preserves node identity across
// hass updates, so focus survives a value-only change. Scale and RangeScale patch
// attributes via _updateScaleBarCommon() without replacing markup. Tests assert DOM node
// identity (=== reference equality), not visible text — a recreated node that looks the
// same has still lost focus.

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

// entity + range_entity + 3 rooms: all four affected areas present at once (range, scale,
// extremes auto-enabled; range_scale off by default).
function fourAreaStates(overrides) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 18, maximum: 24 }),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
    "sensor.r3": mkState("sensor.r3", 19, TEMPERATURE_C),
    ...overrides,
  });
}

function fourAreaConfig(extra) {
  return {
    entity: "sensor.avg",
    range_entity: "sensor.range",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }, { entity: "sensor.r3" }],
    ...extra,
  };
}

function createFourAreaCard() {
  return env.createCard(fourAreaConfig(), fourAreaStates());
}

// ==== 1+2: value-only update preserves node identity + focus, still patches content ====

test("Average: value-only update preserves node identity and focus, patches the number", () => {
  const el = createFourAreaCard();
  const btn = el.shadowRoot.querySelector("button.rtc-avg-button");
  btn.focus();
  assert.equal(el.shadowRoot.activeElement, btn, "precondition: average button must actually be focused");

  el.hass = fourAreaStates({ "sensor.avg": mkState("sensor.avg", 25, TEMPERATURE_C) });

  const btnAfter = el.shadowRoot.querySelector("button.rtc-avg-button");
  assert.equal(btnAfter, btn, "average button node identity must be preserved");
  assert.equal(el.shadowRoot.activeElement, btn, "focus must be preserved");
  assert.equal(btn.querySelector(".rtc-avg-value-num").textContent, el._fmt(25));
  env.cleanup(el);
});

test("Room chip: value-only update preserves node identity and focus, patches number/title/color", () => {
  const el = createFourAreaCard();
  const chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  chip.focus();
  assert.equal(el.shadowRoot.activeElement, chip, "precondition: chip must actually be focused");
  const titleBefore = chip.getAttribute("title");
  const colorBefore = chip.style.getPropertyValue("--room-color");

  // Push r1 well outside the comfort band so tone/color/mark all change too.
  el.hass = fourAreaStates({ "sensor.r1": mkState("sensor.r1", 30, TEMPERATURE_C) });

  const chipAfter = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  assert.equal(chipAfter, chip, "room chip node identity must be preserved");
  assert.equal(el.shadowRoot.activeElement, chip, "focus must be preserved");
  assert.equal(chip.querySelector(".rtc-room-value-num").textContent, el._fmt(30));
  assert.notEqual(chip.getAttribute("title"), titleBefore, "title must reflect the new value");
  assert.notEqual(chip.style.getPropertyValue("--room-color"), colorBefore, "color must reflect the new (out-of-comfort) classification");
  env.cleanup(el);
});

test("Range card: value-only update preserves node identity and focus, patches number", () => {
  const el = createFourAreaCard();
  const cards = el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card");
  assert.equal(cards.length, 2, "precondition: exactly two range cards (min, max)");
  const minCard = cards[0];
  minCard.focus();
  assert.equal(el.shadowRoot.activeElement, minCard);

  el.hass = fourAreaStates({ "sensor.range": mkState("sensor.range", 3, { unit_of_measurement: "°C", minimum: 15, maximum: 24 }) });

  const cardsAfter = el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card");
  assert.equal(cardsAfter[0], minCard, "range min card node identity must be preserved");
  assert.equal(el.shadowRoot.activeElement, minCard, "focus must be preserved");
  assert.equal(minCard.querySelector(".rtc-extreme-value-num").textContent, el._fmt(15));
  env.cleanup(el);
});

test("Extrema card: value-only update preserves node identity and focus, patches number/name", () => {
  const el = createFourAreaCard();
  const cards = el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card");
  assert.equal(cards.length, 2, "precondition: exactly two extrema cards (coldest, warmest)");
  const coldCard = cards[0];
  coldCard.focus();
  assert.equal(el.shadowRoot.activeElement, coldCard);
  const nameBefore = coldCard.querySelector(".rtc-extreme-name").textContent;

  // r3 (19) is currently coldest; make it even colder, still coldest -> same slot, new number.
  el.hass = fourAreaStates({ "sensor.r3": mkState("sensor.r3", 16, TEMPERATURE_C) });

  const cardsAfter = el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card");
  assert.equal(cardsAfter[0], coldCard, "coldest-room card node identity must be preserved");
  assert.equal(el.shadowRoot.activeElement, coldCard, "focus must be preserved");
  assert.equal(coldCard.querySelector(".rtc-extreme-value-num").textContent, el._fmt(16));
  assert.equal(coldCard.querySelector(".rtc-extreme-name").textContent, nameBefore, "still the same (coldest) room");
  env.cleanup(el);
});

test("Extrema card: a NEW room becoming coldest patches the same card node (role-keyed, not entity-keyed)", () => {
  const el = createFourAreaCard();
  const coldCard = el.shadowRoot.querySelector(".rtc-extremes-view .rtc-extreme-card");
  coldCard.focus();

  // r1 (21) becomes colder than r3 (19) -> r1 is now coldest, a DIFFERENT room than before.
  el.hass = fourAreaStates({ "sensor.r1": mkState("sensor.r1", 10, TEMPERATURE_C) });

  const coldCardAfter = el.shadowRoot.querySelector(".rtc-extremes-view .rtc-extreme-card");
  assert.equal(coldCardAfter, coldCard, "the coldest-room SLOT keeps its node identity even when the underlying room changes");
  assert.equal(el.shadowRoot.activeElement, coldCard, "focus must be preserved -- the slot is still meaningfully 'the coldest room'");
  assert.equal(coldCard.getAttribute("data-entity"), "sensor.r1", "data-entity must now point at the new coldest room");
  env.cleanup(el);
});

// ==== 3: adding/removing an UNRELATED room preserves focus elsewhere ====

test("Rooms: making an unrelated room unavailable preserves focus and node identity of an untouched chip", () => {
  const el = createFourAreaCard();
  const r1Chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  r1Chip.focus();

  el.hass = fourAreaStates({ "sensor.r3": mkState("sensor.r3", "unavailable", {}) });

  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r3"]'), null, "r3 chip must be gone");
  const r1ChipAfter = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  assert.equal(r1ChipAfter, r1Chip, "untouched chip's node identity must be preserved");
  assert.equal(el.shadowRoot.activeElement, r1Chip, "focus must be preserved");
  env.cleanup(el);
});

test("Rooms: a newly available room does not disturb focus/identity of existing chips", () => {
  const el = env.createCard(
    fourAreaConfig(),
    fourAreaStates({ "sensor.r3": mkState("sensor.r3", "unavailable", {}) })
  );
  const r1Chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  r1Chip.focus();
  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r3"]'), null, "precondition: r3 starts absent");

  el.hass = fourAreaStates(); // r3 becomes available again

  assert.ok(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r3"]'), "r3 chip must now exist");
  const r1ChipAfter = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  assert.equal(r1ChipAfter, r1Chip, "existing chip's node identity must be preserved when a new room appears");
  assert.equal(el.shadowRoot.activeElement, r1Chip, "focus must be preserved");
  env.cleanup(el);
});

// ==== 4+5: focus-fallback when the focused element itself disappears/becomes non-interactive ====

test("Rooms: making the FOCUSED room unavailable falls back focus to the average button", () => {
  const el = createFourAreaCard();
  const r1Chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  r1Chip.focus();

  el.hass = fourAreaStates({ "sensor.r1": mkState("sensor.r1", "unavailable", {}) });

  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]'), null, "precondition: r1 chip must be gone");
  assert.equal(el.shadowRoot.activeElement, el.shadowRoot.querySelector("button.rtc-avg-button"), "focus must fall back to the average button");
  env.cleanup(el);
});

test("Rooms: focus fallback lands on .rtc-root when no interactive average button exists", () => {
  // The primary is present but unavailable, so avgSource falls back to "calculated" -> the
  // disabled (non-interactive) average shape.
  const el = env.createCard(
    fourAreaConfig(),
    fourAreaStates({ "sensor.avg": mkState("sensor.avg", "unavailable", {}) })
  );
  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), null, "precondition: average must be the non-interactive shape");
  const r1Chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  r1Chip.focus();

  // fourAreaStates() rebuilds every entity from defaults each call, so both overrides must
  // be passed together or sensor.avg resets to a valid value.
  el.hass = fourAreaStates({
    "sensor.avg": mkState("sensor.avg", "unavailable", {}),
    "sensor.r1": mkState("sensor.r1", "unavailable", {}),
  });

  assert.equal(el.shadowRoot.activeElement, el.shadowRoot.querySelector(".rtc-root"), "focus must fall back to .rtc-root");
  env.cleanup(el);
});

test("Average: losing its entity (shape change to disabled) while focused falls back focus to .rtc-root", () => {
  const el = createFourAreaCard();
  const btn = el.shadowRoot.querySelector("button.rtc-avg-button");
  btn.focus();

  el.hass = fourAreaStates({ "sensor.avg": mkState("sensor.avg", "unavailable", {}) });

  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), null, "precondition: average must now be the disabled shape");
  assert.ok(el.shadowRoot.querySelector(".rtc-avg-button-disabled"), "precondition: disabled shape must be rendered");
  assert.equal(el.shadowRoot.activeElement, el.shadowRoot.querySelector(".rtc-root"), "focus must fall back to .rtc-root (the disabled shape is not focusable)");
  env.cleanup(el);
});

test("Average: gaining an entity (shape change from disabled to button) renders the interactive shape correctly", () => {
  const el = env.createCard(
    fourAreaConfig(),
    fourAreaStates({ "sensor.avg": mkState("sensor.avg", "unavailable", {}) })
  );
  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), null, "precondition: average starts as the disabled shape");

  el.hass = fourAreaStates();

  const btn = el.shadowRoot.querySelector("button.rtc-avg-button");
  assert.ok(btn, "average must now be the interactive button shape");
  assert.equal(btn.getAttribute("data-entity"), "sensor.avg");
  env.cleanup(el);
});

// ==== 6: view disappearing via availability change leaves no focus in a removed subtree ====

test("Extrema view disappearing via availability change leaves no focus in the removed subtree", () => {
  const el = createFourAreaCard();
  const coldCard = el.shadowRoot.querySelector(".rtc-extremes-view .rtc-extreme-card");
  coldCard.focus();
  assert.equal(el.shadowRoot.activeElement, coldCard);

  // Drop to 1 valid room -> roomsComparable false -> extremes view disappears (structural _renderAll()).
  el.hass = fourAreaStates({
    "sensor.r2": mkState("sensor.r2", "unavailable", {}),
    "sensor.r3": mkState("sensor.r3", "unavailable", {}),
  });

  assert.equal(el.shadowRoot.querySelector(".rtc-extremes-view"), null, "extremes view must be gone");
  assert.equal(el.shadowRoot.contains(coldCard), false, "the old extrema card must no longer be in the document");
  assert.notEqual(el.shadowRoot.activeElement, coldCard, "focus must not remain on the removed node");
  env.cleanup(el);
});

// ==== 7: no duplicate action events after repeated patch cycles ====

test("clicking a room chip after several value-only updates fires exactly one hass-action event", () => {
  const el = createFourAreaCard();
  let fireCount = 0;
  el.addEventListener("hass-action", () => {
    fireCount++;
  });

  for (let i = 0; i < 4; i++) {
    el.hass = fourAreaStates({ "sensor.r1": mkState("sensor.r1", 20 + i, TEMPERATURE_C) });
  }

  const chip = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]');
  const MouseEvent = el.ownerDocument.defaultView.MouseEvent;
  chip.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));

  assert.equal(fireCount, 1, "exactly one hass-action event must fire per click, regardless of prior patch cycles");
  env.cleanup(el);
});

// ==== 8: a room moving to a different grid row/position keeps its node ====

function eightRoomStates(overrides) {
  const states = { "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C) };
  for (let i = 1; i <= 8; i++) {
    states[`sensor.r${i}`] = mkState(`sensor.r${i}`, 20 + (i % 3), TEMPERATURE_C);
  }
  return mkHass({ ...states, ...overrides });
}

function eightRoomConfig() {
  return { entity: "sensor.avg", rooms: Array.from({ length: 8 }, (_, i) => ({ entity: `sensor.r${i + 1}` })) };
}

test("a room moving to a different grid row (row count shrinks) keeps the same chip node", () => {
  const el = env.createCard(eightRoomConfig(), eightRoomStates());
  const r8Before = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r8"]');
  assert.ok(r8Before, "precondition: 8th room chip must exist");
  assert.ok(el.shadowRoot.querySelectorAll(".rtc-room-row").length >= 2, "precondition: 8 rooms must wrap into at least 2 rows");

  el.hass = eightRoomStates({ "sensor.r1": mkState("sensor.r1", "unavailable", {}) });

  assert.equal(el.shadowRoot.querySelectorAll(".rtc-room-row").length, 1, "precondition: 7 remaining rooms must now fit in a single row");
  const r8After = el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r8"]');
  assert.equal(r8After, r8Before, "room chip node identity must be preserved across a row/position change");
  env.cleanup(el);
});

// ==== 9: comprehensive node-identity sweep across all four areas in one pass ====

test("a single purely-numeric hass update preserves every focusable node's identity across all four areas at once", () => {
  const el = createFourAreaCard();
  const before = {
    avg: el.shadowRoot.querySelector("button.rtc-avg-button"),
    r1: el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]'),
    r2: el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r2"]'),
    r3: el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r3"]'),
    rangeMin: el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card")[0],
    rangeMax: el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card")[1],
    cold: el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card")[0],
    warm: el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card")[1],
  };
  Object.values(before).forEach((node, i) => assert.ok(node, `precondition: node ${i} must exist`));

  el.hass = fourAreaStates({
    "sensor.avg": mkState("sensor.avg", 22.5, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21.5, TEMPERATURE_C),
  });

  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), before.avg);
  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r1"]'), before.r1);
  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r2"]'), before.r2);
  assert.equal(el.shadowRoot.querySelector('.rtc-room-chip[data-entity="sensor.r3"]'), before.r3);
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card")[0], before.rangeMin);
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-range-view .rtc-extreme-card")[1], before.rangeMax);
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card")[0], before.cold);
  assert.equal(el.shadowRoot.querySelectorAll(".rtc-extremes-view .rtc-extreme-card")[1], before.warm);
  env.cleanup(el);
});

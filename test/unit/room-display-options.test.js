"use strict";

// AP-C2 (audit 23.1): room_sort, room_label, show_rooms. room_sort is
// purely a presentation decision -- it only reorders the rendered chips
// (data.rooms), never data.allRooms (extrema/comfort-count/spread stay
// value-sorted regardless). room_label is a static 3-way choice between
// room.short/room.name, unrelated to the long-/short-form width-driven
// architecture. show_rooms:false hides only the chip grid -- rooms remain
// full data sources.

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

// Four rooms with distinct values/names so every sort mode produces a
// different, unambiguous order. Declaration order (config.rooms): r-c
// (Kitchen), r-a (Attic), r-d (Den), r-b (Bath) -- deliberately not
// alphabetical and not value-sorted, so "configured" is distinguishable
// from both "name" and "value_asc".
function fourRoomHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.rc": mkState("sensor.rc", 24, { device_class: "temperature", unit_of_measurement: "°C" }), // Kitchen
    "sensor.ra": mkState("sensor.ra", 18, { device_class: "temperature", unit_of_measurement: "°C" }), // Attic
    "sensor.rd": mkState("sensor.rd", 26, { device_class: "temperature", unit_of_measurement: "°C" }), // Den
    "sensor.rb": mkState("sensor.rb", 20, { device_class: "temperature", unit_of_measurement: "°C" }), // Bath
  });
}

function fourRoomConfig(extra) {
  return {
    entity: "sensor.avg",
    rooms: [
      { entity: "sensor.rc", name: "Kitchen", short: "KI" },
      { entity: "sensor.ra", name: "Attic", short: "AT" },
      { entity: "sensor.rd", name: "Den", short: "DE" },
      { entity: "sensor.rb", name: "Bath", short: "BA" },
    ],
    ...extra,
  };
}

function roomNames(data) {
  // [...data.rooms] (not data.rooms.map()): data.rooms is an array created
  // inside the card's own jsdom vm realm, whose Array.prototype differs
  // from this test file's -- assert.deepStrictEqual then fails on realm
  // identity even with byte-identical contents. Spreading into a fresh
  // array literal here re-homes it in this realm before .map().
  return [...data.rooms].map((r) => r.name);
}

// ==== _normalizeConfig() ====

test("integration: room_sort/room_label/show_rooms default correctly, invalid values fall back silently", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  assert.equal(el._config.room_sort, "value_asc");
  assert.equal(el._config.room_label, "auto");
  assert.equal(el._config.show_rooms, true);
  env.cleanup(el);

  const el2 = env.createCard(fourRoomConfig({ room_sort: "bogus", room_label: "bogus", show_rooms: "bogus" }), fourRoomHass());
  assert.equal(el2._config.room_sort, "value_asc", "invalid room_sort falls back to the default");
  assert.equal(el2._config.room_label, "auto", "invalid room_label falls back to the default");
  assert.equal(el2._config.show_rooms, true, "show_rooms only disables on the literal boolean false, like hide_footer's === true convention");
  env.cleanup(el2);
});

// ==== room_sort: presentation only ====

test("room_sort: value_asc (default) orders chips by value ascending, name as tie-break", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  const data = el._computeData();
  assert.deepEqual(roomNames(data), ["Attic", "Bath", "Kitchen", "Den"]); // 18, 20, 24, 26
  env.cleanup(el);
});

test("room_sort: value_desc orders chips by value descending", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "value_desc" }), fourRoomHass());
  const data = el._computeData();
  assert.deepEqual(roomNames(data), ["Den", "Kitchen", "Bath", "Attic"]); // 26, 24, 20, 18
  env.cleanup(el);
});

test("room_sort: name orders chips alphabetically", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "name" }), fourRoomHass());
  const data = el._computeData();
  assert.deepEqual(roomNames(data), ["Attic", "Bath", "Den", "Kitchen"]);
  env.cleanup(el);
});

test("room_sort: configured preserves the declaration order from rooms:", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "configured" }), fourRoomHass());
  const data = el._computeData();
  assert.deepEqual(roomNames(data), ["Kitchen", "Attic", "Den", "Bath"]);
  env.cleanup(el);
});

test("room_sort: NEVER affects data.allRooms / extrema / comfort count / spread, across all four modes", () => {
  const baseline = env.createCard(fourRoomConfig({ room_sort: "value_asc" }), fourRoomHass())._computeData();
  for (const mode of ["value_desc", "name", "configured"]) {
    const el = env.createCard(fourRoomConfig({ room_sort: mode }), fourRoomHass());
    const data = el._computeData();
    assert.equal(data.coolest.name, baseline.coolest.name, `${mode}: coolest must stay Attic regardless of chip order`);
    assert.equal(data.warmest.name, baseline.warmest.name, `${mode}: warmest must stay Den regardless of chip order`);
    assert.equal(data.avg, baseline.avg);
    assert.equal(data.inComfort, baseline.inComfort);
    assert.equal(data.spread, baseline.spread);
    env.cleanup(el);
  }
});

test("room_sort: a setConfig()-only room_sort change re-orders the rendered chips (partial update, keyed patching preserved)", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "configured" }), fourRoomHass());
  const chipsBefore = Array.from(el.shadowRoot.querySelectorAll(".rtc-room-chip"));
  assert.equal(chipsBefore[0].getAttribute("data-entity"), "sensor.rc", "sanity check: configured order starts with Kitchen");
  const kitchenChipNode = chipsBefore[0];

  el.setConfig(fourRoomConfig({ room_sort: "value_asc" }));

  const chipsAfter = Array.from(el.shadowRoot.querySelectorAll(".rtc-room-chip"));
  assert.equal(chipsAfter[0].getAttribute("data-entity"), "sensor.ra", "value_asc: Attic (18) must now be first");
  const kitchenChipAfter = el.shadowRoot.querySelector('[data-entity="sensor.rc"]');
  assert.equal(kitchenChipAfter, kitchenChipNode, "AP-09: reordering must move the existing chip node, not recreate it");
  env.cleanup(el);
});

// ==== room_label ====

test("room_label: auto (default) shows room.short, exactly like before this option existed", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  const shortEl = el.shadowRoot.querySelector('[data-entity="sensor.rc"] .rtc-room-short');
  assert.equal(shortEl.textContent, "KI");
  env.cleanup(el);
});

test("room_label: short is explicitly identical to auto", () => {
  const el = env.createCard(fourRoomConfig({ room_label: "short" }), fourRoomHass());
  const shortEl = el.shadowRoot.querySelector('[data-entity="sensor.rc"] .rtc-room-short');
  assert.equal(shortEl.textContent, "KI");
  env.cleanup(el);
});

test("room_label: name shows the full room name instead of the abbreviation", () => {
  const el = env.createCard(fourRoomConfig({ room_label: "name" }), fourRoomHass());
  const shortEl = el.shadowRoot.querySelector('[data-entity="sensor.rc"] .rtc-room-short');
  assert.equal(shortEl.textContent, "Kitchen");
  env.cleanup(el);
});

test("room_label: does not affect any data computation (value, color classification, tooltip room name)", () => {
  const elShort = env.createCard(fourRoomConfig({ room_label: "short" }), fourRoomHass());
  const elName = env.createCard(fourRoomConfig({ room_label: "name" }), fourRoomHass());
  const dataShort = elShort._computeData();
  const dataName = elName._computeData();
  assert.equal(dataShort.avg, dataName.avg);
  assert.equal(dataShort.inComfort, dataName.inComfort);
  const chipTitleShort = elShort.shadowRoot.querySelector('[data-entity="sensor.rc"]').getAttribute("title");
  const chipTitleName = elName.shadowRoot.querySelector('[data-entity="sensor.rc"]').getAttribute("title");
  assert.equal(chipTitleShort, chipTitleName, "the full name always stays in the tooltip regardless of room_label");
  env.cleanup(elShort);
  env.cleanup(elName);
});

// ==== shortGuaranteed (room-value-legibility regression fix) ====
// A room's short code must never shrink/ellipsize when the actually
// RENDERED label (room.displayLabel, after room_label resolution) is
// exactly two Unicode uppercase letters -- a pure text match, independent
// of whether `short` was explicitly configured or derived from `name`.

// hasRoomsView (and therefore the whole chip grid) requires >= 2 valid
// rooms, so every shortGuaranteed fixture below carries a fixed second
// room purely to satisfy that minimum -- only sensor.r0 varies per test.
function oneRoomConfig(roomOverrides, extra) {
  return {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r0", name: "Living Room", ...roomOverrides }, { entity: "sensor.r1", name: "Other", short: "OT" }],
    ...extra,
  };
}

function oneRoomHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r0": mkState("sensor.r0", 24, { device_class: "temperature", unit_of_measurement: "°C" }),
    "sensor.r1": mkState("sensor.r1", 20, { device_class: "temperature", unit_of_measurement: "°C" }),
  });
}

function firstRoom(el) {
  return [...el._computeData().rooms].find((r) => r.entity === "sensor.r0");
}

test("shortGuaranteed: explicit two-uppercase-letter short (e.g. WZ) is guaranteed", () => {
  const el = env.createCard(oneRoomConfig({ short: "WZ" }), oneRoomHass());
  const room = firstRoom(el);
  assert.equal(room.displayLabel, "WZ");
  assert.equal(room.shortGuaranteed, true);
  const shortEl = el.shadowRoot.querySelector('[data-entity="sensor.r0"] .rtc-room-short');
  assert.ok(shortEl.hasAttribute("data-short-guaranteed"));
  env.cleanup(el);
});

test("shortGuaranteed: all seven documented example codes are guaranteed, including KÜ (Unicode uppercase)", () => {
  for (const code of ["WZ", "WC", "AZ", "SZ", "FL", "BA", "KÜ"]) {
    const el = env.createCard(oneRoomConfig({ short: code }), oneRoomHass());
    assert.equal(firstRoom(el).shortGuaranteed, true, `code=${code}`);
    env.cleanup(el);
  }
});

test("shortGuaranteed: a derived (not explicitly configured) two-letter label is guaranteed too -- the check is purely text-based", () => {
  // No `short` configured: falls back to name/entity. A 2-uppercase-letter
  // name is a contrived but valid case -- the guarantee must not care
  // whether `short` was explicitly set.
  const el = env.createCard(oneRoomConfig({ name: "WZ", short: undefined }), oneRoomHass());
  const room = firstRoom(el);
  assert.equal(room.displayLabel, "WZ");
  assert.equal(room.shortGuaranteed, true);
  env.cleanup(el);
});

test("shortGuaranteed: longer labels (WOHNZ, WZ1) are NOT guaranteed and keep the normal ellipsis fallback", () => {
  for (const code of ["WOHNZ", "WZ1"]) {
    const el = env.createCard(oneRoomConfig({ short: code }), oneRoomHass());
    const room = firstRoom(el);
    assert.equal(room.displayLabel, code);
    assert.equal(room.shortGuaranteed, false, `code=${code}`);
    const shortEl = el.shadowRoot.querySelector('[data-entity="sensor.r0"] .rtc-room-short');
    assert.equal(shortEl.hasAttribute("data-short-guaranteed"), false);
    env.cleanup(el);
  }
});

test("shortGuaranteed: lowercase two-letter short (kü) is NOT guaranteed (exact uppercase match only)", () => {
  const el = env.createCard(oneRoomConfig({ short: "kü" }), oneRoomHass());
  assert.equal(firstRoom(el).shortGuaranteed, false);
  env.cleanup(el);
});

test("shortGuaranteed: room_label:'name' with a full room name is NOT guaranteed even if `short` would qualify", () => {
  const el = env.createCard(oneRoomConfig({ short: "WZ", name: "Living Room" }, { room_label: "name" }), oneRoomHass());
  const room = firstRoom(el);
  assert.equal(room.displayLabel, "Living Room");
  assert.equal(room.shortGuaranteed, false);
  env.cleanup(el);
});

test("shortGuaranteed: a stale data-short-guaranteed attribute is removed on setConfig() (patched chip, not recreated)", () => {
  const el = env.createCard(oneRoomConfig({ short: "WZ" }), oneRoomHass());
  const shortElBefore = el.shadowRoot.querySelector('[data-entity="sensor.r0"] .rtc-room-short');
  assert.ok(shortElBefore.hasAttribute("data-short-guaranteed"), "precondition: guaranteed initially");

  el.setConfig(oneRoomConfig({ short: "Wohnzimmer" }));

  const shortElAfter = el.shadowRoot.querySelector('[data-entity="sensor.r0"] .rtc-room-short');
  assert.equal(shortElAfter, shortElBefore, "AP-09: same chip node, patched not recreated");
  assert.equal(shortElAfter.hasAttribute("data-short-guaranteed"), false, "stale guarantee attribute must be actively removed");
  env.cleanup(el);
});

// ==== show_rooms ====

test("show_rooms:false removes .rtc-room-grid from the DOM but leaves data.hasRoomsView/extrema/footer text fully populated", () => {
  const el = env.createCard(fourRoomConfig({ show_rooms: false }), fourRoomHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-room-grid"), null);
  const data = el._computeData();
  assert.equal(data.hasRoomsView, true, "rooms remain a data source even with chips hidden");
  assert.equal(data.showRoomChips, false);
  assert.ok(data.coolest && data.warmest, "extrema must still be computed");
  assert.equal(data.rooms.length, 4, "data.rooms itself is untouched -- only the render path hides it");
  env.cleanup(el);
});

test("show_rooms: true (default) renders .rtc-room-grid as before (regression)", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  assert.ok(el.shadowRoot.querySelector(".rtc-room-grid"));
  env.cleanup(el);
});

test("show_rooms:false via setConfig() removes an already-rendered grid (forces _renderAll(), not a partial update)", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  assert.ok(el.shadowRoot.querySelector(".rtc-room-grid"), "precondition: grid must be rendered");
  el.setConfig(fourRoomConfig({ show_rooms: false }));
  assert.equal(el.shadowRoot.querySelector(".rtc-room-grid"), null);
  env.cleanup(el);
});

test("show_rooms:false does not disable the scale view's cold/warm markers or comfort footer (both driven by hasRoomsView, not showRoomChips)", () => {
  const el = env.createCard(fourRoomConfig({ show_rooms: false }), fourRoomHass());
  const html = el._renderScaleView(el._computeData());
  assert.ok(html.includes("rtc-marker-cold"), "cold marker must still render");
  assert.ok(html.includes("rtc-marker-warm"), "warm marker must still render");
  env.cleanup(el);
});

// ==== getCardSize() ====

test("getCardSize(): show_rooms:false returns the base size (3) regardless of room count", () => {
  for (const roomCount of [2, 5, 10]) {
    const rooms = Array.from({ length: roomCount }, (_, i) => ({ entity: `sensor.r${i}`, name: `Room ${i}` }));
    const el = env.document.createElement("room-climate-card");
    el.setConfig({ entity: "sensor.avg", rooms, show_rooms: false });
    assert.equal(el.getCardSize(), 3, `show_rooms:false at ${roomCount} rooms`);
  }
});

test("getCardSize(): show_rooms true (default) still scales with room count (regression)", () => {
  const el = env.document.createElement("room-climate-card");
  el.setConfig({
    entity: "sensor.avg",
    rooms: Array.from({ length: 10 }, (_, i) => ({ entity: `sensor.r${i}`, name: `Room ${i}` })),
  });
  assert.ok(el.getCardSize() > 3, "10 rooms with chips visible must exceed the base size");
});

"use strict";

// room_sort, room_label and show_rooms are presentation options. room_sort only reorders
// the rendered chips (data.rooms.visible), never data.allRooms (extrema/comfort/spread stay
// value-sorted). room_label is a static 3-way choice between room.short/room.name.
// show_rooms:false hides only the chip grid; rooms stay full data sources.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// Four rooms with distinct values/names so every sort mode gives an unambiguous order.
// Declared order (Kitchen, Attic, Den, Bath) is neither alphabetical nor value-sorted.
function fourRoomHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.rc": mkState("sensor.rc", 24, TEMPERATURE_C), // Kitchen
    "sensor.ra": mkState("sensor.ra", 18, TEMPERATURE_C), // Attic
    "sensor.rd": mkState("sensor.rd", 26, TEMPERATURE_C), // Den
    "sensor.rb": mkState("sensor.rb", 20, TEMPERATURE_C), // Bath
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

function roomNames(viewModel) {
  // [...visible] re-homes the array in this realm before .map(): it is created in the card's
  // jsdom vm realm, so assert.deepStrictEqual otherwise fails on realm identity.
  return [...viewModel.rooms.visible].map((r) => r.name);
}

// ==== _normalizeConfig() ====

test("integration: room_sort/room_label/show_rooms default correctly, invalid values fall back silently", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  assert.equal(el._config.room_sort, "value_asc");
  assert.equal(el._config.room_label, "auto");
  assert.equal(el._config.show.rooms, "auto");
  env.cleanup(el);

  const el2 = env.createCard(fourRoomConfig({ room_sort: "bogus", room_label: "bogus", show_rooms: "bogus" }), fourRoomHass());
  assert.equal(el2._config.room_sort, "value_asc", "invalid room_sort falls back to the default");
  assert.equal(el2._config.room_label, "auto", "invalid room_label falls back to the default");
  assert.equal(el2._config.show.rooms, "auto", "an unrecognized show_rooms falls back to auto, like every other optional top-level enum");
  env.cleanup(el2);
});

// ==== room_sort: presentation only ====

test("room_sort: value_asc (default) orders chips by value ascending, name as tie-break", () => {
  const el = env.createCard(fourRoomConfig(), fourRoomHass());
  const data = el._computeViewModel();
  assert.deepEqual(roomNames(data), ["Attic", "Bath", "Kitchen", "Den"]); // 18, 20, 24, 26
  env.cleanup(el);
});

test("room_sort: value_desc orders chips by value descending", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "value_desc" }), fourRoomHass());
  const data = el._computeViewModel();
  assert.deepEqual(roomNames(data), ["Den", "Kitchen", "Bath", "Attic"]); // 26, 24, 20, 18
  env.cleanup(el);
});

test("room_sort: name orders chips alphabetically", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "name" }), fourRoomHass());
  const data = el._computeViewModel();
  assert.deepEqual(roomNames(data), ["Attic", "Bath", "Den", "Kitchen"]);
  env.cleanup(el);
});

test("room_sort: configured preserves the declaration order from rooms:", () => {
  const el = env.createCard(fourRoomConfig({ room_sort: "configured" }), fourRoomHass());
  const data = el._computeViewModel();
  assert.deepEqual(roomNames(data), ["Kitchen", "Attic", "Den", "Bath"]);
  env.cleanup(el);
});

test("room_sort: NEVER affects the extrema, the comfort count or the spread, across all four modes", () => {
  const baseline = env.createCard(fourRoomConfig({ room_sort: "value_asc" }), fourRoomHass())._computeViewModel();
  for (const mode of ["value_desc", "name", "configured"]) {
    const el = env.createCard(fourRoomConfig({ room_sort: mode }), fourRoomHass());
    const data = el._computeViewModel();
    assert.equal(data.extremes.coolest.name, baseline.extremes.coolest.name, `${mode}: coolest must stay Attic regardless of chip order`);
    assert.equal(data.extremes.warmest.name, baseline.extremes.warmest.name, `${mode}: warmest must stay Den regardless of chip order`);
    assert.equal(data.average.value, baseline.average.value);
    assert.equal(data.comfort.inComfort, baseline.comfort.inComfort);
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
  const dataShort = elShort._computeViewModel();
  const dataName = elName._computeViewModel();
  assert.equal(dataShort.average.value, dataName.average.value);
  assert.equal(dataShort.comfort.inComfort, dataName.comfort.inComfort);
  const chipTitleShort = elShort.shadowRoot.querySelector('[data-entity="sensor.rc"]').getAttribute("title");
  const chipTitleName = elName.shadowRoot.querySelector('[data-entity="sensor.rc"]').getAttribute("title");
  assert.equal(chipTitleShort, chipTitleName, "the full name always stays in the tooltip regardless of room_label");
  env.cleanup(elShort);
  env.cleanup(elName);
});

// ==== shortGuaranteed ====
// A room's short code must never shrink/ellipsize when the rendered label
// (room.displayLabel) is exactly two Unicode uppercase letters -- a pure text match,
// regardless of whether `short` was configured or derived from `name`.

// A fixed second room keeps the comparable-room path covered; only sensor.r0 varies per test.
function oneRoomConfig(roomOverrides, extra) {
  return {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.r0", name: "Living Room", ...roomOverrides }, { entity: "sensor.r1", name: "Other", short: "OT" }],
    ...extra,
  };
}

function oneRoomHass() {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.r0": mkState("sensor.r0", 24, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 20, TEMPERATURE_C),
  });
}

function firstRoom(el) {
  return [...el._computeViewModel().rooms.visible].find((r) => r.entity === "sensor.r0");
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
  // No `short` configured: falls back to name. A 2-uppercase-letter name is contrived but valid; the guarantee must not care.
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

test("show_rooms:false removes .rtc-room-grid from the DOM but leaves data.rooms.comparable/extrema/footer text fully populated", () => {
  const el = env.createCard(fourRoomConfig({ show_rooms: false }), fourRoomHass());
  assert.equal(el.shadowRoot.querySelector(".rtc-room-grid"), null);
  const data = el._computeViewModel();
  assert.equal(data.rooms.comparable, true, "rooms remain a data source even with chips hidden");
  assert.equal(data.rooms.showChips, false);
  assert.ok((data.extremes?.coolest ?? null) && (data.extremes?.warmest ?? null), "extrema must still be computed");
  assert.equal(data.rooms.visible.length, 4, "data.rooms.visible itself is untouched -- only the render path hides it");
  env.cleanup(el);
});

test("show_rooms: auto (default) renders .rtc-room-grid for several rooms, as before", () => {
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

test("show_rooms:false does not disable the scale view's cold/warm markers or comfort footer (both driven by roomsComparable, not showRoomChips)", () => {
  const el = env.createCard(fourRoomConfig({ show_rooms: false }), fourRoomHass());
  const html = internals.viewMarkup(el, "scale");
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

test("getCardSize(): show_rooms auto scales with a multi-room grid (regression)", () => {
  const el = env.document.createElement("room-climate-card");
  el.setConfig({
    entity: "sensor.avg",
    rooms: Array.from({ length: 10 }, (_, i) => ({ entity: `sensor.r${i}`, name: `Room ${i}` })),
  });
  assert.ok(el.getCardSize() > 3, "10 rooms with chips visible must exceed the base size");
});

test("getCardSize(): the hint applies the same source rule the card does", () => {
  // A room the card can never use is not a source, so the hint reserves no chip row for it.
  // Before any hass update the config alone decides -- the stable answer for a layout hint.
  const config = {
    entity: "sensor.avg",
    rooms: [{ entity: "sensor.avg", name: "Living room" }, { entity: "sensor.humidity", name: "Bath" }],
  };
  const el = env.document.createElement("room-climate-card");
  el.setConfig(config);
  assert.ok(el.getCardSize() > 3, "without states every configured source counts");

  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.humidity": mkState("sensor.humidity", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  assert.equal(el.getCardSize(), 3, "the one remaining source IS the headline, so no chip is drawn");

  // A distinct primary plus a foreign room leaves nothing for the grid -- not even under show.rooms: true.
  const noRoomsLeft = env.document.createElement("room-climate-card");
  noRoomsLeft.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.humidity", name: "Bath" }], show_rooms: true });
  noRoomsLeft.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE_C),
    "sensor.humidity": mkState("sensor.humidity", 50, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  assert.equal(noRoomsLeft.getCardSize(), 3);
});

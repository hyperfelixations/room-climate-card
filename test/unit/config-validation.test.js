"use strict";

// CFG-01 (v2.15.0 audit): Number(true) === 1, so a naive Number(value)
// parser would silently accept booleans as valid numeric config (e.g.
// `decimals: true` -> 1). _parseConfigNumber() must reject anything that
// isn't a real number or a numeric-looking string, and rotation_seconds/
// slide_seconds must have practical upper bounds so an extreme value can't
// overflow the animation/timer millisecond math.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env;
let el;

test.before(() => {
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card"); // pure parser, no config/hass needed
});
test.after(() => {
  env.cleanupAll();
});

// ---- _parseConfigNumber() direct tests ----

test("_parseConfigNumber: booleans are rejected, not coerced to 0/1", () => {
  assert.equal(el._parseConfigNumber(true), null);
  assert.equal(el._parseConfigNumber(false), null);
});

test("_parseConfigNumber: arrays and plain objects are rejected", () => {
  assert.equal(el._parseConfigNumber([]), null);
  assert.equal(el._parseConfigNumber([5]), null);
  assert.equal(el._parseConfigNumber({}), null);
  assert.equal(el._parseConfigNumber({ value: 5 }), null);
});

test("_parseConfigNumber: null/undefined are rejected", () => {
  assert.equal(el._parseConfigNumber(null), null);
  assert.equal(el._parseConfigNumber(undefined), null);
});

test("_parseConfigNumber: real numbers pass through, non-finite numbers are rejected", () => {
  assert.equal(el._parseConfigNumber(5), 5);
  assert.equal(el._parseConfigNumber(-2.5), -2.5);
  assert.equal(el._parseConfigNumber(0), 0);
  assert.equal(el._parseConfigNumber(NaN), null);
  assert.equal(el._parseConfigNumber(Infinity), null);
  assert.equal(el._parseConfigNumber(-Infinity), null);
});

test("_parseConfigNumber: fully-numeric strings are accepted", () => {
  assert.equal(el._parseConfigNumber("5"), 5);
  assert.equal(el._parseConfigNumber("5.5"), 5.5);
  assert.equal(el._parseConfigNumber("-3"), -3);
  assert.equal(el._parseConfigNumber("+3"), 3);
  assert.equal(el._parseConfigNumber(" 5 "), 5);
  assert.equal(el._parseConfigNumber(".5"), 0.5);
});

test("_parseConfigNumber: non-numeric or partially-numeric strings are rejected", () => {
  for (const bad of ["5abc", "abc", "", "true", "1,5", "1e3", "NaN", "5 6"]) {
    assert.equal(el._parseConfigNumber(bad), null, `"${bad}" must be rejected`);
  }
});

// ---- _normalizeDecimalsOverride() ----

test("_normalizeDecimalsOverride: booleans rejected (the CFG-01 bug case)", () => {
  assert.equal(el._normalizeDecimalsOverride(true), null);
  assert.equal(el._normalizeDecimalsOverride(false), null);
});

test("_normalizeDecimalsOverride: 0, 1, 2 are valid; out-of-range and non-integers are not", () => {
  assert.equal(el._normalizeDecimalsOverride(0), 0);
  assert.equal(el._normalizeDecimalsOverride(1), 1);
  assert.equal(el._normalizeDecimalsOverride(2), 2);
  assert.equal(el._normalizeDecimalsOverride(3), null);
  assert.equal(el._normalizeDecimalsOverride(-1), null);
  assert.equal(el._normalizeDecimalsOverride(1.5), null);
});

test("_normalizeDecimalsOverride: undefined/null/empty-string all mean 'use mode default'", () => {
  assert.equal(el._normalizeDecimalsOverride(undefined), null);
  assert.equal(el._normalizeDecimalsOverride(null), null);
  assert.equal(el._normalizeDecimalsOverride(""), null);
});

// ---- _normalizePositiveInteger() (room_columns/room_rows) ----

test("_normalizePositiveInteger: booleans rejected", () => {
  assert.equal(el._normalizePositiveInteger(true), null);
});

test("_normalizePositiveInteger: 1-20 valid, 0/negative/>20/non-integer invalid", () => {
  assert.equal(el._normalizePositiveInteger(1), 1);
  assert.equal(el._normalizePositiveInteger(20), 20);
  assert.equal(el._normalizePositiveInteger(0), null);
  assert.equal(el._normalizePositiveInteger(-5), null);
  assert.equal(el._normalizePositiveInteger(21), null);
  assert.equal(el._normalizePositiveInteger(3.5), null);
});

// ---- _normalizePositiveSeconds() ----

test("_normalizePositiveSeconds: within [min,max] is accepted, outside falls back to the default", () => {
  assert.equal(el._normalizePositiveSeconds(30, 14, 1, 3600), 30);
  assert.equal(el._normalizePositiveSeconds(1, 14, 1, 3600), 1);
  assert.equal(el._normalizePositiveSeconds(3600, 14, 1, 3600), 3600);
  assert.equal(el._normalizePositiveSeconds(0, 14, 1, 3600), 14, "below min falls back");
  assert.equal(el._normalizePositiveSeconds(3601, 14, 1, 3600), 14, "above max falls back");
  assert.equal(el._normalizePositiveSeconds(999999, 14, 1, 3600), 14, "an extreme value falls back, protecting the timer math");
});

test("_normalizePositiveSeconds: booleans/junk fall back to the default", () => {
  assert.equal(el._normalizePositiveSeconds(true, 14, 1, 3600), 14);
  assert.equal(el._normalizePositiveSeconds("abc", 14, 1, 3600), 14);
});

// ---- Full setConfig() integration: confirms the parsers are actually wired up ----

const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }) });

test("integration: decimals:true is rejected end to end, does not become 1", () => {
  const card = env.createCard({ entity: "sensor.avg", decimals: true }, hass);
  assert.equal(card._config.decimals, null);
  env.cleanup(card);
});

test("integration: room_columns:true / room_rows:true are rejected end to end", () => {
  const card = env.createCard({ entity: "sensor.avg", room_columns: true, room_rows: true }, hass);
  assert.equal(card._config.room_columns, null);
  assert.equal(card._config.room_rows, null);
  env.cleanup(card);
});

test("integration: rotation_seconds/slide_seconds outside bounds fall back to 14/1", () => {
  const card = env.createCard({ entity: "sensor.avg", rotation_seconds: 999999, slide_seconds: 50 }, hass);
  assert.equal(card._config.rotation_seconds, 14);
  assert.equal(card._config.slide_seconds, 1);
  env.cleanup(card);
});

test("integration: valid overrides are honored end to end", () => {
  const card = env.createCard({ entity: "sensor.avg", decimals: 2, room_columns: 4, rotation_seconds: 20, slide_seconds: 2 }, hass);
  assert.equal(card._config.decimals, 2);
  assert.equal(card._config.room_columns, 4);
  assert.equal(card._config.rotation_seconds, 20);
  assert.equal(card._config.slide_seconds, 2);
  env.cleanup(card);
});

// ---- Reviewer fix P2 (post-2.27.0): duplicate rooms[].entity is rejected ----
// _updateRoomGrid() (AP-09) keys its keyed DOM patching by room.entity; a
// duplicate would silently make the Map overwrite one chip. Without any
// uniqueness enforcement here, that invalid state was reachable from plain
// YAML.

test("integration: duplicate rooms[].entity throws with the offending entity named", () => {
  assert.throws(
    () =>
      env.createCard(
        {
          entity: "sensor.avg",
          rooms: [
            { entity: "sensor.r1", name: "Room 1" },
            { entity: "sensor.r2", name: "Room 2" },
            { entity: "sensor.r1", name: "Room 1 duplicate" },
          ],
        },
        hass
      ),
    /duplicate rooms\[\]\.entity "sensor\.r1"/
  );
});

test("integration: distinct rooms[].entity values are still accepted (regression)", () => {
  const card = env.createCard(
    {
      entity: "sensor.avg",
      rooms: [
        { entity: "sensor.r1", name: "Room 1" },
        { entity: "sensor.r2", name: "Room 2" },
      ],
    },
    hass
  );
  assert.equal(card._config.rooms.length, 2);
  env.cleanup(card);
});

test("integration: an existing valid card is not left in an inconsistent state by a rejected duplicate-entity setConfig()", () => {
  const card = env.createCard(
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", name: "Room 1" }, { entity: "sensor.r2", name: "Room 2" }] },
    hass
  );
  assert.throws(() =>
    card.setConfig({
      entity: "sensor.avg",
      rooms: [{ entity: "sensor.r3", name: "Room 3" }, { entity: "sensor.r3", name: "Room 3 duplicate" }],
    })
  );
  // The previous, still-valid config must remain in effect (setConfig()
  // throwing must not have partially overwritten this._config).
  assert.equal(card._config.rooms.length, 2);
  assert.equal(card._config.rooms[0].entity, "sensor.r1");
  env.cleanup(card);
});

// getStubConfig(): the Home Assistant card-picker/editor placeholder. Must
// stay generic (no maintainer-specific household entities/room names) and
// must itself be a config setConfig() actually accepts.
test("getStubConfig() is generic (no household-specific entities/rooms) and is a valid config", () => {
  const stub = el.constructor.getStubConfig();
  const serialized = JSON.stringify(stub);
  for (const forbidden of ["wohnung", "küche", "kü", "schlafzimmer", "arbeitszimmer", "flur", "wc", "az_", "sz_", "wz_", "ba_", "fl_", "ku_"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `getStubConfig() must not contain "${forbidden}"`);
  }
  const card = env.createCard(stub, hass);
  assert.equal(card._config.entity, stub.entity);
  assert.equal(card._config.rooms.length, stub.rooms.length);
  env.cleanup(card);
});

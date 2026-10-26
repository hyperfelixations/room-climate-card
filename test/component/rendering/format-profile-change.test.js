"use strict";

// A change of how numbers, times and their time zone are written reaches every number and time
// the card shows. It arrives with `hass` (the profile, or Home Assistant's zone) or with the
// card's `number_format`, `time_format` or `time_zone`; either way the mounted card is patched
// in place, and its DOM must then equal a card rendered fresh with that format. What each format
// writes is format-profile.test.js's. See internal dev doc §5 "Profilformate".
process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// The carousel phase is `Date.now() % cycle`; both cards of a comparison must see one instant.
const FIXED_NOW_MS = 1_750_000_000_000;

let env;

test.before(() => {
  env = createTestEnvironment();
  env.window.Date.now = () => FIXED_NOW_MS;
});
test.after(() => {
  env.cleanupAll();
});

const RANGE = { unit_of_measurement: "°C", minimum: 1018.5, maximum: 1023.25, minimum_timestamp: "2026-07-24T06:12:00Z", maximum_timestamp: "2026-07-24T15:41:00Z" };
const STATES = {
  "sensor.avg": mkState("sensor.avg", 1021.4, TEMPERATURE_C),
  "sensor.r1": mkState("sensor.r1", 1020.1, TEMPERATURE_C),
  "sensor.r2": mkState("sensor.r2", 1023.2, TEMPERATURE_C),
  "sensor.range": mkState("sensor.range", 4.75, RANGE),
  "sensor.trend": mkState("sensor.trend", 0.4, { unit_of_measurement: "°C/h" }),
};
const ROOMS = [{ entity: "sensor.r1", name: "Living room" }, { entity: "sensor.r2", name: "Bedroom" }];
const CONFIG = { entity: "sensor.avg", range_entity: "sensor.range", trend_entity: "sensor.trend", rooms: ROOMS, views: ["range", "range_scale", "scale", "extremes"] };

// English with no format in the profile: grouped numbers, the 12-hour clock, the runtime's zone.
const hassWith = (profile = {}, serverTimeZone) => {
  const hass = mkHass({ ...STATES }, "en");
  hass.locale = { ...hass.locale, ...profile };
  if (serverTimeZone) hass.config = { time_zone: serverTimeZone };
  return hass;
};

const CHANGES = {
  "comma decimals": { profile: { number_format: "decimal_comma" }, option: { number_format: "decimal_comma" }, shows: "1.021,4" },
  "no grouping": { profile: { number_format: "none" }, option: { number_format: "none" }, shows: "1021.4" },
  "the 24-hour clock": { profile: { time_format: "24" }, option: { time_format: 24 }, shows: "15:41" },
  "Home Assistant's time zone": { profile: { time_zone: "server" }, option: { time_zone: "server" }, zone: "Asia/Tokyo", shows: "3:12 PM" },
};

const markup = (el) => el.shadowRoot.innerHTML;

test("the starting card writes English numbers and times, so every change below is visible", () => {
  const el = env.createCard(CONFIG, hassWith());
  const text = el.shadowRoot.textContent;
  assert.match(text, /1,021\.4/);
  assert.match(text, /6:12\sAM/);
  for (const { shows } of Object.values(CHANGES)) assert.doesNotMatch(text, new RegExp(shows.replace(/\./g, "\\.")));
  env.cleanup(el);
});

for (const [name, change] of Object.entries(CHANGES)) {
  test(`${name}: a profile change through hass patches every number and time`, () => {
    const patched = env.createCard(CONFIG, hassWith({}, change.zone));
    const root = patched.shadowRoot.querySelector(".rtc-root");
    patched.hass = hassWith(change.profile, change.zone);
    assert.equal(patched.shadowRoot.querySelector(".rtc-root"), root, "patched, not rebuilt");
    assert.match(patched.shadowRoot.textContent, new RegExp(change.shows.replace(/\./g, "\\.")));
    const fresh = env.createCard(CONFIG, hassWith(change.profile, change.zone));
    assert.equal(markup(patched), markup(fresh), "patched differs from a fresh card");
    env.cleanup(patched);
    env.cleanup(fresh);
  });

  test(`${name}: the card option patches every number and time`, () => {
    const hass = hassWith({}, change.zone);
    const patched = env.createCard(CONFIG, hass);
    const root = patched.shadowRoot.querySelector(".rtc-root");
    patched.setConfig({ ...CONFIG, ...change.option });
    assert.equal(patched.shadowRoot.querySelector(".rtc-root"), root, "patched, not rebuilt");
    assert.match(patched.shadowRoot.textContent, new RegExp(change.shows.replace(/\./g, "\\.")));
    const fresh = env.createCard({ ...CONFIG, ...change.option }, hass);
    assert.equal(markup(patched), markup(fresh), "patched differs from a fresh card");
    env.cleanup(patched);
    env.cleanup(fresh);
  });
}

test("a new Home Assistant zone alone re-renders a card that follows it", () => {
  const patched = env.createCard(CONFIG, hassWith({ time_zone: "server" }, "Asia/Tokyo"));
  patched.hass = hassWith({ time_zone: "server" }, "America/New_York");
  assert.match(patched.shadowRoot.textContent, /2:12\sAM/);
  const fresh = env.createCard(CONFIG, hassWith({ time_zone: "server" }, "America/New_York"));
  assert.equal(markup(patched), markup(fresh));
  env.cleanup(patched);
  env.cleanup(fresh);
});

test("the format cache invalidates on a config-only change with the same hass object", () => {
  const hass = hassWith();
  const el = env.createCard(CONFIG, hass);
  assert.equal(el._fmt(1234.5, 1), "1,234.5");
  el.setConfig({ ...CONFIG, number_format: "decimal_comma" });
  assert.equal(el._fmt(1234.5, 1), "1.234,5", "cache must not still return the previous format");
  el.setConfig({ ...CONFIG, number_format: "decimal_comma", time_format: "24" });
  assert.equal(el._formatTime("2026-07-24T18:41:00Z"), "18:41");
  env.cleanup(el);
});

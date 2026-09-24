"use strict";

// The card picker's start configuration applied to the assembled card, the way the picker
// previews it: getStubConfig(hass) from the bundle, then setConfig() with that same hass. The
// promise under test is a working preview — data, no warning, the rooms averaged. How the rooms
// are chosen is pinned in contract/card-suggestions.test.js; the population sweep that renders
// every generated start configuration is property/discovery.property.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { HUMIDITY, TEMPERATURE_C } = require("../../fixtures/attributes.js");
const { installation, sensor } = require("../../fixtures/installation.js");

let env;
let RoomClimateCard;

test.before(() => {
  env = createTestEnvironment();
  RoomClimateCard = env.window.customElements.get("room-climate-card");
});
test.after(() => env.cleanupAll());

const withFrontend = (hass) => ({ ...hass, language: "en", locale: { language: "en" }, callService: () => {} });
const BATTERY = { device_class: "battery", unit_of_measurement: "%" };

// Two TIMMERFLOTTE sensors in two areas, each with temperature, humidity and battery.
function timmerflotte() {
  return withFrontend(
    installation({
      areas: [["wohnzimmer", "Wohnzimmer"], ["bad", "Bad"]],
      devices: { wz: { area_id: "wohnzimmer" }, ba: { area_id: "bad" } },
      sensors: [
        sensor("sensor.wz_batterie", BATTERY, { state: 100, name: "WZ Batterie", registry: { device_id: "wz", entity_category: "diagnostic" } }),
        sensor("sensor.wz_luftfeuchtigkeit", HUMIDITY, { state: 63.3, name: "WZ Luftfeuchtigkeit", registry: { device_id: "wz" } }),
        sensor("sensor.wz_temperatur", TEMPERATURE_C, { state: 21.4, name: "WZ Temperatur", registry: { device_id: "wz" } }),
        sensor("sensor.ba_batterie", BATTERY, { state: 100, name: "BA Batterie", registry: { device_id: "ba" } }),
        sensor("sensor.ba_luftfeuchtigkeit", HUMIDITY, { state: 69, name: "BA Luftfeuchtigkeit", registry: { device_id: "ba" } }),
        sensor("sensor.ba_temperatur", TEMPERATURE_C, { state: 22, name: "BA Temperatur", registry: { device_id: "ba" } }),
      ],
    })
  );
}

test("the start configuration previews a temperature card averaging its rooms, without a warning", () => {
  const hass = timmerflotte();
  const stub = RoomClimateCard.getStubConfig(hass, [], []);
  env.withCard({ type: "custom:room-climate-card", ...stub }, hass, (card) => {
    const data = card._computeViewModel();
    assert.equal(data.empty, false);
    assert.equal(data.metric.kind, "temperature");
    assert.equal(data.rooms.count, 2);
    assert.ok(Math.abs(data.average.value - 21.7) < 1e-9, `the mean of 21.4 and 22, got ${data.average.value}`);
    assert.equal(card.shadowRoot.querySelector(".rtc-warning"), null);
  });
});

test("a one-room start configuration previews that room on its own", () => {
  const hass = withFrontend(installation({ areas: [["den", "Den"]], sensors: [sensor("sensor.den", HUMIDITY, { state: 48, registry: { area_id: "den" } })] }));
  const stub = RoomClimateCard.getStubConfig(hass);
  assert.deepEqual(JSON.parse(JSON.stringify(stub)), { rooms: [{ name: "Den", entity: "sensor.den" }] });
  env.withCard({ type: "custom:room-climate-card", ...stub }, hass, (card) => {
    const data = card._computeViewModel();
    assert.equal(data.metric.kind, "humidity");
    assert.equal(data.average.value, 48);
    assert.equal(card.shadowRoot.querySelector(".rtc-warning"), null);
  });
});

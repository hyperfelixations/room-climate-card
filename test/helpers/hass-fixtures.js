"use strict";

// Synthetic `hass` and entity-state builders shared by the unit (jsdom) and browser
// (Playwright) layers. UMD-ish (module.exports when available, otherwise a global) so the
// same file works via `require()` in Node and a bare <script> tag in harness.html. It
// therefore imports nothing and writes its attribute literals out rather than taking them
// from test/fixtures/attributes.js: a `require()` here is a ReferenceError in the page.

function mkState(entityId, state, attributes) {
  return {
    entity_id: entityId,
    state: String(state),
    attributes: attributes || {},
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

function mkHass(states, language) {
  return {
    language: language || "en",
    locale: { language: language || "en" },
    states: states || {},
    callService: () => {},
  };
}

// Home entity + N temperature rooms with valid, comfort-band values,
// convenient for tests that only care about structure/count, not exact numbers.
function mkTemperatureFixture(roomCount) {
  const states = {
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature" }),
  };
  const rooms = [];
  for (let i = 0; i < roomCount; i++) {
    const entity = `sensor.room${i}`;
    // Spread values across/around the comfort band (20-24) so coldest/warmest differ.
    const value = 20 + (i % 6);
    states[entity] = mkState(entity, value, { device_class: "temperature" });
    rooms.push({ name: `Room ${i}`, short: `R${i}`, entity });
  }
  return { hass: mkHass(states), rooms };
}

const api = { mkState, mkHass, mkTemperatureFixture };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.HassFixtures = api;
}

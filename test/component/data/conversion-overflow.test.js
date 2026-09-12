"use strict";

// Card-level check that no unit conversion hands a non-finite number to the display: a room
// reading beyond what the display unit can hold, a range width or extreme, a primary's spread
// attribute and a trend rate — each finite as written, each overflowing on its way to a
// Fahrenheit display. Boundary: where each of these is decided is unit-tested at its owner
// (application-entity-context, application-model-modules, application-domain-view).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { buildScenario } = require("../../fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

const F = { unit: { value: "°F" } };
const C = { unit: { value: "°C" } };

// The static `maxSpan: Infinity` of the last dynamic Fahrenheit step is the one legitimate
// non-finite number in the view model.
function nonFiniteNumbers(value, path = "", found = []) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) && !/dynamicDisplaySteps\.\d+\.maxSpan$/.test(path)) found.push(`${path} = ${value}`);
  } else if (value && typeof value === "object" && typeof value !== "function") {
    for (const key of Object.keys(value)) nonFiniteNumbers(value[key], path ? `${path}.${key}` : key, found);
  }
  return found;
}

function assertEverythingFinite(built) {
  env.withCard(built.config, built.hass, (card) => {
    assert.deepEqual(nonFiniteNumbers(card._computeViewModel()), []);
    assert.doesNotMatch(card.shadowRoot.textContent, /Infinity|∞|NaN/);
  });
}

test("a room beyond what the display unit can hold never reaches the card as a number", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: { state: 70, ...F },
    rooms: [{ state: 1e308, ...C }, { state: 20, ...C }, { state: 22, ...C }],
  });
  assertEverythingFinite(built);
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    // Array.from rebuilds the card realm's array in this one, so the comparison is by value.
    assert.deepEqual(Array.from(model.roomMarkers, (marker) => marker.entity), ["sensor.room1", "sensor.room2"]);
    assert.ok(Math.abs(model.spread - 3.6) < 1e-9, `spread ${model.spread} is the two representable rooms`);
  });
});

test("a range whose width or extreme overflows shows no range value", () => {
  const views = [{ type: "range" }, { type: "range_scale", enabled: true }, { type: "scale" }];
  for (const [state, minimum, maximum] of [[5, 10, 1e308], [1e308, 10, 15]]) {
    assertEverythingFinite(
      buildScenario({
        metric: "temperature",
        primary: { state: 70, ...F },
        extras: [{ id: "sensor.range", state, ...C, extraAttributes: { minimum, maximum } }],
        config: { range_entity: "sensor.range", views },
      })
    );
  }
});

test("a spread attribute that overflows leaves the footer to the rooms", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: { state: 70, ...F, extraAttributes: { spread: 1e308 } },
    rooms: [{ state: 68, ...F }, { state: 72, ...F }],
  });
  assertEverythingFinite(built);
  env.withCard(built.config, built.hass, (card) => {
    assert.ok(Math.abs(card._computeViewModel().spread - 4) < 1e-9);
  });
});

test("a trend rate that overflows shows no trend", () => {
  for (const unit of ["°F/h", "°C/h"]) {
    const built = buildScenario({
      metric: "temperature",
      primary: { state: 70, ...F },
      extras: [{ id: "sensor.trend", state: 1e308, unit: { value: unit } }],
      config: { trend_entity: "sensor.trend" },
    });
    assertEverythingFinite(built);
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().trend?.model ?? null, null, unit);
    });
  }
});

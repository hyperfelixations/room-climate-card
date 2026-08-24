"use strict";

// One reproduction per entry in the known-defect register, plus the checks that keep the
// register itself honest.
//
// Read this file to find out what is currently broken in the card and deliberately not yet
// fixed. Each reproduction asserts the behaviour the card SHOULD have, so the day the
// defect is fixed the assertion starts passing — and expectedFailure() turns that into a
// failing run that says so.

const test = require("node:test");
const assert = require("node:assert/strict");

const { KNOWN_ISSUES, expectedFailure } = require("./known-issues.js");
const { createTestEnvironment } = require("./helpers/load-card.jsdom.js");
const { buildScenario } = require("./fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

// ------------------------------------------------------- the register itself --

test("every registered issue is fully described", () => {
  for (const issue of KNOWN_ISSUES) {
    assert.match(issue.id, /^RCC-BUG-\d{2,}$/, `id "${issue.id}"`);
    assert.ok(issue.summary && issue.summary.length > 40, `${issue.id}: summary must say what is wrong`);
    assert.ok(issue.area, `${issue.id}: area`);
    assert.match(issue.discovered, /^\d{4}-\d{2}-\d{2}$/, `${issue.id}: discovered`);
    assert.ok(issue.foundBy, `${issue.id}: foundBy must name the test that turned it up`);
  }
});

test("no id is registered twice", () => {
  const ids = KNOWN_ISSUES.map((issue) => issue.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(", "));
});

test("every registered issue has a reproduction in this file", () => {
  // Without this, an entry could be added to the register and quietly never reproduced —
  // a note in a comment wearing a test's clothes.
  const source = require("node:fs").readFileSync(__filename, "utf8");
  for (const issue of KNOWN_ISSUES) {
    assert.ok(
      source.includes(`expectedFailure("${issue.id}"`),
      `${issue.id} is registered but has no expectedFailure() reproduction here`
    );
  }
});

// ------------------------------------------------------------ reproductions --

// RCC-BUG-01 — found by the property run, seed 0x99accdd, shrunk to two rooms.
//
// Two rooms whose values are 1e308 and -1e308 have a span of 2e308, which is not a double.
// The subtraction overflows to Infinity, every position derived from it divides by that
// Infinity into NaN, and the NaN is written straight into a CSS calc(). In a browser the
// declaration is simply dropped and the markers land in the wrong place; under jsdom the
// CSS parser rejects `calc(NaN% + 0px)` outright and the render throws.
//
// The threshold is exactly the overflow: ±1e200 is fine (span 2e200), ±1e308 is not. A real
// sensor cannot produce this, but a template sensor dividing by something near zero can,
// and the card's answer should be the no-data state it already has for unusable readings —
// not a card drawn at NaN per cent.
expectedFailure("RCC-BUG-01", () => {
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e308 }, { state: -1e308 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(Number.isFinite(model.extremes.warmestPosition), `warmestPosition is ${model.extremes.warmestPosition}`);
    for (const [name, position] of Object.entries(model.scale.markerPositions)) {
      assert.ok(Number.isFinite(position), `scale.markerPositions.${name} is ${position}`);
    }
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML), "NaN reached the DOM");
  });
});

// The neighbouring case that DOES work, so the boundary is recorded and a future fix can be
// checked against something. This is an ordinary test: it passes today and must keep doing so.
test("RCC-BUG-01's neighbourhood: a span that fits in a double is handled correctly", () => {
  const built = buildScenario({ metric: "temperature", rooms: [{ state: 1e200 }, { state: -1e200 }] });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.spread), `spread is ${model.spread}`);
    assert.ok(Number.isFinite(model.extremes.warmestPosition));
    assert.ok(!/NaN/.test(card.shadowRoot.innerHTML));
  });
});

// RCC-BUG-02 — found by the property run, seed 0x6627f909, shrunk to one room.
//
// One room reporting -1e308 °F. The conversion to Celsius is (F - 32) × 5/9; the
// multiplication by five overflows, and -Infinity is what comes out. The card then displays
// it: the headline reads "∞ °F" and the classification calls the room very cold.
//
// The overflow is specific to the SCALING path — °C and K at the same magnitude come
// through as ordinary (if absurd) numbers, because their conversion never multiplies.
expectedFailure("RCC-BUG-02", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: -1e308, unit: { value: "°F" }, deviceClass: null }],
  });
  env.withCard(built.config, built.hass, (card) => {
    const model = card._computeViewModel();
    assert.ok(Number.isFinite(model.average.value), `average.value is ${model.average.value}`);
    assert.ok(!/[∞]/.test(card.shadowRoot.textContent), "an infinity sign is shown as a reading");
  });
});

test("RCC-BUG-02's neighbourhood: the same magnitude in Celsius does not overflow", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: null,
    rooms: [{ state: -1e308, unit: { value: "°C" }, deviceClass: null }],
  });
  env.withCard(built.config, built.hass, (card) => {
    assert.ok(Number.isFinite(card._computeViewModel().average.value));
  });
});

// RCC-BUG-03 — found while characterising RCC-BUG-02.
//
// -274 °C is colder than anything can be. The card accepts it, averages it, classifies it
// and draws it. The same card rejects -1 % humidity, 101 % humidity, 0 ppm CO2 and a
// negative particulate concentration, each through an `invalidWhen` rule on its profile —
// and the temperature profile simply has none.
//
// Whether temperature SHOULD have one is a product decision, not a technical one, and it is
// recorded here as a defect because the card already has an opinion about impossible
// readings and does not apply it consistently.
expectedFailure("RCC-BUG-03", () => {
  for (const value of [-273.16, -274, -1000]) {
    const built = buildScenario({ metric: "temperature", primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(
        card._computeViewModel().empty,
        true,
        `${value} °C is below absolute zero and was rendered as data`
      );
    });
  }
});

test("RCC-BUG-03's neighbourhood: the other three metrics do reject their impossible readings", () => {
  const impossible = [
    ["humidity", -1],
    ["humidity", 101],
    ["humidity", 800],
    ["co2", 0],
    ["co2", -500],
    ["pm25", -1],
  ];
  for (const [metric, value] of impossible) {
    const built = buildScenario({ metric, primary: { state: value }, rooms: [] });
    env.withCard(built.config, built.hass, (card) => {
      assert.equal(card._computeViewModel().empty, true, `${metric} ${value} should be rejected`);
    });
  }
});

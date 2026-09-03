"use strict";

// Characterization of the frozen computeLegacyData() DTO, verbatim. Its return value is the
// contract between the card's data layer and every renderer/patcher, and the unit suite
// asserts individual fields against it — but not the whole shape. These baselines pin every
// key and value for the full scenario catalogue, so a change that adds, drops, reorders or
// re-rounds a field fails immediately.
// See test/helpers/characterization.js for the harness and determinism requirements.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { SCENARIOS, buildHass } = require("../helpers/characterization-scenarios.js");
const { computeLegacyData } = require("../helpers/legacy-dto.js");

let env;
let console_;

test.before(() => {
  env = createFrozenEnvironment();
  // Some scenarios legitimately warn (mixed metric kinds); recording keeps the
  // suite output clean and is asserted on separately in
  // characterization-diagnostics.test.js.
  console_ = recordConsole(env);
});

test.after(() => {
  console_.restore();
  env.cleanupAll();
});

for (const scenario of SCENARIOS) {
  test(`computeLegacyData() DTO baseline: ${scenario.name}`, () => {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const data = computeLegacyData(el);
    expectBaseline(`model/${scenario.name}.json`, stableStringify(data));
    env.cleanup(el);
  });
}

test("computeLegacyData() is a pure function of (config, hass): repeated calls return an identical DTO", () => {
  for (const scenario of SCENARIOS) {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const first = stableStringify(computeLegacyData(el));
    const second = stableStringify(computeLegacyData(el));
    assert.equal(second, first, `scenario ${scenario.name} must not depend on call order or accumulated state`);
    env.cleanup(el);
  }
});

test("the DTO key set is stable across two independently constructed cards with the same input", () => {
  for (const scenario of SCENARIOS) {
    const a = env.createCard(scenario.config, buildHass(scenario));
    const b = env.createCard(scenario.config, buildHass(scenario));
    assert.deepEqual(
      Object.keys(computeLegacyData(a)).sort(),
      Object.keys(computeLegacyData(b)).sort(),
      `scenario ${scenario.name}`
    );
    env.cleanup(a);
    env.cleanup(b);
  }
});

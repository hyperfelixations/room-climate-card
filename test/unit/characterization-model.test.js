"use strict";

// Phase 0 characterization: the _computeData() DTO, verbatim.
//
// _computeData()'s return value is the single contract between the card's
// data layer and every renderer/patcher, and the existing unit suite asserts
// against it from 177 call sites. Before the source split it had no
// whole-object baseline at all — individual fields were asserted, the SHAPE
// never was. These baselines pin every key and every value for the full
// scenario catalog, so a refactoring that silently adds, drops, reorders or
// re-rounds a field fails immediately.
//
// See test/helpers/characterization.js for the harness and the determinism
// requirements (frozen clock, pinned TZ, stable serialization).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { SCENARIOS, buildHass } = require("../helpers/characterization-scenarios.js");

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
  test(`_computeData() DTO baseline: ${scenario.name}`, () => {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const data = el._computeData();
    expectBaseline(`model/${scenario.name}.json`, stableStringify(data));
    env.cleanup(el);
  });
}

test("_computeData() is a pure function of (config, hass): repeated calls return an identical DTO", () => {
  for (const scenario of SCENARIOS) {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const first = stableStringify(el._computeData());
    const second = stableStringify(el._computeData());
    assert.equal(second, first, `scenario ${scenario.name} must not depend on call order or accumulated state`);
    env.cleanup(el);
  }
});

test("the DTO key set is stable across two independently constructed cards with the same input", () => {
  for (const scenario of SCENARIOS) {
    const a = env.createCard(scenario.config, buildHass(scenario));
    const b = env.createCard(scenario.config, buildHass(scenario));
    assert.deepEqual(
      Object.keys(a._computeData()).sort(),
      Object.keys(b._computeData()).sort(),
      `scenario ${scenario.name}`
    );
    env.cleanup(a);
    env.cleanup(b);
  }
});

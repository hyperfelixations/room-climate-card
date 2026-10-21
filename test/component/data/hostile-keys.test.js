"use strict";

// Configuration and Home Assistant strings that collide with JavaScript's own object keys
// (`constructor`, `__proto__`, …) or with the key-path syntax the diagnostics are sorted by.
// Each is an ordinary invalid value: the card warns, falls back and draws. None may reach a
// prototype member, throw an untranslated error, or leave the card undrawn.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { buildScenario } = require("../../fixtures/scenario.js");

const PROTOTYPE_KEYS = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf"];

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

function drawn(el, label) {
  const text = el.shadowRoot.textContent;
  assert.ok(!/could not be drawn/.test(text), `${label}: the card failed to draw`);
  assert.ok(el.shadowRoot.querySelector(".rtc-avg-value-num"), `${label}: the headline is drawn`);
}

function withScenario(config, body, hassOverrides = {}) {
  const built = buildScenario({ metric: "temperature", config });
  const hass = { ...built.hass, ...hassOverrides };
  env.withCard(built.config, hass, body);
}

test("top-level keys shaped like key paths are diagnosed in written order, not a crash", () => {
  for (const key of ["", ".x", "[x]"]) {
    withScenario({ [key]: 1, unknown_option: 2 }, (el) => {
      const paths = el._config._configDiagnostics.map((diagnostic) => diagnostic.path);
      assert.equal(paths.length, 2, `${JSON.stringify(key)}: ${paths}`);
      assert.equal(paths[1], "unknown_option", `${JSON.stringify(key)}: written order`);
      drawn(el, JSON.stringify(key));
    });
  }
});

test("a palette named like an object member is an unknown palette", () => {
  for (const key of PROTOTYPE_KEYS) {
    for (const palette of [key, `red-${key}`, { optimal: key }]) {
      const label = `palette: ${JSON.stringify(palette)}`;
      withScenario({ palette }, (el) => {
        const diagnostics = el._config._configDiagnostics;
        assert.ok(diagnostics.some((diagnostic) => diagnostic.path.startsWith("palette")), `${label}: warned`);
        drawn(el, label);
      });
    }
  }
});

test("a classification profile named like an object member is an unavailable profile", () => {
  for (const key of PROTOTYPE_KEYS) {
    for (const classification of [key, { source: "profile", profile: key }]) {
      const label = `classification: ${JSON.stringify(classification)}`;
      withScenario({ classification }, (el) => {
        const model = el._computeViewModel();
        assert.ok(model.notices.warnings.some((warning) => warning.key === "warning.profileUnavailable"), `${label}: warned`);
        drawn(el, label);
      });
    }
  }
});

test("a Home Assistant language named like an object member falls back to English", () => {
  for (const key of PROTOTYPE_KEYS) {
    withScenario({}, (el) => {
      assert.equal(el._language(), "en", key);
      drawn(el, key);
    }, { locale: { language: key }, language: key });
  }
});

"use strict";

// Direct unit tests for src/config/* — the static configuration foundations.
//
// These are the values a dashboard owner's YAML is measured against, so they
// are asserted literally rather than "reasonably": a silently widened action
// allowlist or a changed default rotation speed is a behaviour change for
// every existing installation.

const test = require("node:test");
const assert = require("node:assert/strict");

let defaults;
let actions;
let optionSchemas;

test.before(async () => {
  defaults = await import("../../src/config/defaults.js");
  actions = await import("../../src/config/actions.js");
  optionSchemas = await import("../../src/config/option-schemas.js");
});

test("the card defaults are unchanged", () => {
  assert.deepEqual(defaults.DEFAULT_CONFIG, {
    rotation_seconds: 14,
    slide_seconds: 1,
    hold_seconds: 0.5,
    tap_action: { action: "more-info" },
    hold_action: { action: "more-info" },
    auto_slide: true,
    swipe: true,
  });
});

test("the defaults declare no entities", () => {
  // No source is invented by defaults; normalizeConfig enforces that callers
  // provide `entity`, at least one room, or both.
  assert.equal("entity" in defaults.DEFAULT_CONFIG, false);
  assert.equal("rooms" in defaults.DEFAULT_CONFIG, false);
  assert.equal("range_entity" in defaults.DEFAULT_CONFIG, false);
  assert.equal("trend_entity" in defaults.DEFAULT_CONFIG, false);
});

test("the accepted action types are exactly the documented set", () => {
  assert.deepEqual(actions.allowedActionTypes(), [
    "more-info",
    "toggle",
    "perform-action",
    "navigate",
    "url",
    "assist",
    "none",
  ]);
});

test("isAllowedActionType() accepts only those names", () => {
  for (const allowed of actions.allowedActionTypes()) {
    assert.equal(actions.isAllowedActionType(allowed), true, allowed);
  }
  for (const rejected of [
    "call-service",
    "more_info",
    "More-Info",
    "fire-dom-event",
    "",
    undefined,
    null,
    0,
    "toString",
  ]) {
    assert.equal(actions.isAllowedActionType(rejected), false, JSON.stringify(rejected));
  }
});

test("allowedActionTypes() returns a copy, so a caller cannot widen the allowlist", () => {
  const first = actions.allowedActionTypes();
  first.push("call-service");
  assert.equal(actions.isAllowedActionType("call-service"), false);
  assert.deepEqual(actions.allowedActionTypes().includes("call-service"), false);
});

test("boolOption() defaults and validates booleans only", () => {
  const option = optionSchemas.boolOption(true);
  assert.equal(option.default, true);
  assert.equal(option.validate(true), true);
  assert.equal(option.validate(false), true);
  for (const invalid of ["true", "yes", 1, 0, null, undefined, [], {}]) {
    assert.equal(option.validate(invalid), false, JSON.stringify(invalid));
  }
  assert.equal(optionSchemas.boolOption(false).default, false, "the default is carried through verbatim");
});

test("enumOption() defaults and validates against its closed set", () => {
  const option = optionSchemas.enumOption("extremes", ["average", "extremes", "all"]);
  assert.equal(option.default, "extremes");
  for (const allowed of ["average", "extremes", "all"]) {
    assert.equal(option.validate(allowed), true, allowed);
  }
  for (const invalid of ["some", "ALL", "", null, undefined, 1, true]) {
    assert.equal(option.validate(invalid), false, JSON.stringify(invalid));
  }
});

test("enumOption() supports a non-string member, as the footer option needs", () => {
  // The range_scale footer option is "detailed" | "compact" | false.
  const option = optionSchemas.enumOption("detailed", ["compact", "detailed", false]);
  assert.equal(option.validate(false), true);
  assert.equal(option.validate("compact"), true);
  assert.equal(option.validate(true), false);
  assert.equal(option.validate("false"), false, "the string is not the boolean");
});

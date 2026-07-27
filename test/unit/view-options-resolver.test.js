"use strict";

// View-customizer "Baukasten" foundation: a generic per-view options
// resolver built on top of the existing VIEW_REGISTRY optionsSchema
// whitelist (AP-04, audit 14.4). This file tests the GENERIC mechanism in
// isolation, independent of any specific option (show_comfort_band/
// show_optimal_band, added on top of this in the same round, are tested
// separately in scale-band-visibility.test.js) -- exactly the property a
// "toolkit" needs proven on its own: any future optionsSchema key on any
// view flows through this same resolver with zero changes to it.
//
// resolveViewOptions()/boolOption() are module-level pure functions (no
// `this`, like resolveActiveViews()) and aren't exported from the IIFE for
// direct require(); el._resolveViewOptions()/el._boolOption() are thin
// instance-method delegates added purely for testability, the same
// established pattern as _timeFractionForEasedProgress() (AP-08).
//
// normalize() rehomes plain objects/arrays returned across the vm.runInContext()
// realm boundary into this realm's Object.prototype before deepEqual (see
// load-card.jsdom.js) -- otherwise structurally-identical objects fail
// deepEqual on prototype identity alone.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");

let env, el;

test.before(() => {
  env = createTestEnvironment();
  el = env.createCard({ entity: "sensor.avg" }, mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: "°C" }) }));
});
test.after(() => {
  env.cleanupAll();
});

test("boolOption(default): produces a schema entry with the given default and a boolean-only validator", () => {
  const schema = el._boolOption(true);
  assert.equal(schema.default, true);
  assert.equal(typeof schema.validate, "function");
  assert.equal(schema.validate(true), true);
  assert.equal(schema.validate(false), true);
  assert.equal(schema.validate("true"), false);
  assert.equal(schema.validate(1), false);
  assert.equal(schema.validate(null), false);
  assert.equal(schema.validate(undefined), false);
});

test("boolOption(false): default can be false, independent of the validator", () => {
  const schema = el._boolOption(false);
  assert.equal(schema.default, false);
  assert.equal(schema.validate(true), true);
});

test("resolveViewOptions: missing providedOptions falls back to every schema key's default", () => {
  const descriptor = { optionsSchema: { a: el._boolOption(true), b: el._boolOption(false) } };
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, undefined)), { a: true, b: false });
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, null)), { a: true, b: false });
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, {})), { a: true, b: false });
});

test("resolveViewOptions: an explicitly provided value overrides its schema default", () => {
  const descriptor = { optionsSchema: { a: el._boolOption(true) } };
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, { a: false })), { a: false });
});

test("resolveViewOptions: multiple schema keys are resolved independently", () => {
  const descriptor = { optionsSchema: { a: el._boolOption(true), b: el._boolOption(true), c: el._boolOption(false) } };
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, { b: false })), { a: true, b: false, c: false });
});

test("resolveViewOptions: an empty optionsSchema resolves to an empty object regardless of providedOptions", () => {
  const descriptor = { optionsSchema: {} };
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, { anything: true })), {});
});

test("resolveViewOptions: a missing/undefined descriptor resolves to an empty object (defensive)", () => {
  assert.deepEqual(normalize(el._resolveViewOptions(undefined, { a: true })), {});
  assert.deepEqual(normalize(el._resolveViewOptions({}, { a: true })), {});
});

test("resolveViewOptions: only keys the schema actually declares are ever present in the result, extra providedOptions keys are ignored", () => {
  const descriptor = { optionsSchema: { a: el._boolOption(true) } };
  assert.deepEqual(normalize(el._resolveViewOptions(descriptor, { a: false, bogus: "x" })), { a: false });
});

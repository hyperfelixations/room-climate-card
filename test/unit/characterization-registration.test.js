"use strict";

// Phase 0 characterization: custom-element and Home Assistant registration.
//
// The registration block is the card's entire integration surface with Home
// Assistant: the element tag, the HA lifecycle contract, the card-picker
// metadata in window.customCards, and the version global. It runs as a
// module-load side effect at the very END of the file, which makes it exactly
// the kind of thing a bundler can reorder or tree-shake away — and it had no
// unit coverage at all before this baseline.
//
// The double-load case is characterized too: Home Assistant can evaluate the
// same resource twice (a dashboard reload with a stale cached copy, or the
// same card registered under two resource URLs), and the file guards against
// that with `if (!customElements.get(...))` plus an update-in-place merge of
// the customCards entry.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { CARD_SOURCE_PATH } = require("../helpers/load-card.jsdom.js");
const { createFrozenEnvironment, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const packageJson = require("../../package.json");

const CARD_TAG = "room-climate-card";

let env;

test.before(() => {
  env = createFrozenEnvironment();
});

test.after(() => {
  env.cleanupAll();
});

test("the custom element is registered under its documented tag", () => {
  const ctor = env.window.customElements.get(CARD_TAG);
  assert.equal(typeof ctor, "function");
  assert.equal(ctor.name, "RoomClimateCard");
  assert.ok(ctor.prototype instanceof env.window.HTMLElement, "must extend HTMLElement");
});

test("the Home Assistant lifecycle contract is present and unchanged", () => {
  const ctor = env.window.customElements.get(CARD_TAG);
  const proto = ctor.prototype;
  for (const method of ["setConfig", "connectedCallback", "disconnectedCallback", "getCardSize", "getGridOptions"]) {
    assert.equal(typeof proto[method], "function", `${method}() must exist on the prototype`);
  }
  const hassDescriptor = Object.getOwnPropertyDescriptor(proto, "hass");
  assert.equal(typeof hassDescriptor?.set, "function", "hass must be a setter");
  assert.equal(hassDescriptor?.get, undefined, "hass is deliberately write-only");
  assert.equal(typeof ctor.getStubConfig, "function", "getStubConfig() must be a static");
});

test("the card-picker metadata registered with Home Assistant is unchanged", () => {
  expectBaseline("registration/custom-cards.json", stableStringify(env.window.customCards));
});

test("getStubConfig() output is unchanged", () => {
  const ctor = env.window.customElements.get(CARD_TAG);
  expectBaseline("registration/stub-config.json", stableStringify(ctor.getStubConfig()));
});

test("the version global matches package.json (single source of truth for releases)", () => {
  assert.equal(
    env.window.roomClimateCardVersion,
    packageJson.version,
    "CARD_VERSION and package.json must be released together"
  );
});

test("evaluating the card source twice in one realm neither throws nor duplicates the picker entry", () => {
  const before = env.window.customCards.length;
  const source = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
  // runScripts:"outside-only" (see load-card.jsdom.js) exposes window.eval,
  // which evaluates in the window's own realm — the same realm the first load
  // used, which is exactly what the double-load guard needs to be exercised.
  env.window.eval(source);
  assert.equal(env.window.customCards.length, before, "a second evaluation must update in place, not append");
  assert.equal(
    env.window.customCards.filter((card) => card.type === CARD_TAG).length,
    1,
    "exactly one picker entry per card type"
  );
  assert.equal(typeof env.window.customElements.get(CARD_TAG), "function", "the element must stay registered");
});

test("no globals other than the two documented ones are created", () => {
  // A dependency-free card must not leak helper state onto window. Anything
  // new appearing here after a refactoring would mean the IIFE boundary broke.
  const own = Object.keys(env.window).filter((key) => /^(rtc|roomClimate|customCards)/i.test(key));
  assert.deepEqual(own.sort(), ["customCards", "roomClimateCardVersion"]);
});

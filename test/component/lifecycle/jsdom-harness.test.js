"use strict";

// The jsdom harness itself, tested. Every other jsdom test stands on it, and a harness that
// leaks cards produces failures that look like product bugs — the leaked card's resume
// timer keeps firing into the next test. The common `createCard(); assert(); cleanup();`
// shape leaks on every failing assertion; withCard() closes that.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { scenario } = require("../../fixtures/scenario.js");

let env;
const built = scenario().rooms(2).build();

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

test("a freshly created environment holds no cards", () => {
  assert.equal(env.liveCardCount(), 0);
});

test("a live card is owned until the end of its test", () => {
  env.createCard(built.config, built.hass);
  assert.equal(env.liveCardCount(), 1);
});

test("the failure-safe test boundary releases an unclaimed card", () => {
  assert.equal(env.liveCardCount(), 0, "a card survived into the next test");
});

test("createCard registers the card, cleanup releases it", () => {
  const before = env.liveCardCount();
  const el = env.createCard(built.config, built.hass);
  assert.equal(env.liveCardCount(), before + 1);
  env.cleanup(el);
  assert.equal(env.liveCardCount(), before);
});

test("withCard returns the body's value and cleans up after it", () => {
  const before = env.liveCardCount();
  const kind = env.withCard(built.config, built.hass, (el) => el._computeViewModel().metric.kind);
  assert.equal(kind, "temperature");
  assert.equal(env.liveCardCount(), before, "the card must not outlive the body");
});

test("withCard cleans up even when the body throws — the case the manual shape gets wrong", () => {
  const before = env.liveCardCount();
  assert.throws(
    () =>
      env.withCard(built.config, built.hass, () => {
        throw new Error("assertion failed");
      }),
    /assertion failed/
  );
  assert.equal(env.liveCardCount(), before, "a failing assertion must not leak a card");
});

test("cleanupAll releases everything, however many are open", () => {
  env.createCard(built.config, built.hass);
  env.createCard(built.config, built.hass);
  assert.ok(env.liveCardCount() >= 2);
  env.cleanupAll();
  assert.equal(env.liveCardCount(), 0);
});

test("cleanup detaches the element, which is what stops its timers", () => {
  const el = env.createCard(built.config, built.hass);
  assert.equal(el.isConnected, true);
  env.cleanup(el);
  assert.equal(el.isConnected, false, "disconnectedCallback is what clears the resume timer");
});

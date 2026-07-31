"use strict";

// _holdSequence() must be a
// pure linear ping-pong over the view count — 0,1,...,N-1,N-2,...,1 — with
// every transition (including the cycle wrap back to 0) moving exactly one
// position, including the cycle wrap back to 0.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");

let env;
let el;

test.before(() => {
  env = createTestEnvironment();
  // _holdSequence() only reads this._views (no config/hass/DOM needed), so a
  // bare, never-connected element is enough — nothing to clean up per test.
  el = env.document.createElement("room-climate-card");
});

test.after(() => {
  env.cleanupAll();
});

function expectedPingPong(n) {
  if (n < 2) return [];
  const forward = Array.from({ length: n }, (_, i) => i);
  const backwardInterior = Array.from({ length: Math.max(0, n - 2) }, (_, i) => n - 2 - i);
  return [...forward, ...backwardInterior];
}

test("_holdSequence() matches the pure ping-pong formula for N=0..10", () => {
  for (let n = 0; n <= 10; n++) {
    el._views = new Array(n).fill("x");
    assert.deepEqual(normalize(el._carousel.holdSequence()), expectedPingPong(n), `N=${n}`);
  }
});

test("_holdSequence() never skips a position: every transition (incl. the wrap) moves exactly 1, for N=2..10", () => {
  for (let n = 2; n <= 10; n++) {
    el._views = new Array(n).fill("x");
    const seq = el._carousel.holdSequence();
    for (let i = 0; i < seq.length; i++) {
      const a = seq[i];
      const b = seq[(i + 1) % seq.length];
      assert.equal(Math.abs(a - b), 1, `N=${n}, transition ${a}->${b} at index ${i} (sequence: ${JSON.stringify(seq)})`);
    }
  }
});

test("_holdSequence() is empty for 0 or 1 view (no auto-slide possible)", () => {
  el._views = [];
  assert.deepEqual(normalize(el._carousel.holdSequence()), []);
  el._views = ["only"];
  assert.deepEqual(normalize(el._carousel.holdSequence()), []);
});

test("_holdSequence() ignores view keys entirely — pure function of count", () => {
  el._views = ["range", "rangeScale", "scale", "extremes"];
  const byKeys = normalize(el._carousel.holdSequence());
  el._views = ["a", "b", "c", "d"];
  const byLetters = normalize(el._carousel.holdSequence());
  assert.deepEqual(byKeys, byLetters);
  assert.deepEqual(byKeys, [0, 1, 2, 3, 2, 1]);
});

test("_holdSequence() falls back to an empty this._views safely", () => {
  el._views = undefined;
  assert.deepEqual(normalize(el._carousel.holdSequence()), []);
  el._views = null;
  assert.deepEqual(normalize(el._carousel.holdSequence()), []);
});

test("regression: the specific pre-2.16.0 bug sequence (2,3,2,0,2,1) never recurs for N=4", () => {
  el._views = ["range", "rangeScale", "scale", "extremes"];
  const seq = normalize(el._carousel.holdSequence());
  assert.notDeepEqual(seq, [2, 3, 2, 0, 2, 1], "the old anchor/slot bug sequence must not reappear");
  assert.deepEqual(seq, [0, 1, 2, 3, 2, 1]);
});

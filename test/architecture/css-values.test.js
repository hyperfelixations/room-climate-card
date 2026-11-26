"use strict";

// The CSS value reader the carousel tests assert through (test/helpers/css-values.js). It must
// read the card's own writes and every CSSOM re-serialization of them alike, and refuse
// anything else: a reader that accepted a pixel offset or a vertical shift would let a broken
// transform pass. The tolerance covers serialization rounding and nothing more.

const test = require("node:test");
const assert = require("node:assert/strict");

const { TRANSLATE_TOLERANCE_PCT, translateXPercent, assertTranslateXPercent } = require("../helpers/css-values.js");

const THIRD = -100 / 3;

test("the card's own write and its CSSOM serialization read as the same offset", () => {
  assert.equal(translateXPercent(`translate3d(${THIRD}%,0,0)`), THIRD);
  assert.ok(Math.abs(translateXPercent("translate3d(-33.3333%, 0px, 0px)") - THIRD) <= TRANSLATE_TOLERANCE_PCT);
  assert.equal(translateXPercent("translate3d(0%, 0px, 0px)"), 0);
  assert.equal(translateXPercent("translate3d(-10%,0,0)"), -10);
  assert.equal(translateXPercent(" TRANSLATE3D( -66.6667% , 0 , 0px ) "), -66.6667);
  assert.equal(translateXPercent("translate3d(-1e-7%, 0px, 0px)"), -1e-7);
});

test("anything but a horizontal percent translate3d() is refused", () => {
  for (const transform of [
    "none",
    "",
    "translate3d(-40px, 0px, 0px)",
    "translate3d(-10%, 5px, 0px)",
    "translate3d(-10%, 0px, 1px)",
    "translate3d(-10%, 0px)",
    "translateX(-10%)",
    "matrix(1, 0, 0, 1, -40, 0)",
    "translate3d(-10%, 0px, 0px) scale(2)",
    undefined,
  ]) {
    assert.throws(() => translateXPercent(transform), TypeError, String(transform));
  }
});

test("the assertion accepts serialization rounding and rejects a real offset", () => {
  assert.doesNotThrow(() => assertTranslateXPercent("translate3d(-33.3333%, 0px, 0px)", THIRD));
  assert.doesNotThrow(() => assertTranslateXPercent("translate3d(-66.6667%, 0px, 0px)", 2 * THIRD));
  assert.throws(() => assertTranslateXPercent("translate3d(-33.332%, 0px, 0px)", THIRD), assert.AssertionError);
  assert.throws(() => assertTranslateXPercent("translate3d(-17%, 0px, 0px)", THIRD, "snapped"), /snapped: expected/);
  assert.throws(() => assertTranslateXPercent("translate3d(-40px, 0px, 0px)", THIRD), TypeError);
});

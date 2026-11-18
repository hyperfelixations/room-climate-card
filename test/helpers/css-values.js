"use strict";

// Reads inline CSS values by meaning, not by their serialization: CSSOM implementations
// re-serialize what the card writes (`translate3d(-33.333333333333336%,0,0)` reads back as
// `translate3d(-33.3333%, 0px, 0px)`). See internal dev doc §4 "Testarchitektur".

const assert = require("node:assert/strict");

// CSSOM serializes a <number> with six significant digits.
const TRANSLATE_TOLERANCE_PCT = 1e-4;

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const ZERO_LENGTH = String.raw`[+-]?0*\.?0+(?:px)?`;
const TRANSLATE3D = new RegExp(String.raw`^translate3d\(\s*(${NUMBER})%\s*,\s*${ZERO_LENGTH}\s*,\s*${ZERO_LENGTH}\s*\)$`, "i");

// The horizontal offset of a `translate3d(<x>%, 0, 0)` transform, in percent. Any other form
// throws, so a test cannot pass on a transform the carousel never writes.
function translateXPercent(transform) {
  const match = TRANSLATE3D.exec(String(transform).trim());
  if (!match) throw new TypeError(`not a horizontal translate3d() in percent: ${JSON.stringify(transform)}`);
  return Number(match[1]);
}

function assertTranslateXPercent(transform, expectedPct, message) {
  const actualPct = translateXPercent(transform);
  assert.ok(
    Math.abs(actualPct - expectedPct) <= TRANSLATE_TOLERANCE_PCT,
    `${message ?? "translate3d() offset"}: expected ${expectedPct}%, got ${actualPct}% (${transform})`
  );
}

module.exports = { TRANSLATE_TOLERANCE_PCT, translateXPercent, assertTranslateXPercent };

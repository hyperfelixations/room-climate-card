"use strict";

// Pure stable serialization shared by direct-source and characterization tests.
// It has no jsdom or bundle dependency, so importing it cannot silently turn a unit test
// into an integration test through a helper. Non-JSON values receive explicit markers and
// object keys are sorted for byte-stable diagnostics and baselines.

function normalizeForBaseline(value) {
  if (typeof value === "function") return "[Function]";
  if (value === undefined) return "[undefined]";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "[NaN]";
    if (value === Infinity) return "[Infinity]";
    if (value === -Infinity) return "[-Infinity]";
    if (Object.is(value, -0)) return "[-0]";
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeForBaseline);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalizeForBaseline(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return `${JSON.stringify(normalizeForBaseline(value), null, 2)}\n`;
}

module.exports = { normalizeForBaseline, stableStringify };

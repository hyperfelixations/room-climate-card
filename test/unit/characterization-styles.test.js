"use strict";

// Phase 0 characterization: the generated CSS, verbatim.
//
// _styles() is 870 lines of CSS inside one template literal and is the single
// largest unit in the file. Splitting it into per-concern modules is a pure
// concatenation change — but CSS is order-sensitive (cascade, specificity
// ties, the @container/@supports blocks at the end), so "the same rules in a
// different order" is a real regression that no behavioural test would catch
// and that jsdom cannot see at all (it has no cascade).
//
// Three complementary baselines:
//   styles/full.css       the complete emitted stylesheet for a canonical card
//   styles/digests.txt    scenario -> sha256, so EVERY scenario's CSS is pinned
//   styles/keyframes.txt  the dynamic @keyframes block across view counts and
//                         timing configurations (the only part of _styles()
//                         that is not static)

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, captureShadowMarkup, sha256, expectBaseline } = require("../helpers/characterization.js");
const { SCENARIOS, buildHass } = require("../helpers/characterization-scenarios.js");

const CANONICAL_SCENARIO = "case-d-full";

let env;
let console_;

test.before(() => {
  env = createFrozenEnvironment();
  console_ = recordConsole(env);
});

test.after(() => {
  console_.restore();
  env.cleanupAll();
});

test("the complete emitted stylesheet is unchanged", () => {
  const scenario = SCENARIOS.find((s) => s.name === CANONICAL_SCENARIO);
  const el = env.createCard(scenario.config, buildHass(scenario));
  const { css } = captureShadowMarkup(el);
  assert.ok(css.length > 10000, "sanity: the canonical card must emit a full stylesheet");
  expectBaseline("styles/full.css", `${css}\n`);
  env.cleanup(el);
});

test("every scenario's stylesheet digest is unchanged", () => {
  const lines = [];
  for (const scenario of SCENARIOS) {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const { cssSha256 } = captureShadowMarkup(el);
    lines.push(`${scenario.name} ${cssSha256}`);
    env.cleanup(el);
  }
  expectBaseline("styles/digests.txt", `${lines.join("\n")}\n`);
});

test("the dynamic @keyframes block is unchanged across view counts and timings", () => {
  const scenario = SCENARIOS.find((s) => s.name === CANONICAL_SCENARIO);
  const el = env.createCard(scenario.config, buildHass(scenario));
  const timings = [
    [14, 1],
    [7, 2.5],
    [1, 0.1],
    [3600, 10],
  ];
  const chunks = [];
  for (const [rotationSeconds, slideSeconds] of timings) {
    el._config.rotation_seconds = rotationSeconds;
    el._config.slide_seconds = slideSeconds;
    for (let viewCount = 0; viewCount <= 5; viewCount++) {
      el._views = Array.from({ length: viewCount }, (_, i) => `view${i}`);
      chunks.push(
        `--- rotation_seconds=${rotationSeconds} slide_seconds=${slideSeconds} views=${viewCount} ---`,
        el._slideKeyframes(),
        ""
      );
    }
  }
  expectBaseline("styles/keyframes.txt", `${chunks.join("\n")}\n`);
  env.cleanup(el);
});

test("the stylesheet contains no external references (no @import, url(), or network fetch)", () => {
  const scenario = SCENARIOS.find((s) => s.name === CANONICAL_SCENARIO);
  const el = env.createCard(scenario.config, buildHass(scenario));
  const { css } = captureShadowMarkup(el);
  assert.doesNotMatch(css, /@import/, "the card must stay self-contained");
  assert.doesNotMatch(css, /url\(\s*['"]?(https?:)?\/\//, "no remote asset references");
  env.cleanup(el);
});

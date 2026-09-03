// Mutation testing, deliberately narrow: three compact domain modules run through their
// direct-source unit tests. Scope and rationale: see internal dev doc §4 "Mutationstesten".

// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "command",
  commandRunner: {
    command:
      "node --test test/unit/domain/classification-palettes.test.js test/unit/domain/domain-services-modules.test.js test/unit/domain/domain-metrics-modules.test.js test/unit/application/application-model-modules.test.js",
  },
  coverageAnalysis: "off",
  mutate: [
    "src/domain/classification/classify.js",
    "src/domain/metrics/resolution.js",
    "src/application/model/aggregates.js",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/html/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // Break at 100%: a floor below it cannot tell a provably equivalent mutant from an
  // untested one. One mutant is excused by name in aggregates.js — replacing
  // `config.rooms || []` with a one-element array cannot change the result (the element is a
  // string the loop body drops first); every other mutation of that line must still die.
  thresholds: { high: 100, low: 100, break: 100 },
  concurrency: 2,
  timeoutMS: 20000,
  dryRunTimeoutMinutes: 5,
  cleanTempDir: "always",
  disableTypeChecks: false,
  ignorePatterns: [
    "/coverage",
    "/dist",
    "/playwright-report",
    "/reports",
    "/test-results",
    "/test/architecture",
    "/test/baseline",
    "/test/browser",
    "/test/characterization",
    "/test/component",
    "/test/contract",
    "/test/property",
  ],
};

export default config;

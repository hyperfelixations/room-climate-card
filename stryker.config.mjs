// Mutation testing is intentionally narrow and semantic. These modules contain compact,
// high-value domain decisions; their dedicated direct-source tests must distinguish every
// executable branch. Browser and bundle tests belong to other test layers and would make a
// command-runner mutation cycle slower without improving mutant attribution.

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
  // EVERY SURVIVOR IS A FAILURE, which is what makes the number mean something. A percentage
  // floor below 100 cannot tell a provably equivalent mutant from one that simply was not
  // tested — it only counts them — so it passes the first future survivor as readily as the
  // known ones.
  //
  // Three mutants survived when this scope was first measured. Two of them survived because
  // the code contained a comparison that could not decide anything: a max assignment written
  // as an `if`, where equality assigns the value already there, and a null guard in front of
  // a relational comparison that coerces to the same answer either way. Both are now written
  // so that the question does not arise — `Math.max`, and the comparison alone with the
  // coercion spelled out beside it — and every mutant on those lines is killed.
  //
  // One remains excused by name, at the line it sits on and for one mutator only: replacing
  // `config.rooms || []` with a one-element array cannot change the result, because the
  // element is a string and the loop body drops it at its first statement. Every other
  // mutation of that same line is still required to die.
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

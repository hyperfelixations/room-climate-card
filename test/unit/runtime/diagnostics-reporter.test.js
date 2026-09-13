"use strict";

// Direct unit tests for the console side of a warning: what the card shows is written once
// per change of the set, in the words it is handed. Boundary: which warnings exist and how
// they read is decided before the reporter (unit/presentation/notices.test.js); the
// platform's log port itself is tested in runtime-platform.test.js. See internal dev doc §4
// "Diagnosevertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakePlatform } = require("../../helpers/fake-platform.js");

let reporterModule;

test.before(async () => {
  reporterModule = await import("../../../src/controllers/runtime/diagnostics-reporter.js");
});

function setup() {
  const platform = createFakePlatform();
  const reporter = reporterModule.createDiagnosticsReporter({ platform, describe: (message) => `Warning: ${message.key}` });
  const lines = () => platform.logs.map(({ level, args }) => `${level} ${args.join(" ")}`);
  return { reporter, lines };
}

test("each warning is written as its own line, in the words it is handed", () => {
  const { reporter, lines } = setup();
  reporter.reportWarnings([{ key: "a" }, { key: "b" }]);
  assert.deepEqual(lines(), ["warn Room Climate Card: Warning: a", "warn Room Climate Card: Warning: b"]);
});

test("an unchanged set is not written again, a changed one is written in full", () => {
  const { reporter, lines } = setup();
  reporter.reportWarnings([{ key: "a" }]);
  reporter.reportWarnings([{ key: "a" }]);
  assert.equal(lines().length, 1, "the card renders on every update; the console must not repeat it");
  reporter.reportWarnings([{ key: "a" }, { key: "b" }]);
  assert.deepEqual(lines().slice(1), ["warn Room Climate Card: Warning: a", "warn Room Climate Card: Warning: b"]);
});

test("invalid, then valid, then the same invalid configuration warns again", () => {
  const { reporter, lines } = setup();
  reporter.reportWarnings([{ key: "a" }]);
  reporter.reportWarnings([]);
  assert.equal(lines().length, 1, "nothing to say is said silently");
  reporter.reportWarnings([{ key: "a" }]);
  assert.equal(lines().length, 2);
});

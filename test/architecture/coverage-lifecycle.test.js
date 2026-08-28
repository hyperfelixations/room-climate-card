"use strict";

// The coverage runner temporarily replaces the ordinary reviewable bundle with one carrying
// an inline source map. This test owns the lifecycle guarantee around that temporary artifact:
// restoration happens after success, after a coverage failure, and is never reported as
// successful when restoration itself fails.

const test = require("node:test");
const assert = require("node:assert/strict");

let runWithRestoredArtifact;
test.before(async () => {
  ({ runWithRestoredArtifact } = await import("../../scripts/run-coverage.mjs"));
});

test("coverage work restores the ordinary artifact before returning", () => {
  const events = [];
  runWithRestoredArtifact(
    () => events.push("coverage"),
    () => events.push("restore"),
  );
  assert.deepEqual(events, ["coverage", "restore"]);
});

test("a coverage failure is rethrown only after restoration", () => {
  const failure = Object.assign(new Error("coverage failed"), { exitCode: 7 });
  const events = [];
  assert.throws(
    () => runWithRestoredArtifact(
      () => {
        events.push("coverage");
        throw failure;
      },
      () => events.push("restore"),
    ),
    (error) => error === failure,
  );
  assert.deepEqual(events, ["coverage", "restore"]);
});

test("coverage and restoration failures retain both causes", () => {
  const coverageFailure = new Error("coverage failed");
  const restoreFailure = new Error("restore failed");
  assert.throws(
    () => runWithRestoredArtifact(
      () => { throw coverageFailure; },
      () => { throw restoreFailure; },
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [coverageFailure, restoreFailure]);
      assert.match(error.message, /ordinary bundle could not be restored/);
      return true;
    },
  );
});

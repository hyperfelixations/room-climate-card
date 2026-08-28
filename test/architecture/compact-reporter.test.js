"use strict";

// Drives the compact reporter with a synthetic Node test-event stream.
// Reporter regressions otherwise appear only when another test fails, which is the worst
// possible time to discover that suite lineage or assertion evidence was discarded.
// These events cover concurrency-safe ids, undefined comparisons, causes and stderr policy.

const test = require("node:test");
const assert = require("node:assert/strict");

const reporter = require("../helpers/compact-reporter.js");

async function render(events) {
  async function* source() {
    yield* events;
  }
  let output = "";
  for await (const chunk of reporter(source())) output += chunk;
  return output;
}

test("a failure prints its full suite lineage and explicit undefined comparison", async () => {
  const error = new assert.AssertionError({ message: "wrong value", actual: undefined, expected: 4 });
  const output = await render([
    { type: "test:start", data: { name: "outer", file: "one.test.js", testId: 1 } },
    { type: "test:start", data: { name: "inner", file: "one.test.js", testId: 2, parentId: 1 } },
    { type: "test:start", data: { name: "leaf", file: "one.test.js", testId: 3, parentId: 2 } },
    { type: "test:fail", data: { name: "leaf", file: "one.test.js", line: 8, column: 2, testId: 3, parentId: 2, details: { error } } },
  ]);
  assert.match(output, /FAIL outer › inner › leaf \(one\.test\.js:8:2\)/);
  assert.match(output, /expected: 4/);
  assert.match(output, /actual:\s+undefined/);
});

test("identical ids in different files cannot cross-link suite lineage", async () => {
  const error = new Error("boom");
  const output = await render([
    { type: "test:start", data: { name: "suite one", file: "one.test.js", testId: 1 } },
    { type: "test:start", data: { name: "suite two", file: "two.test.js", testId: 1 } },
    { type: "test:start", data: { name: "leaf", file: "two.test.js", testId: 2, parentId: 1 } },
    { type: "test:fail", data: { name: "leaf", file: "two.test.js", testId: 2, parentId: 1, details: { error } } },
  ]);
  assert.match(output, /FAIL suite two › leaf/);
  assert.doesNotMatch(output, /suite one › leaf/);
});

test("stderr stays hidden on green and is preserved on failure", async () => {
  const stderr = { type: "test:stderr", data: { message: "diagnostic from child\n" } };
  assert.equal(await render([stderr, { type: "test:diagnostic", data: { nesting: 0, message: "tests 1" } }]), "tests 1\n");
  const failed = await render([
    stderr,
    { type: "test:fail", data: { name: "leaf", details: { error: new Error("boom") } } },
  ]);
  assert.match(failed, /stderr from the run/);
  assert.match(failed, /diagnostic from child/);
});

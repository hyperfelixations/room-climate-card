"use strict";

// Verifies the write-only characterization command without rewriting a baseline.
// Discovery belongs here because a successful no-op would invalidate every promise made by
// characterize:update while leaving the ordinary read-only characterization tests green.
// The test imports the script as a module and therefore never enables update mode.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "update-characterization.mjs");

test("characterize:update discovers every current characterization test", async () => {
  const { discoverCharacterizationTests } = await import(pathToFileURL(SCRIPT));
  const discovered = discoverCharacterizationTests().map((file) => path.basename(file));
  const actual = fs
    .readdirSync(path.join(__dirname, "..", "characterization"))
    .filter((name) => name.endsWith(".test.js"))
    .sort((left, right) => left.localeCompare(right, "en"));
  assert.deepEqual(discovered, actual);
  assert.ok(discovered.includes("dom.test.js"), "the DOM baseline writer is not discoverable");
  assert.ok(discovered.includes("model.test.js"), "the model baseline writer is not discoverable");
});

test("characterize:update rejects an empty test directory", async () => {
  const { discoverCharacterizationTests } = await import(pathToFileURL(SCRIPT));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "rcc-characterization-empty-"));
  try {
    assert.throws(() => discoverCharacterizationTests(empty), /no characterization tests found/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

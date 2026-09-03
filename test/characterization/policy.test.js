"use strict";

// Keeps POLICY.md and the baselines it describes from drifting apart. A policy nothing
// checks describes last year's suite; a characterization baseline is only useful if someone
// can decide what a change to it means, which needs the file described. Two checks, both
// about coverage, neither about wording — a test that policed prose would be argued with.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BASELINE_DIR = path.join(__dirname, "..", "baseline");
const POLICY_PATH = path.join(__dirname, "POLICY.md");
const policy = fs.readFileSync(POLICY_PATH, "utf8");

const groups = fs
  .readdirSync(BASELINE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("every baseline group is described in POLICY.md", () => {
  const undescribed = groups.filter((group) => !new RegExp(`\`${group}/\``).test(policy));
  assert.deepEqual(
    undescribed,
    [],
    "these baseline groups exist and nothing says what they are for — add a row to " +
      `test/characterization/POLICY.md:\n  ${undescribed.join("\n  ")}`
  );
});

test("POLICY.md describes no group that does not exist", () => {
  // The other direction, and the one that rots quietly: a row describing baselines that were
  // deleted reads like documentation and is fiction.
  const described = [...policy.matchAll(/^\| `([a-z-]+)\/` \|/gm)].map((match) => match[1]);
  assert.ok(described.length > 0, "POLICY.md has no group table any more");
  const missing = described.filter((group) => !groups.includes(group));
  assert.deepEqual(missing, [], `POLICY.md describes groups that no longer exist:\n  ${missing.join("\n  ")}`);
});

test("the file counts in POLICY.md match what is on disk", () => {
  // Checked per group, not as a total: a total can stay right while two groups move opposite ways.
  for (const group of groups) {
    const actual = fs.readdirSync(path.join(BASELINE_DIR, group)).length;
    const row = policy.match(new RegExp(`^\\| \`${group}/\` \\| (\\d+) \\|`, "m"));
    assert.ok(row, `${group}: no row in POLICY.md, or its row has no count`);
    assert.equal(Number(row[1]), actual, `${group}: POLICY.md says ${row[1]}, disk has ${actual}`);
  }
});

test("every baseline group has a test that actually reads it", () => {
  // A recorded file nothing compares against is not a baseline, it is a leftover — and it will
  // sit there looking like coverage for as long as nobody checks.
  const readers = fs
    .readdirSync(__dirname)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => fs.readFileSync(path.join(__dirname, name), "utf8"))
    .join("\n");
  const helper = fs.readFileSync(path.join(__dirname, "..", "helpers", "characterization.js"), "utf8");
  const all = `${readers}\n${helper}`;
  // Delimited on both sides so "dom" does not match "random".
  const unread = groups.filter((group) => !new RegExp("[`\"'/]" + group + "[`\"'/]").test(all));
  assert.deepEqual(unread, [], `nothing reads these baselines:\n  ${unread.join("\n  ")}`);
});

test("the policy states the one rule that makes a baseline worth having", () => {
  // Not style policing: this sentence is what keeps the directory from being regenerated whenever inconvenient.
  assert.match(policy, /Re-record deliberately/i);
  assert.match(policy, /characterize:update/);
});

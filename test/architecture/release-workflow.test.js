"use strict";

// The release workflow's version contract (.github/workflows/release.yml): which versions a
// release candidate accepts for each release kind, and which kind becomes a GitHub pre-release.
// The workflow is read as text and the patterns it runs are extracted and exercised here.
// Boundary: whether the version files agree with the requested version is checked by the
// workflow itself at run time.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// A checkout with core.autocrlf=true (GitHub's Windows runner) hands this file over with CRLF;
// every extraction below reads LF text.
function readWorkflow(raw) {
  return raw.replace(/\r\n/g, "\n");
}

const WORKFLOW = readWorkflow(fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "release.yml"), "utf8"));

function releaseKindOptions(workflow = WORKFLOW) {
  const block = workflow.match(/ release_kind:\n(?: {8,}\S.*\n)*? {8}options:\n((?: {10}- \S+\n)+)/);
  assert.ok(block, "release_kind declares an options list");
  return block[1].trim().split("\n").map((line) => line.trim().replace(/^- /, ""));
}

// The pattern a switch branch refuses versions with, as a JavaScript RegExp. The branch compares
// case-sensitively (-cnotmatch) with ASCII classes only, so both engines agree on it.
function versionPattern(kind, workflow = WORKFLOW) {
  const branch = workflow.match(new RegExp(`"${kind}" \\{\\s*if \\(\\$version -cnotmatch '([^']+)'\\)`));
  assert.ok(branch, `the "${kind}" branch refuses versions with a case-sensitive -cnotmatch`);
  assert.doesNotMatch(branch[1], /\\d/, `the "${kind}" pattern uses \\d, which .NET widens to every Unicode digit`);
  return new RegExp(branch[1]);
}

const PRERELEASE_ONLY_FOR_DEV = /if \[\[ "\$RELEASE_KIND" == "dev" \]\]; then\n\s+args\+=\(--prerelease --latest=false\)\n\s+fi/;

function assertPattern(pattern, accepted, refused) {
  for (const version of accepted) assert.match(version, pattern, `${version} must be accepted`);
  for (const version of refused) assert.doesNotMatch(version, pattern, `${version} must be refused`);
}

test("the workflow reads the same whatever line endings the checkout gave it", () => {
  const lf = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n");
  const crlf = lf.replace(/\n/g, "\r\n");
  for (const [name, raw] of [["LF", lf], ["CRLF", crlf]]) {
    const workflow = readWorkflow(raw);
    assert.deepEqual(releaseKindOptions(workflow), ["stable", "dev"], name);
    assert.equal(String(versionPattern("stable", workflow)), String(versionPattern("stable", readWorkflow(lf))), name);
    assert.equal(String(versionPattern("dev", workflow)), String(versionPattern("dev", readWorkflow(lf))), name);
    assert.match(workflow, PRERELEASE_ONLY_FOR_DEV, name);
  }
});

test("a release candidate is either stable or a dev pre-release", () => {
  assert.deepEqual(releaseKindOptions(), ["stable", "dev"]);
  assert.doesNotMatch(WORKFLOW, /beta/i, "the former beta kind is gone everywhere, descriptions included");
});

test("a stable release accepts exactly MAJOR.MINOR.PATCH without leading zeros", () => {
  assertPattern(
    versionPattern("stable"),
    ["2.38.2", "2.39.0", "10.0.12", "0.1.0"],
    ["2.39.0-dev.1", "02.1.0", "2.01.0", "2.39", "v2.39.0", "2.39.0 ", "2.39.0-beta.1", "2.39.0+build", "２.39.0"]
  );
});

test("a dev pre-release accepts exactly MAJOR.MINOR.PATCH-dev.N with N from 1", () => {
  assertPattern(
    versionPattern("dev"),
    ["2.39.0-dev.1", "10.0.12-dev.3", "2.39.0-dev.10", "3.0.0-dev.1"],
    [
      "2.39.0",
      "2.39.0-dev.0",
      "2.39.0-dev.01",
      "2.39.0-dev",
      "2.39.0-DEV.1",
      "2.39.0-beta.1",
      "v2.39.0-dev.1",
      "2.39.0-dev.1+abc1234",
      "2.39.0-dev.1.1",
      "02.39.0-dev.1",
      "2.39.0-dev.１",
    ]
  );
});

test("only a dev release becomes a pre-release, and never Latest", () => {
  assert.equal(WORKFLOW.match(/--prerelease/g).length, 1, "exactly one place marks a draft as pre-release");
  assert.match(WORKFLOW, PRERELEASE_ONLY_FOR_DEV);
});

test("every version the workflow names as an example is one it accepts", () => {
  const stable = versionPattern("stable");
  const dev = versionPattern("dev");
  const described = WORKFLOW.match(/Exact package version, for example (\S+) or (\S+)"/);
  assert.ok(described, "the version input names one stable and one dev example");
  assert.match(described[1], stable);
  assert.match(described[2], dev);
  assert.match(WORKFLOW.match(/A stable version must look like (\S+)\."/)[1], stable);
  assert.match(WORKFLOW.match(/A dev pre-release version must look like (\S+)\."/)[1], dev);
});

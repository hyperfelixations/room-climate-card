"use strict";

// The release workflow's contract (.github/workflows/release.yml): which versions a release
// candidate accepts for each release kind, which kind becomes a GitHub pre-release, which
// commit may be approved, and when the HACS gate applies. The workflow is read as text, the
// patterns it runs are extracted and exercised here, and its validation script runs against
// throwaway git repositories.
// Boundary: whether the version files agree with the requested version is checked by the
// workflow itself at run time.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

// ------------------------------------------------------------------ approved commit --

function jobBlock(name, workflow = WORKFLOW) {
  const match = workflow.match(new RegExp(`\\n  ${name}:\\n((?:    .*\\n|\\n)*)`));
  assert.ok(match, `the workflow declares job ${name}`);
  return match[1];
}

// The `run: |` script of one named step, dedented to what the shell receives.
function stepScript(job, stepName) {
  const start = job.indexOf(`      - name: ${stepName}\n`);
  assert.notEqual(start, -1, `step "${stepName}" exists`);
  const rest = job.slice(start + 1);
  const end = rest.search(/\n {6}- name:/);
  const step = end === -1 ? rest : rest.slice(0, end);
  const run = step.match(/^ {8}run: \|\n((?: {10}.*\n?|\n)+)/m);
  assert.ok(run, `step "${stepName}" runs a script`);
  return run[1].split("\n").map((line) => line.slice(10)).join("\n");
}

const VALIDATION_STEP = "Validate branch, SHA, version and HACS contract";

function stepNames(job) {
  return [...job.matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]);
}

test("any commit in the history of main can be approved, and no other", () => {
  const script = stepScript(jobBlock("build-and-test"), VALIDATION_STEP);
  assert.doesNotMatch(script, /\$expectedSha -ne \$actualSha/, "the tip of main is no longer the only approvable commit");
  assert.ok(script.includes('git cat-file -e "$expectedSha^{commit}"'));
  assert.ok(script.includes("git merge-base --is-ancestor $expectedSha $actualSha"));
});

test("the candidate is built and tested from the approved commit in every job", () => {
  const build = jobBlock("build-and-test");
  const names = stepNames(build);
  const order = [VALIDATION_STEP, "Check out the approved commit", "Set up Node.js", "Install exactly from the lockfile",
    "Audit dependencies and registry signatures", "Validate version files and HACS manifest", "Build the release asset from src/"];
  const positions = order.map((name) => names.indexOf(name));
  assert.ok(positions.every((position) => position !== -1), `steps missing: ${order.filter((name, i) => positions[i] === -1).join(", ")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "validate, switch to the approved commit, then install, audit and build");
  assert.match(stepScript(build, "Check out the approved commit"), /git checkout --detach/);
  assert.match(build, /release_sha: \$\{\{ steps\.release-metadata\.outputs\.sha \}\}/);
  assert.match(jobBlock("browser-tests"), /uses: actions\/checkout@[0-9a-f]{40} # [\w.-]+\n {8}with:\n {10}ref: \$\{\{ needs\.build-and-test\.outputs\.release_sha \}\}/);
  assert.match(jobBlock("create-draft"), /EXPECTED_SHA: \$\{\{ needs\.build-and-test\.outputs\.release_sha \}\}/);
  assert.doesNotMatch(WORKFLOW, /EXPECTED_SHA: \$\{\{ inputs\.expected_sha \}\}\n {6}EXPECTED_SHA256/);
});

// ------------------------------------------------------------------------- HACS gate --

test("the HACS gate runs once a stable release is published and never weakens the dependencies of the draft", () => {
  const state = jobBlock("release-state");
  assert.match(state, /\n {4}permissions:\n {6}contents: read\n/);
  assert.match(state, /gh api --paginate/);
  assert.match(state, /select\(\.draft == false and \.prerelease == false\)/);
  assert.match(state, /stable_release_exists: \$\{\{ steps\.state\.outputs\.stable_release_exists \}\}/);

  const hacs = jobBlock("hacs-validation");
  assert.match(hacs, /\n {4}needs: release-state\n/);
  assert.match(hacs, /^ {4}permissions: \{\}$/m, "hacs/action stays in a job without permissions");
  assert.match(
    hacs,
    /- name: HACS validation\n {8}if: needs\.release-state\.outputs\.stable_release_exists != 'false'\n {8}uses: hacs\/action@main\n {8}with:\n {10}category: plugin\n/,
    "fail-closed: only an explicit 'false' skips the validation"
  );
  assert.match(hacs, /if: needs\.release-state\.outputs\.stable_release_exists == 'false'/);
  assert.doesNotMatch(WORKFLOW, /\balways\(\)|continue-on-error/, "no construct that lets a failed gate through");
  assert.match(
    jobBlock("create-draft"),
    /needs:\n {6}- build-and-test\n {6}- browser-tests\n {6}- hacs-validation\n/
  );
});

// ----------------------------------------------------- executable validation script --

function findPowerShell() {
  for (const candidate of ["pwsh", "powershell"]) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const POWERSHELL = findPowerShell();
const NO_POWERSHELL = POWERSHELL ? false : "SKIP: neither pwsh nor powershell is installed; the release workflow runs this script on windows-latest";

const scratch = [];
test.after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", `core.hooksPath=${scratchDir("no-hooks-")}`, "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

// main: one -> two (v2.38.0, v2.39.0) -> three -> four; side branches off two.
function createHistory(extraTags = {}) {
  const dir = scratchDir("release-history-");
  git(dir, "init", "-q", "-b", "main");
  const commit = (message) => {
    fs.writeFileSync(path.join(dir, "file.txt"), message);
    git(dir, "add", "file.txt");
    git(dir, "commit", "-q", "-m", message);
    return git(dir, "rev-parse", "HEAD");
  };
  const one = commit("one");
  git(dir, "tag", "v2.38.0");
  const two = commit("two");
  git(dir, "tag", "v2.39.0");
  git(dir, "tag", "v2.40.0-dev.1");
  git(dir, "checkout", "-q", "-b", "side");
  const side = commit("side");
  git(dir, "checkout", "-q", "main");
  const three = commit("three");
  const four = commit("four");
  const commits = { one, two, three, four, side };
  for (const [tag, target] of Object.entries(extraTags)) git(dir, "tag", tag, commits[target]);
  return { dir, ...commits };
}

const VALIDATION_SCRIPT = stepScript(jobBlock("build-and-test"), VALIDATION_STEP);

function runPowerShell(script, cwd, env) {
  const work = scratchDir("release-run-");
  const file = path.join(work, "step.ps1");
  const output = path.join(work, "github-output.txt");
  fs.writeFileSync(file, script);
  const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env, GITHUB_OUTPUT: output },
  });
  const outputs = fs.existsSync(output) ? fs.readFileSync(output, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
  return { status: result.status, failure: `${result.stderr}${result.stdout}`, outputs };
}

function validate(history, { expected, version, kind = "stable", actor = "owner", ref = "refs/heads/main" }) {
  return runPowerShell(VALIDATION_SCRIPT, history.dir, {
    ACTUAL_SHA: history.four,
    EXPECTED_SHA: expected,
    RELEASE_KIND: kind,
    RELEASE_VERSION: version,
    REPOSITORY_OWNER: "owner",
    SELECTED_REF: ref,
    TRIGGERING_ACTOR: actor,
  });
}

function assertAccepted(result) {
  assert.equal(result.status, 0, result.failure);
}

function assertRefused(result, reason) {
  assert.notEqual(result.status, 0, "the validation must refuse");
  assert.match(result.failure, reason);
  assert.deepEqual(result.outputs, [], "a refused candidate publishes no outputs");
}

test("the tip of main is approved and its normalized SHA is published", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  const result = validate(history, { expected: `  ${history.four.toUpperCase()}  `, version: "2.41.0" });
  assertAccepted(result);
  assert.deepEqual(result.outputs, ["tag=v2.41.0", "title=Room Climate Card 2.41.0", `sha=${history.four}`]);
});

test("an older commit of main is approved, including one that carries an earlier release", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertAccepted(validate(history, { expected: history.three, version: "2.41.0" }));
  assertAccepted(validate(history, { expected: history.two, version: "2.41.0" }));
});

test("a commit outside the history of main, a missing commit and a short SHA are refused", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.side, version: "2.41.0" }), /not part of the main branch history/);
  assertRefused(validate(history, { expected: "0".repeat(40), version: "2.41.0" }), /does not exist/);
  assertRefused(validate(history, { expected: history.four.slice(0, 7), version: "2.41.0" }), /40-character/);
});

test("only the repository owner on main starts a candidate", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.four, version: "2.41.0", actor: "someone-else" }), /Only the repository owner/);
  assertRefused(validate(history, { expected: history.four, version: "2.41.0", ref: "refs/heads/side" }), /branch 'main'/);
});

test("a tag is never reused", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.four, version: "2.39.0" }), /already exists/);
  assertRefused(validate(history, { expected: history.four, version: "2.40.0-dev.1", kind: "dev" }), /already exists/);
});

test("a stable release must be higher than every earlier stable release", { skip: NO_POWERSHELL }, () => {
  const history = createHistory({ "v2.10.0": "two" });
  assertRefused(validate(history, { expected: history.four, version: "2.38.5" }), /must be higher than the existing release v2\.39\.0/);
  assertRefused(validate(history, { expected: history.four, version: "2.9.9" }), /must be higher than the existing release/);
  assertAccepted(validate(history, { expected: history.four, version: "2.39.1" }));
});

test("a stable release must contain every earlier stable release", { skip: NO_POWERSHELL }, () => {
  const history = createHistory({ "v2.39.5": "side" });
  assertRefused(validate(history, { expected: history.four, version: "2.40.0" }), /v2\.39\.5 is not an ancestor/);
});

test("a dev pre-release is not held to the stable ordering", { skip: NO_POWERSHELL }, () => {
  const history = createHistory({ "v2.39.5": "side" });
  assertAccepted(validate(history, { expected: history.three, version: "2.38.1-dev.1", kind: "dev" }));
});

test("the approved commit is checked out detached and verified", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  const script = stepScript(jobBlock("build-and-test"), "Check out the approved commit");
  assertAccepted(runPowerShell(script, history.dir, { APPROVED_SHA: history.two }));
  assert.equal(git(history.dir, "rev-parse", "HEAD"), history.two);
  assert.equal(git(history.dir, "branch", "--show-current"), "", "HEAD is detached");
  const missing = runPowerShell(script, history.dir, { APPROVED_SHA: "0".repeat(40) });
  assert.notEqual(missing.status, 0);
  assert.match(missing.failure, /Could not check out the approved commit/);
});

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

test("any commit in the history of the selected branch can be approved, and no other", () => {
  const script = stepScript(jobBlock("build-and-test"), VALIDATION_STEP);
  assert.doesNotMatch(script, /\$expectedSha -ne \$actualSha/, "the tip of the branch is not the only approvable commit");
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

// Fixture commits are a minute apart in creation order; `author` and `committer` override one
// commit's dates (Unix seconds). GitHub orders releases by these dates.
let clock = 1_700_000_000;

function gitWith(cwd, env, ...args) {
  const result = spawnSync("git", ["-c", `core.hooksPath=${scratchDir("no-hooks-")}`, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", ...env },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return gitWith(cwd, {}, ...args);
}

function fixtureRepository() {
  const dir = scratchDir("release-history-");
  git(dir, "init", "-q", "-b", "main");
  const commit = (message, { author, committer } = {}) => {
    clock += 60;
    fs.writeFileSync(path.join(dir, "file.txt"), message);
    git(dir, "add", "file.txt");
    gitWith(dir, { GIT_AUTHOR_DATE: `@${author ?? clock} +0000`, GIT_COMMITTER_DATE: `@${committer ?? clock} +0000` }, "commit", "-q", "-m", message);
    return git(dir, "rev-parse", "HEAD");
  };
  // An annotated tag is dated long after every commit; the workflow must read its commit's dates.
  const tag = (name, target, { annotated = false } = {}) => {
    if (annotated) gitWith(dir, { GIT_COMMITTER_DATE: `@${clock + 1_000_000} +0000` }, "tag", "-a", name, "-m", name, target);
    else git(dir, "tag", name, target);
  };
  return { dir, commit, tag };
}

// main: one -> two (v2.38.0, v2.39.0) -> three -> four; side branches off two.
function createHistory(extraTags = {}) {
  const { dir, commit, tag } = fixtureRepository();
  const one = commit("one");
  tag("v2.38.0", one);
  const two = commit("two");
  tag("v2.39.0", two);
  tag("v2.40.0-dev.1", two);
  git(dir, "checkout", "-q", "-b", "side");
  const side = commit("side");
  git(dir, "checkout", "-q", "main");
  const three = commit("three");
  const four = commit("four");
  const commits = { one, two, three, four, side };
  for (const [name, target] of Object.entries(extraTags)) tag(name, commits[target]);
  return { dir, ...commits };
}

// main: one (v2.38.0) -> two (v2.39.0) -> bump -> m3 -> m4; the release line rcc/release-2.x
// branches off bump: l1 -> l2. The line commits are dated before m3 and m4 unless `mainFirst`;
// origin/main is m4 and origin/rcc/release-2.x is l2 unless `lineBranch` is false.
function createLineHistory({ mainFirst = false, l2Dates = {}, lineBranch = true, annotated = false, tags = {} } = {}) {
  const { dir, commit, tag } = fixtureRepository();
  const one = commit("one");
  tag("v2.38.0", one, { annotated });
  const two = commit("two");
  tag("v2.39.0", two, { annotated });
  const commits = { one, two, bump: commit("bump") };
  const mainCommits = () => {
    commits.m3 = commit("m3");
    commits.m4 = commit("m4");
  };
  const lineCommits = () => {
    git(dir, "checkout", "-q", "-b", "rcc/release-2.x", commits.bump);
    commits.l1 = commit("l1");
    commits.l2 = commit("l2", l2Dates);
    git(dir, "checkout", "-q", "main");
  };
  if (mainFirst) {
    mainCommits();
    lineCommits();
  } else {
    lineCommits();
    mainCommits();
  }
  git(dir, "update-ref", "refs/remotes/origin/main", commits.m4);
  if (lineBranch) git(dir, "update-ref", "refs/remotes/origin/rcc/release-2.x", commits.l2);
  for (const [name, target] of Object.entries(tags)) tag(name, commits[target], { annotated });
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

function validate(history, { expected, version, kind = "stable", actor = "owner", triggeringActor = actor, ref = "refs/heads/main", actual = history.four }) {
  return runPowerShell(VALIDATION_SCRIPT, history.dir, {
    ACTOR: actor,
    ACTUAL_SHA: actual,
    EXPECTED_SHA: expected,
    RELEASE_KIND: kind,
    RELEASE_VERSION: version,
    REPOSITORY_OWNER: "owner",
    SELECTED_REF: ref,
    TRIGGERING_ACTOR: triggeringActor,
  });
}

const LINE_REF = "refs/heads/rcc/release-2.x";

function fromLine(history, options) {
  return validate(history, { ref: LINE_REF, actual: history.l2, expected: history.l2, ...options });
}

function fromMain(history, options) {
  return validate(history, { actual: history.m4, expected: history.m4, ...options });
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
  assert.deepEqual(result.outputs, ["tag=v2.41.0", "title=Room Climate Card 2.41.0", `sha=${history.four}`, "line=", "major=2"]);
});

test("an older commit of main is approved", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertAccepted(validate(history, { expected: history.three, version: "2.41.0" }));
});

test("a stable release on the commit of an earlier stable release is refused", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.two, version: "2.41.0" }), /not newer than release v2\.39\.0 by author and committer date/);
});

test("a commit outside the history of main, a missing commit and a short SHA are refused", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.side, version: "2.41.0" }), /not part of the main branch history/);
  assertRefused(validate(history, { expected: "0".repeat(40), version: "2.41.0" }), /does not exist/);
  assertRefused(validate(history, { expected: history.four.slice(0, 7), version: "2.41.0" }), /40-character/);
});

test("only the repository owner starts a candidate, also on a re-run", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.four, version: "2.41.0", actor: "someone-else" }), /Only the repository owner/);
  assertRefused(validate(history, { expected: history.four, version: "2.41.0", triggeringActor: "someone-else" }), /Only the repository owner/);
  const line = createLineHistory();
  assertRefused(fromLine(line, { version: "2.40.0", triggeringActor: "someone-else" }), /Only the repository owner/);
});

test("only main and a release line rcc/release-<major>.x start a candidate", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  for (const ref of ["refs/heads/side", "refs/heads/rcc/release-2", "refs/heads/rcc/release-02.x", "refs/heads/rcc/release-2.x/x",
    "refs/heads/RCC/release-2.x", "refs/heads/rcc/Release-2.x", "refs/heads/release-2.x", "refs/heads/Main", "refs/tags/v2.39.0"]) {
    assertRefused(validate(history, { ref, actual: history.l2, expected: history.l2, version: "2.40.0" }), /branch 'main' or a release line rcc\/release-<major>\.x/);
  }
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

test("a version with a number beyond nine digits is refused by its pattern", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertRefused(validate(history, { expected: history.four, version: "2147483648.0.0" }), /A stable version must look like/);
  assertRefused(validate(history, { expected: history.four, version: "2.41.0-dev.1234567890", kind: "dev" }), /A dev pre-release version must look like/);
});

test("main refuses a major whose release is not in its history", { skip: NO_POWERSHELL }, () => {
  const history = createHistory({ "v2.39.5": "side" });
  assertRefused(validate(history, { expected: history.four, version: "2.40.0" }), /v2\.39\.5 is not in the history of main, so major 2 is released from its release line/);
  assertRefused(validate(history, { expected: history.three, version: "2.38.1-dev.1", kind: "dev" }), /v2\.39\.5 is not in the history of main/);
});

test("a dev pre-release is not held to the stable ordering", { skip: NO_POWERSHELL }, () => {
  const history = createHistory();
  assertAccepted(validate(history, { expected: history.three, version: "2.38.1-dev.1", kind: "dev" }));
  assertAccepted(validate(history, { expected: history.two, version: "2.38.1-dev.2", kind: "dev" }));
});

test("a candidate from a release line approves any commit of that line", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  const result = fromLine(history, { version: "2.40.0" });
  assertAccepted(result);
  assert.deepEqual(result.outputs, ["tag=v2.40.0", "title=Room Climate Card 2.40.0", `sha=${history.l2}`, "line=2", "major=2"]);
  assertAccepted(fromLine(history, { expected: history.l1, version: "2.40.0" }));
  assertAccepted(fromLine(history, { expected: history.bump, version: "2.40.0" }));
  assertAccepted(fromLine(history, { version: "2.40.0-dev.1", kind: "dev" }));
});

test("a release line refuses a commit of main that is not on the line", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  assertRefused(fromLine(history, { expected: history.m3, version: "2.40.0" }), /not part of the rcc\/release-2\.x branch history/);
});

test("a release line releases only its own major", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  assertRefused(fromLine(history, { version: "3.0.0" }), /releases only 2\.x\.y versions; 3\.0\.0 is not one/);
  assertRefused(fromLine(history, { version: "1.9.0" }), /releases only 2\.x\.y versions/);
  assertRefused(fromLine(history, { version: "3.0.0-dev.1", kind: "dev" }), /releases only 2\.x\.y versions/);
});

test("main refuses the major of a release line, also once the branch is deleted", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  assertRefused(fromMain(history, { version: "2.40.0" }), /belongs to the release line rcc\/release-2\.x/);
  assertRefused(fromMain(history, { version: "2.40.0-dev.1", kind: "dev" }), /belongs to the release line rcc\/release-2\.x/);
  assertAccepted(fromMain(history, { version: "3.0.0-dev.1", kind: "dev" }));

  const released = createLineHistory({ lineBranch: false, tags: { "v2.40.0": "l2" } });
  assertRefused(fromMain(released, { version: "2.41.0" }), /v2\.40\.0 is not in the history of main/);
  assertRefused(fromMain(released, { version: "2.41.0-dev.1", kind: "dev" }), /v2\.40\.0 is not in the history of main/);
});

test("the first stable release of a major comes from main, not from a release line", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory();
  assertRefused(
    validate(history, { ref: "refs/heads/rcc/release-3.x", actual: history.l2, expected: history.l2, version: "3.0.0" }),
    /Release line 3 has no stable release yet/
  );
});

test("a release line ends with the first stable release of a higher major", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory({ tags: { "v3.0.0": "m4" } });
  assertRefused(fromLine(history, { version: "2.40.0" }), /Release line 2 ended with v3\.0\.0/);
  assertRefused(fromLine(history, { version: "2.40.0-dev.1", kind: "dev" }), /Release line 2 ended with v3\.0\.0/);
});

test("a pre-release of a higher major ends the dev releases of a line, not its stable releases", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory({ tags: { "v3.0.0-dev.1": "m4" } });
  assertRefused(fromLine(history, { version: "2.40.0-dev.1", kind: "dev" }), /Dev releases of line 2 ended with the pre-release v3\.0\.0-dev\.1/);
  assertAccepted(fromLine(history, { version: "2.40.0" }));
});

test("a stable release of a line contains every stable release of its major", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory({ tags: { "v2.39.5": "m3" } });
  assertRefused(fromLine(history, { version: "2.40.0" }), /v2\.39\.5 is not an ancestor of [0-9a-f]{40}; a stable release must contain every\s+earlier stable release of its major version/);
});

test("the first stable release of a new major follows a release of the line", { skip: NO_POWERSHELL }, () => {
  const history = createLineHistory({ tags: { "v2.40.0": "l2" } });
  assertAccepted(fromMain(history, { version: "3.0.0" }));
});

test("a stable release must be newer than every stable release by author and by committer date", { skip: NO_POWERSHELL }, () => {
  const newer = /not newer than release v2\.40\.0 by author and committer date/;
  assertRefused(fromMain(createLineHistory({ mainFirst: true, tags: { "v2.40.0": "l2" } }), { version: "3.0.0" }), newer);
  const late = clock + 100_000;
  assertRefused(fromMain(createLineHistory({ l2Dates: { author: late }, tags: { "v2.40.0": "l2" } }), { version: "3.0.0" }), newer);
  assertRefused(fromMain(createLineHistory({ l2Dates: { committer: late + 100_000 }, tags: { "v2.40.0": "l2" } }), { version: "3.0.0" }), newer);
});

test("annotated release tags are read through to their commit", { skip: NO_POWERSHELL }, () => {
  assertAccepted(fromLine(createLineHistory({ annotated: true }), { version: "2.40.0" }));
  const ended = createLineHistory({ annotated: true, tags: { "v3.0.0": "m4" } });
  assertRefused(fromLine(ended, { version: "2.40.0" }), /Release line 2 ended with v3\.0\.0/);
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

// ------------------------------------------------------------ drafts and release lines --

const CROSSING_STEP = "Refuse a release that would cross a release line";

// rows: [tag_name, draft, prerelease] as `gh api --jq '... | @tsv'` writes them.
function checkReleaseList(rows, { line = "", major, kind = "stable", tag = "v0.0.0" }) {
  const work = scratchDir("release-list-");
  const list = path.join(work, "releases.tsv");
  fs.writeFileSync(list, rows.map((row) => `${row.join("\t")}\n`).join(""));
  return runPowerShell(stepScript(jobBlock("create-draft"), CROSSING_STEP), work, {
    RELEASE_KIND: kind,
    RELEASE_LINE: line,
    RELEASE_LIST: list,
    RELEASE_MAJOR: String(major),
    RELEASE_TAG: tag,
  });
}

test("the draft job lists drafts and checks them before it creates the draft", () => {
  const job = jobBlock("create-draft");
  const names = stepNames(job);
  const order = ["List every release including drafts", CROSSING_STEP, "Create the unpublished draft against the approved commit"];
  const positions = order.map((name) => names.indexOf(name));
  assert.ok(positions.every((position) => position !== -1), `steps missing: ${order.filter((name, i) => positions[i] === -1).join(", ")}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(
    stepScript(job, "List every release including drafts"),
    /gh api --paginate "repos\/\$GITHUB_REPOSITORY\/releases\?per_page=100" \\\n\s+--jq '\.\[\] \| \[\.tag_name, \.draft, \.prerelease\] \| @tsv' > "\$RELEASE_LIST"/
  );
  // The runner context exists in step env, not in job env.
  for (const step of ["List every release including drafts", CROSSING_STEP]) {
    assert.ok(job.includes(`- name: ${step}\n        shell: ${step === CROSSING_STEP ? "pwsh" : "bash"}\n        env:\n          RELEASE_LIST: \${{ runner.temp }}/releases.tsv\n        run: |\n`), `${step} reads the list path from its own env`);
  }
  assert.doesNotMatch(WORKFLOW, /^ {6}\S.*\$\{\{ runner\./m, "no job-level env uses the runner context");
  assert.match(job, /\n {4}permissions:\n {6}contents: write\n/);
  assert.match(job, /RELEASE_LINE: \$\{\{ needs\.build-and-test\.outputs\.release_line \}\}/);
  assert.match(job, /RELEASE_MAJOR: \$\{\{ needs\.build-and-test\.outputs\.release_major \}\}/);
});

test("a draft or release of a higher major ends a release line before its draft is created", { skip: NO_POWERSHELL }, () => {
  assertRefused(checkReleaseList([["v3.0.0", "true", "false"]], { line: "2", major: 2 }), /The draft v3\.0\.0 of a higher major ends release line 2/);
  assertRefused(checkReleaseList([["v3.0.0", "false", "false"]], { line: "2", major: 2 }), /The release v3\.0\.0 of a higher major ends release line 2/);
  assertRefused(checkReleaseList([["v3.0.0-dev.1", "true", "true"]], { line: "2", major: 2, kind: "dev" }), /The draft v3\.0\.0-dev\.1 of a higher major/);
  assertAccepted(checkReleaseList([["v3.0.0-dev.1", "false", "true"], ["v2.39.0", "false", "false"]], { line: "2", major: 2 }));
  assertAccepted(checkReleaseList([], { line: "2", major: 2 }));
});

test("main refuses a new major while a draft of an older major is unpublished", { skip: NO_POWERSHELL }, () => {
  assertRefused(checkReleaseList([["v2.40.1", "true", "false"]], { major: 3, tag: "v3.0.0" }), /The draft v2\.40\.1 of an older major would be ordered after v3\.0\.0/);
  assertAccepted(checkReleaseList([["v2.40.0", "false", "false"], ["v2.39.0", "false", "false"]], { major: 3, tag: "v3.0.0" }));
  assertAccepted(checkReleaseList([["v2.40.0-dev.2", "true", "true"]], { major: 2, tag: "v2.40.0" }));
});

// ------------------------------------------------------------------ static contract --

test("the build job checks out the selected branch with every tag and remote branch", () => {
  const build = jobBlock("build-and-test");
  const checkout = build.match(/- name: Check out the selected branch\n {8}uses: actions\/checkout@[0-9a-f]{40} # [\w.-]+\n {8}with:\n((?: {10}.*\n)+)/);
  assert.ok(checkout, "the first step checks out the selected branch");
  assert.match(checkout[1], /^ {10}fetch-depth: 0$/m);
  assert.doesNotMatch(checkout[1], /^ {10}ref:/m, "the selected branch, not a fixed ref, is checked out");
});

test("candidates of main and of every release line share one concurrency group", () => {
  assert.match(WORKFLOW, /\nconcurrency:\n {2}group: release-candidate\n {2}cancel-in-progress: false\n/);
});

test("the draft is created without gh's no-new-commits check", () => {
  assert.doesNotMatch(WORKFLOW, /^ +--fail-on-no-commits$/m);
  assert.match(jobBlock("create-draft"), /\n {12}--notes-file "\$notes_file"\n {10}\)\n/, "the argument list ends with the notes file");
});

test("CI and Security run for main and every release line", () => {
  for (const file of ["ci.yml", "security.yml"]) {
    const text = readWorkflow(fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", file), "utf8"));
    const on = text.match(/\non:\n((?: {2}.*\n)+)/);
    assert.ok(on, `${file} declares its triggers`);
    for (const event of ["push", "pull_request"]) {
      assert.match(on[1], new RegExp(`^ {2}${event}:\\n {4}branches: \\[main, "rcc/release-\\*"\\]$`, "m"), `${file} ${event}`);
    }
  }
});

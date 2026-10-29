"use strict";
// Supply-chain gates: no dependency is pinned past its fixes, every advisory against a runtime
// dependency and every package without a registry signature stops CI and the release, and every
// action runs from a reviewed commit that Dependabot keeps current. Advisories against build and
// test tooling do not gate: none of that code ships. See TESTING.md "Dependency security".
// Boundary: the files are read as text; whether an advisory exists is npm audit's verdict in CI.

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json"));
const WORKFLOWS = fs.readdirSync(path.join(ROOT, ".github", "workflows")).filter((name) => name.endsWith(".yml"));

// An override may only raise an installed transitive package to a minimum within its major;
// an exact pin would hold it on a vulnerable version after the fix ships.
test("overrides only set a caret minimum for packages in the lockfile", () => {
  const installed = new Set(Object.keys(JSON.parse(read("package-lock.json")).packages)
    .map((key) => key.split("node_modules/").pop()));
  const walk = (overrides, trail) => {
    for (const [name, value] of Object.entries(overrides)) {
      const where = [...trail, name].join(" > ");
      assert.ok(installed.has(name), `${where} is not in the lockfile`);
      if (typeof value === "object") walk(value, [...trail, name]);
      else assert.match(value, /^\^\d+\.\d+\.\d+$/, `${where} must be a caret minimum, not ${value}`);
    }
  };
  walk(pkg.overrides ?? {}, []);
  assert.equal(pkg.resolutions, undefined);
});

test("check:security audits runtime at any severity and registry signatures, not tooling advisories", () => {
  assert.equal(pkg.scripts["check:security"], "npm audit --omit=dev --audit-level=low && npm audit signatures");
});

test("the security workflow audits every push and pull request of main and the release lines, and every week", () => {
  const workflow = read(".github", "workflows", "security.yml");
  assert.match(workflow, /^on:\n  push:\n    branches: \[main, "rcc\/release-\*"\]\n  pull_request:\n    branches: \[main, "rcc\/release-\*"\]\n  schedule:\n    - cron: "[^"]+"\n  workflow_dispatch:/m);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /- run: npm ci\n\n      - name: Audit dependencies and registry signatures\n        run: npm run check:security\n/);
});

test("a release candidate is audited before it is built", () => {
  const workflow = read(".github", "workflows", "release.yml");
  const job = workflow.match(/\n  build-and-test:\n((?:    .*\n|\n)*)/);
  assert.ok(job, "build-and-test job");
  assert.match(job[1], /run: npm ci\n\n      - name: Audit dependencies and registry signatures\n        run: npm run check:security\n/);
  assert.ok(job[1].indexOf("check:security") < job[1].indexOf("npm run build"), "audit precedes the build");
});

// hacs/action publishes no releases Dependabot could follow; it tracks main and is confined to
// jobs without permissions, where it reaches neither the repository nor its secrets.
test("every action is pinned to a full commit SHA, except hacs/action@main without permissions", () => {
  for (const name of WORKFLOWS) {
    const workflow = read(".github", "workflows", name);
    const unprivileged = /^permissions: \{\}$/m.test(workflow);
    for (const [, job, body] of workflow.matchAll(/^  ([\w-]+):\n((?:    .*\n|\n)*)/gm)) {
      for (const line of body.split("\n").filter((entry) => /^\s*(?:- )?uses:/.test(entry))) {
        if (/uses: hacs\/action@main$/.test(line)) {
          assert.ok(unprivileged || /^    permissions: \{\}$/m.test(body), `${name} ${job}: hacs/action needs permissions: {}`);
        } else {
          assert.match(line, /uses: [\w.-]+\/[\w.\/-]+@[0-9a-f]{40} # [\w.-]+$/, `${name} ${job}: ${line.trim()}`);
        }
      }
    }
  }
});

// The project has no YAML parser: dependabot.yml is read as text, one block per `updates` entry,
// and each block is compared with the exact text of its contract.
const dependabotBlocks = () => {
  const blocks = read(".github", "dependabot.yml").split(/\n(?=  - package-ecosystem: )/).slice(1);
  return Object.fromEntries(blocks.map((block) => [block.match(/^  - package-ecosystem: (\S+)/)[1], `${block.trimEnd()}\n`]));
};
const SCHEDULE = '    schedule:\n      interval: cron\n      cronjob: "0 5 1,15 * *"\n';
const COOLDOWN = "    cooldown:\n      default-days: 7\n";
const PATCH_IGNORE = '    ignore:\n      - dependency-name: "*"\n        update-types: ["version-update:semver-patch"]\n';
const VERSION_GROUP = '        update-types: ["minor", "patch"]\n        applies-to: version-updates\n';
const SECURITY_GROUP = '      security:\n        patterns: ["*"]\n        applies-to: security-updates\n';
const GROUPS = {
  npm: `    groups:\n      tooling:\n        dependency-type: development\n${VERSION_GROUP}${SECURITY_GROUP}`,
  "github-actions": `    groups:\n      actions:\n        patterns: ["*"]\n${VERSION_GROUP}${SECURITY_GROUP}`,
};

test("Dependabot watches npm and the workflow actions in the repository root", () => {
  const blocks = dependabotBlocks();
  assert.deepEqual(Object.keys(blocks).sort(), ["github-actions", "npm"]);
  for (const [ecosystem, block] of Object.entries(blocks)) assert.match(block, /\n    directory: \/\n/, ecosystem);
});

// Dependabot only reads the manifests of watched directories; an unwatched one is never updated.
test("the root package.json is the only tracked manifest with dependencies", () => {
  const tracked = execFileSync("git", ["ls-files", "--", "*package.json"], { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  assert.ok(tracked.includes("package.json"));
  for (const file of tracked.filter((candidate) => candidate !== "package.json")) {
    const manifest = JSON.parse(read(file));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(manifest[field], undefined, `${file} ${field}`);
  }
});

test("version updates run on the 1st and 15th, wait a week after a release and skip patch releases", () => {
  for (const [ecosystem, block] of Object.entries(dependabotBlocks())) {
    assert.ok(block.includes(SCHEDULE), `${ecosystem} schedule`);
    assert.ok(block.includes(COOLDOWN), `${ecosystem} cooldown`);
    assert.ok(block.includes(PATCH_IGNORE), `${ecosystem} patch rule`);
    assert.equal(block.match(/dependency-name:/g).length, 1, `${ecosystem} has one ignore rule`);
  }
});

test("minor updates are grouped, majors stay single pull requests and security updates come grouped", () => {
  for (const [ecosystem, block] of Object.entries(dependabotBlocks())) assert.ok(block.endsWith(GROUPS[ecosystem]), `${ecosystem} groups`);
});

// A rule that names only a package would block its security updates as well.
test("no ignore rule can hold back security updates", () => {
  for (const [ecosystem, block] of Object.entries(dependabotBlocks())) {
    const lines = block.split("\n");
    assert.ok(lines.some((line) => line.includes("dependency-name:")), `${ecosystem} has an ignore rule`);
    lines.forEach((line, index) => {
      if (line.includes("dependency-name:")) assert.match(lines[index + 1], /^\s+update-types:/, ecosystem);
    });
  }
});

// `npm ci` must work without a GitHub SSH key (devcontainers, firewalled networks, new
// contributors); a git dependency is fetched as an HTTPS tarball pinned to a full commit.
test("every locked package is fetched over HTTPS, a GitHub one as a tarball of a full commit", () => {
  const { packages } = JSON.parse(read("package-lock.json"));
  for (const [where, entry] of Object.entries(packages)) {
    if (!entry.resolved) continue;
    assert.match(entry.resolved, /^https:\/\//, `${where} resolves to ${entry.resolved}`);
    assert.ok(entry.integrity, `${where} carries no integrity hash`);
    if (entry.resolved.includes("github.com")) {
      assert.match(entry.resolved, /^https:\/\/codeload\.github\.com\/[\w.-]+\/[\w.-]+\/tar\.gz\/[0-9a-f]{40}$/, where);
    }
  }
});

// jsdom sets the floor: the tooling declares exactly the Node versions it supports, and the
// version CI runs (named once more in .nvmrc for local version managers) is one of them.
test("the declared Node versions are jsdom's, and CI and .nvmrc run one of them", () => {
  const jsdom = JSON.parse(read("node_modules", "jsdom", "package.json"));
  assert.equal(pkg.engines?.node, jsdom.engines.node);
  const nvmrc = read(".nvmrc").trim();
  assert.match(nvmrc, /^\d+$/, ".nvmrc names a major version");
  const ranges = pkg.engines.node.split("||").map((range) => range.trim());
  assert.ok(ranges.some((range) => range.startsWith(`^${nvmrc}.`)), `engines must include Node ${nvmrc}: ${ranges.join(", ")}`);
  for (const name of WORKFLOWS) {
    const workflow = read(".github", "workflows", name);
    for (const [, version] of workflow.matchAll(/node-version: (\d+)\s*$/gm)) assert.equal(version, nvmrc, `${name}: node-version ${version}`);
    for (const [, version] of workflow.matchAll(/NODE_VERSION: "(\d+)\.[\d.]+"/g)) assert.equal(version, nvmrc, `${name}: NODE_VERSION`);
  }
});

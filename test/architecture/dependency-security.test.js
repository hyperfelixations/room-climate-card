"use strict";
// Supply-chain gates: no dependency is pinned past its fixes, every advisory against a runtime
// dependency and every package without a registry signature stops CI and the release, and every
// action runs from a reviewed commit that Dependabot keeps current. Advisories against build and
// test tooling do not gate: none of that code ships. See TESTING.md "Dependency security".
// Boundary: the files are read as text; whether an advisory exists is npm audit's verdict in CI.

const test = require("node:test");
const assert = require("node:assert/strict");
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

test("the security workflow audits every push, pull request and week", () => {
  const workflow = read(".github", "workflows", "security.yml");
  assert.match(workflow, /^on:\n  push:\n    branches: \[main\]\n  pull_request:\n    branches: \[main\]\n  schedule:\n    - cron: "[^"]+"\n  workflow_dispatch:/m);
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

test("Dependabot watches npm and the workflow actions", () => {
  const config = read(".github", "dependabot.yml");
  for (const ecosystem of ["npm", "github-actions"]) {
    assert.match(config, new RegExp(`- package-ecosystem: ${ecosystem}\\n    directory: /\\n    schedule:\\n      interval: weekly`), ecosystem);
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

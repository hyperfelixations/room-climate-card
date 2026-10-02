"use strict";
// Supply-chain gates: no dependency is pinned past its fixes, every advisory against a runtime
// dependency and every high one against tooling stops CI and the release, and every action runs
// from a reviewed commit that Dependabot keeps current. See TESTING.md "Dependency security".
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

test("check:security audits runtime at any severity, tooling from high, and registry signatures", () => {
  assert.equal(
    pkg.scripts["check:security"],
    "npm audit --omit=dev --audit-level=low && npm audit --audit-level=high && npm audit signatures",
  );
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

test("every action is pinned to a full commit SHA with its version as comment", () => {
  for (const name of WORKFLOWS) {
    for (const line of read(".github", "workflows", name).split("\n").filter((entry) => /^\s*(?:- )?uses:/.test(entry))) {
      assert.match(line, /uses: [\w.-]+\/[\w.\/-]+@[0-9a-f]{40} # [\w.-]+$/, `${name}: ${line.trim()}`);
    }
  }
});

test("Dependabot watches npm and the workflow actions", () => {
  const config = read(".github", "dependabot.yml");
  for (const ecosystem of ["npm", "github-actions"]) {
    assert.match(config, new RegExp(`- package-ecosystem: ${ecosystem}\\n    directory: /\\n    schedule:\\n      interval: weekly`), ecosystem);
  }
});

"use strict";

// Enforces the structure of the test suite: which directories may hold tests and
// what a file in each may touch. Each directory is a claim, and that claim is
// what makes a failure locatable.
//
//   unit/           imports src modules directly, never the bundle; failure names a function
//   component/      loads the built bundle in jsdom, drives the assembled card
//   contract/       the card's outward promises: custom element, registration, artifact, safety
//   architecture/   the rules the sources and this suite obey
//   characterization/ frozen recordings of what the card produced, with a policy
//   property/       generated populations and the invariants over them
//   browser/        a real browser, because the question needs one
//   manifests/ fixtures/ helpers/  shared material, never tests
//
// Boundary: this checks the test tree. src/ layering is architecture-imports.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEST_DIR = path.join(__dirname, "..");
const ROOT = path.join(TEST_DIR, "..");

// Every directory that may hold test files, and what a file there is allowed to be. A
// directory not listed here fails the first test. manifests/ and helpers/ are absent on
// purpose — shared material, a test file there is itself the failure. fixtures/ is listed
// because two fixtures are large enough to test on their own terms.
const TEST_DIRECTORIES = {
  "unit/core": { bundle: false, needsSrc: true },
  "unit/config": { bundle: false, needsSrc: true },
  "unit/domain": { bundle: false, needsSrc: true },
  "unit/i18n": { bundle: false, needsSrc: true },
  "unit/application": { bundle: false, needsSrc: true },
  "unit/presentation": { bundle: false, needsSrc: true },
  "unit/render": { bundle: false, needsSrc: true },
  "unit/runtime": { bundle: false, needsSrc: true },
  "component/lifecycle": { bundle: true, needsSrc: false },
  "component/interaction": { bundle: true, needsSrc: false },
  "component/rendering": { bundle: true, needsSrc: false },
  "component/data": { bundle: true, needsSrc: false },
  contract: { bundle: null, needsSrc: false },
  architecture: { bundle: null, needsSrc: false },
  characterization: { bundle: null, needsSrc: false },
  property: { bundle: null, needsSrc: false },
  fixtures: { bundle: null, needsSrc: false },
  // The known-defect register lives at the root of test/: it is about the product, not any
  // one layer, and a reader should trip over it.
  "": { bundle: null, needsSrc: false },
};

// The only file the root of test/ may hold, named rather than counted so the next file
// dropped there has to be argued for in this list.
const ROOT_TESTS = ["known-issues.test.js"];

const BROWSER_DIRECTORIES = ["core", "interaction", "geometry", "accessibility", "visual"];

function walk(dir, predicate, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Recorded output, not source.
      if (entry.name === "baseline" || entry.name.endsWith("-snapshots") || entry.name === "fonts") continue;
      walk(full, predicate, found);
      continue;
    }
    if (predicate(entry.name)) found.push(full);
  }
  return found;
}

const relative = (full) => path.relative(TEST_DIR, full).split(path.sep).join("/");
const directoryOf = (rel) => rel.split("/").slice(0, -1).join("/");
const read = (full) => fs.readFileSync(full, "utf8");

const nodeTests = walk(TEST_DIR, (name) => name.endsWith(".test.js")).filter(
  (full) => !relative(full).startsWith("browser/")
);
const browserSpecs = walk(path.join(TEST_DIR, "browser"), (name) => name.endsWith(".spec.js"));

const scripts = JSON.parse(read(path.join(ROOT, "package.json"))).scripts || {};

// Every local file this one pulls in, transitively — a rule that reads only the file itself
// is satisfied by moving the forbidden require one step into a helper. Only relative
// specifiers are followed; a package name cannot reach the bundle unless a followed file
// asks it to.
function localDependencies(entry, seen = new Set()) {
  const resolved = fs.existsSync(entry) && fs.statSync(entry).isFile() ? entry : `${entry}.js`;
  if (!fs.existsSync(resolved) || seen.has(resolved)) return seen;
  seen.add(resolved);
  for (const match of read(resolved).matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    localDependencies(path.resolve(path.dirname(resolved), match[1]), seen);
  }
  return seen;
}

// ----------------------------------------------------------------- where things live --

test("every test file sits in a directory the suite knows about", () => {
  // The rule that keeps the taxonomy real. Without it a new file lands wherever it was
  // convenient, and after a few of those the directories mean nothing again.
  const strays = nodeTests
    .map(relative)
    .filter((rel) => !(directoryOf(rel) in TEST_DIRECTORIES));
  assert.deepEqual(
    strays,
    [],
    "these files are in no registered test directory — put them in one, or register the " +
      "directory in TEST_DIRECTORIES with a reason:\n  " + strays.join("\n  ")
  );
});

test("the known-issue reproduction is the only root-level test", () => {
  // The root is registered so exactly one file may live there. A second root-level test
  // is a file that belongs to some layer and skipped the decision about which.
  const atRoot = nodeTests.map(relative).filter((rel) => !rel.includes("/")).sort();
  assert.deepEqual(atRoot, [...ROOT_TESTS].sort(), `the root of test/ holds: ${atRoot.join(", ")}`);
});

test("every browser spec sits in one of the browser directories", () => {
  const strays = browserSpecs
    .map(relative)
    .filter((rel) => !BROWSER_DIRECTORIES.includes(rel.split("/")[1]));
  assert.deepEqual(strays, [], strays.join("\n  "));
});

test("every browser ownership directory has a focused public and pipeline command", () => {
  // Each directory carries two scripts: the public name builds first, the `:run` name does
  // not, so a pipeline that already built skips the second build and a person who has not
  // built cannot test yesterday's bundle.
  const missing = [];
  for (const directory of BROWSER_DIRECTORIES) {
    for (const suffix of ["", ":run"]) {
      const name = `test:browser:${directory}${suffix}`;
      if (!scripts[name]) missing.push(name);
    }
  }
  assert.deepEqual(missing, [], `package.json has no ${missing.join(", ")}`);

  for (const directory of BROWSER_DIRECTORIES) {
    assert.match(
      scripts[`test:browser:${directory}:run`],
      new RegExp(`test/browser/${directory}\\b`),
      `test:browser:${directory}:run does not point at its own directory`
    );
  }
});

test("the cross-engine core has an explicit command and installer ownership", () => {
  // Firefox and WebKit run a named core, which needs three pieces together: the projects
  // that define it, the command that runs it, the installer that fetches the engines. Any
  // one missing turns the cross-engine run into a silent no-op.
  const config = read(path.join(ROOT, "playwright.config.js"));
  for (const project of ["firefox-core", "webkit-core"]) {
    assert.match(config, new RegExp(`name:\\s*["']${project}["']`), `playwright.config.js defines no ${project} project`);
    assert.match(
      scripts["test:browser:cross-engine:run"],
      new RegExp(`--project=${project}`),
      `test:browser:cross-engine:run does not run ${project}`
    );
  }
  for (const engine of ["chromium", "firefox", "webkit"]) {
    assert.match(scripts["test:install"], new RegExp(`\\b${engine}\\b`), `test:install does not fetch ${engine}`);
  }
});

test("every browser spec uses the coverage-aware Playwright fixture", () => {
  // The fixture is the one seam through which a browser run reports coverage. A spec that
  // imports @playwright/test directly still passes but is invisible to coverage, making the
  // number quietly wrong. So the import is the rule.
  const offenders = browserSpecs
    .filter((file) => /require\(\s*["']@playwright\/test["']\s*\)/.test(read(file)))
    .map(relative);
  assert.deepEqual(offenders, [], `these specs bypass test/helpers/playwright.js:\n  ${offenders.join("\n  ")}`);
});

test("no registered directory is empty", () => {
  // An empty registered directory is a claim nothing supports.
  for (const directory of Object.keys(TEST_DIRECTORIES)) {
    if (directory === "") continue;
    const full = path.join(TEST_DIR, ...directory.split("/"));
    assert.ok(fs.existsSync(full), `${directory} is registered but does not exist`);
    assert.ok(
      nodeTests.some((file) => directoryOf(relative(file)) === directory),
      `${directory} is registered but holds no test`
    );
  }
});

// ------------------------------------------------------------- what a layer may touch --

test("a unit test reaches src directly and never reaches the bundle, even through a helper", () => {
  // Gives `unit/` its meaning: a test that loads the bundle is a component test and belongs
  // next door. Asked of the whole require graph, since a require moved one step into a
  // helper loads the bundle just as thoroughly.
  const offenders = [];
  for (const file of nodeTests) {
    const rel = relative(file);
    const rules = TEST_DIRECTORIES[directoryOf(rel)];
    if (!rules || rules.bundle !== false) continue;
    const viaBundle = [...localDependencies(file)].filter((dependency) => /load-card\.jsdom/.test(dependency));
    if (viaBundle.length) {
      offenders.push(`${rel} reaches the bundle through ${viaBundle.map(relative).join(", ")}`);
    }
    if (rules.needsSrc && !/["']\.\.\/\.\.\/\.\.\/src\//.test(read(file))) {
      offenders.push(`${rel} imports nothing from src, so there is no unit under test`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("a component test really does exercise the assembled card", () => {
  const offenders = [];
  for (const file of nodeTests) {
    const rel = relative(file);
    const rules = TEST_DIRECTORIES[directoryOf(rel)];
    if (!rules || rules.bundle !== true) continue;
    if (!/load-card\.jsdom/.test(read(file))) {
      offenders.push(`${rel} never loads the card — if it tests a module directly it belongs under unit/`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("helpers and fixtures are material, not tests", () => {
  // A `test()` in a helper runs wherever the helper is required and reports under whichever
  // file pulled it in.
  const offenders = [];
  for (const directory of ["helpers", "fixtures", "manifests", "property"]) {
    const dir = path.join(TEST_DIR, directory);
    for (const full of walk(dir, (name) => name.endsWith(".js") && !name.endsWith(".test.js"))) {
      if (/^\s*test\(/m.test(read(full))) offenders.push(relative(full));
    }
  }
  assert.deepEqual(offenders, [], `these are shared material and must not define tests:\n  ${offenders.join("\n  ")}`);
});

// ---------------------------------------------------------------- what a test may be --

test("every test file contains at least one test", () => {
  const empty = nodeTests.filter((file) => !/^\s*test\(/m.test(read(file))).map(relative);
  assert.deepEqual(empty, [], `these files assert nothing:\n  ${empty.join("\n  ")}`);
});

test("nothing is focused, and nothing is skipped without saying why", () => {
  // `.only` reduces a run to one file and passes. A skip needs a reason on the line
  // immediately above, starting with `SKIP:` — a comment merely somewhere above is
  // satisfied by the tail of unrelated prose.
  const offenders = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const code = read(file);
    if (/\btest\.only\(|\bdescribe\.only\(|\bit\.only\(/.test(code)) offenders.push(`${relative(file)}: .only`);
    const lines = code.split("\n");
    for (const [index, line] of lines.entries()) {
      if (!/\btest\.skip\(|\bdescribe\.skip\(|\bit\.skip\(/.test(line)) continue;
      const previous = lines[index - 1] || "";
      if (!/^\s*\/\/\s*SKIP:\s+\S/.test(previous)) {
        offenders.push(`${relative(file)}:${index + 1}: skip needs an immediate // SKIP: reason`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("every test file explains itself before its first test", () => {
  // A floor, not a style: at least four comment lines before the first test, enough to say
  // what the file covers and where its boundary runs. Nothing here judges what they say.
  const thin = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const head = read(file).split(/^\s*(?:test|const test)\b/m)[0];
    const commentLines = head.split("\n").filter((line) => /^\s*\/\//.test(line)).length;
    if (commentLines < 4) thin.push(`${relative(file)} (${commentLines} comment lines before the first test)`);
  }
  assert.deepEqual(thin, [], `these files do not say what they are for:\n  ${thin.join("\n  ")}`);
});

// -------------------------------------------------------------- the shared material --

// One place the product surface may be written out in full. A test that copies a complete
// list has made a second statement that will drift. The manifest's own test is the
// exception, since comparing the manifest against the card is its job.
function completeCopiesOf(values) {
  const offenders = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const rel = relative(file);
    if (rel === "contract/product-surface.test.js") continue;
    const code = read(file);
    const complete = values.every((entry) => new RegExp(`["']${entry}["']`).test(code));
    if (complete && !/product-surface/.test(code)) offenders.push(rel);
  }
  return offenders;
}

test("the product surface manifest is the only complete language list in the suite", () => {
  // A curated subset is fine and stays local; a full copy is what drifts from the manifest.
  const { LANGUAGES } = require("../manifests/product-surface.js");
  const offenders = completeCopiesOf(LANGUAGES);
  assert.deepEqual(
    offenders,
    [],
    `these write out every supported language instead of importing the manifest:\n  ${offenders.join("\n  ")}`
  );
});

test("the product surface manifest is the only complete top-level configuration list", () => {
  // The costlier variant: a stale key copy does not turn red when a key is added, it
  // silently stops covering it.
  const { TOP_LEVEL_CONFIG_KEYS } = require("../manifests/product-surface.js");
  const offenders = completeCopiesOf(TOP_LEVEL_CONFIG_KEYS);
  assert.deepEqual(
    offenders,
    [],
    `these write out every top-level configuration key instead of importing the manifest:\n  ${offenders.join("\n  ")}`
  );
});

"use strict";

// THE ARCHITECTURE OF THE TEST SUITE ITSELF, enforced rather than described.
//
// architecture-imports.test.js does this for src/: it holds the layering by checking it, on
// the reasoning that a design rule nothing verifies is a design rule that erodes. The suite
// has exactly the same problem and had none of the same protection — which is how it came to
// hold seventy files in one flat directory, six independent copies of the language list, and
// a property test whose invariants had not run for five hundred iterations.
//
// WHAT A DIRECTORY MEANS HERE. The taxonomy is not filing; each directory is a claim about
// what its files may touch, and that claim is what makes a failure locatable.
//
//   unit/           imports src modules DIRECTLY and never loads the bundle. A failure names
//                   a function. Subdivided by the src layer it belongs to.
//   component/      loads the built bundle in jsdom and exercises the assembled card. A
//                   failure names a behaviour.
//   contract/       what the card promises the outside world: its custom element, its
//                   registration, its distribution artifact, its safety.
//   architecture/   the rules the sources and this suite obey.
//   characterization/ frozen recordings of what the card produced, with a policy.
//   property/       generated populations and the invariants that must hold over them.
//   browser/        a real browser, because the question needs one.
//   contracts/ fixtures/ helpers/   shared material, and never tests themselves.
//
// The rules below are the ones that can actually be checked. They are deliberately few: a
// structure test that encodes taste rather than consequences is one people route around.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEST_DIR = path.join(__dirname, "..");

// Every directory that may hold test files, and what a file there is allowed to be. A
// directory not listed here fails the first test, so adding one is a decision somebody makes
// on purpose rather than a folder that appears.
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
  contracts: { bundle: null, needsSrc: false },
  architecture: { bundle: null, needsSrc: false },
  characterization: { bundle: null, needsSrc: false },
  property: { bundle: null, needsSrc: false },
  fixtures: { bundle: null, needsSrc: false },
  // The known-defect register lives at the top of test/, next to nothing else, because it is
  // about the PRODUCT rather than about any one layer and a reader should trip over it.
  "": { bundle: null, needsSrc: false },
};

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

test("every browser spec sits in one of the browser directories", () => {
  const strays = browserSpecs
    .map(relative)
    .filter((rel) => !BROWSER_DIRECTORIES.includes(rel.split("/")[1]));
  assert.deepEqual(strays, [], strays.join("\n  "));
});

test("no registered directory is empty", () => {
  // An empty directory is a claim nothing supports, and the next file to land there inherits
  // a category nobody chose for it.
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

test("a unit test imports src directly and never loads the bundle", () => {
  // This is the rule that gives `unit/` its meaning. A test that loads the bundle is testing
  // the assembled card however carefully it is written, and its failure will name a
  // behaviour rather than a function — which is a component test, and belongs next door.
  const offenders = [];
  for (const file of nodeTests) {
    const rel = relative(file);
    const rules = TEST_DIRECTORIES[directoryOf(rel)];
    if (!rules || rules.bundle !== false) continue;
    const code = read(file);
    if (/load-card\.jsdom/.test(code)) offenders.push(`${rel} loads the bundle`);
    if (rules.needsSrc && !/["']\.\.\/\.\.\/\.\.\/src\//.test(code)) {
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
  // A `test()` hiding in a helper runs wherever the helper is required, which is everywhere,
  // and reports under whichever file happened to pull it in.
  const offenders = [];
  for (const directory of ["helpers", "fixtures", "contracts", "property"]) {
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
  // `.only` silently reduces a run to one file and passes. A skip is sometimes right — but a
  // skip with no reason beside it is indistinguishable from a test somebody gave up on.
  const offenders = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const code = read(file);
    if (/\btest\.only\(|\bdescribe\.only\(|\bit\.only\(/.test(code)) offenders.push(`${relative(file)}: .only`);
    for (const [index, line] of code.split("\n").entries()) {
      if (!/\btest\.skip\(|\bdescribe\.skip\(|\bit\.skip\(/.test(line)) continue;
      const context = code.split("\n").slice(Math.max(0, index - 4), index).join("\n");
      if (!/\/\//.test(context)) offenders.push(`${relative(file)}:${index + 1}: skip with no comment above it`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("every test file explains itself before its first test", () => {
  // A header comment is the difference between a suite somebody can change and a suite
  // somebody is afraid of. Enforced as a floor, not a style: four lines is enough to say what
  // the file is for and why it exists separately from its neighbours.
  const thin = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const head = read(file).split(/^\s*(?:test|const test)\b/m)[0];
    const commentLines = head.split("\n").filter((line) => /^\s*\/\//.test(line)).length;
    if (commentLines < 4) thin.push(`${relative(file)} (${commentLines} comment lines before the first test)`);
  }
  assert.deepEqual(thin, [], `these files do not say what they are for:\n  ${thin.join("\n  ")}`);
});

// -------------------------------------------------------------- the shared material --

test("the product surface manifest is the only complete language list in the suite", () => {
  // Six copies of this list used to exist, and the git history shows what that cost: Ukrainian
  // had to be chased through several commits, and one list was still at eleven languages
  // afterwards. A curated SUBSET is fine and stays local; a full copy is the thing that rots.
  const { LANGUAGES } = require("../contracts/product-surface.js");
  const offenders = [];
  for (const file of [...nodeTests, ...browserSpecs]) {
    const rel = relative(file);
    if (rel === "contracts/product-surface.test.js") continue;
    const code = read(file);
    const complete = LANGUAGES.every((code2) => new RegExp(`["']${code2}["']`).test(code));
    if (complete && !/product-surface/.test(code)) {
      offenders.push(`${rel} writes out every supported language instead of importing the manifest`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("the suite is big enough to be worth this, and small enough to read", () => {
  // Not a rule so much as a tripwire: if the count moves a long way in either direction
  // without anyone noticing, one of the assumptions in this file has stopped holding.
  assert.ok(nodeTests.length > 50, `only ${nodeTests.length} node test files`);
  assert.ok(browserSpecs.length > 10, `only ${browserSpecs.length} browser specs`);
});

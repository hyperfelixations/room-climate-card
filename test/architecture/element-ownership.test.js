"use strict";

// Enforces the custom element, retired DTO, and composition-root ownership boundaries.
// This file owns class/member semantics and the deliberately narrow registration root.
// Generic source-layer classification and import-direction rules stay in
// architecture-imports.test.js, where they can be reasoned about as graph edges.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  ELEMENT,
  ENTRY,
  SRC_DIR,
  classify,
  files,
  graph,
  readSource,
  resolveSpecifier,
  stripCommentsAndStringText,
} = require("./source-architecture.js");

test("the legacy DTO adapter is gone from the shipped source entirely", () => {
  // Production renders from the CardViewModel; the flat DTO shape must not exist
  // in src/. The 32 committed DTO baselines are served by a frozen test-only
  // helper (test/helpers/legacy-dto.js) the bundle cannot reach.
  for (const file of files) {
    assert.ok(!/legacy-data/.test(file), `${file} still ships the legacy adapter`);
    const code = stripCommentsAndStringText(readSource(file));
    assert.ok(
      !/\btoLegacyData\b/.test(code),
      `${file} still references toLegacyData — the flat shape must not exist in the bundle`
    );
  }

  // And the helper genuinely lives outside src/, so the bundle cannot pick it up.
  const helper = path.join(SRC_DIR, "..", "test", "helpers", "legacy-dto.js");
  assert.ok(fs.existsSync(helper), "the frozen oracle must still exist for the baselines");
});

// The only tests allowed to reach the frozen adapter, each with its reason. The
// flat DTO records a retired public shape; other tests assert the CardViewModel,
// the owning module, or rendered DOM.
const LEGACY_DTO_ALLOWLIST = new Map([
  [
    "characterization/model.test.js",
    "the 32 committed DTO baselines themselves — a Phase 0 oracle recorded against the " +
      "ORIGINAL monolithic card, and the only independent evidence that the extracted " +
      "pipeline still computes what it always computed",
  ],
  [
    "characterization/pipeline.test.js",
    "replays the same baselines through the pure pipeline, with no element involved, so " +
      "it needs the identical projection to compare against",
  ],
  [
    "unit/presentation/presentation-view-model-modules.test.js",
    "pins the adapter's own flattening and its documented no-extremes/no-range-scale " +
      "defaults, which is what makes the two above trustworthy",
  ],
]);

test("only the historical characterization tests reach the frozen legacy DTO", () => {
  // Keeps the retired flat shape from becoming a convenient shortcut again. The
  // allowlist is small on purpose and each entry states its reason.
  const testDir = path.join(SRC_DIR, "..", "test");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "baseline") walk(full);
        continue;
      }
      if (!/\.(test|spec)\.js$/.test(entry.name)) continue;
      // This file names both checked functions in its own patterns; skip it by
      // resolved path so an unrelated same-named test cannot inherit the skip.
      if (path.resolve(full) === path.resolve(__filename)) continue;
      const code = stripCommentsAndStringText(fs.readFileSync(full, "utf8"));
      if (!/\b(computeLegacyData|toLegacyData)\b/.test(code)) continue;
      // Keyed on the path from test/, not the bare filename, so an allowance
      // cannot be inherited by a same-named file in another directory.
      const relative = path.relative(testDir, full).split(path.sep).join("/");
      if (!LEGACY_DTO_ALLOWLIST.has(relative)) offenders.push(relative);
    }
  };
  walk(testDir);

  assert.deepEqual(
    offenders,
    [],
    "these tests read the frozen flat DTO instead of today's contract — assert against the " +
      "CardViewModel, the module under test or the rendered DOM instead:\n  " + offenders.join("\n  ")
  );

  // An allowlist entry that no longer uses the adapter must be deleted.
  for (const name of LEGACY_DTO_ALLOWLIST.keys()) {
    const full = path.join(testDir, ...name.split("/"));
    assert.ok(fs.existsSync(full), `${name} is allowlisted but does not exist`);
    assert.match(
      fs.readFileSync(full, "utf8"),
      /helpers\/legacy-dto\.js/,
      `${name} no longer uses the frozen adapter — remove it from the allowlist`
    );
  }
});

// Home Assistant's own card surface. Every one of these is called by the dashboard, not
// by anything in src/, so "no caller here" says nothing about them.
const HOST_API = new Set([
  "constructor",
  "connectedCallback",
  "disconnectedCallback",
  "setConfig",
  "hass",
  "getCardSize",
  "getGridOptions",
  "getStubConfig",
]);

test("the element carries no member that production never calls", () => {
  // A test-only forwarding member on the element fails this test. What a test
  // needs from a live card lives in test/helpers/card-internals.js, named against
  // the module it exercises.
  const code = stripCommentsAndStringText(readSource(ELEMENT));

  const declared = [
    ...new Set([...code.matchAll(/^ {4}(?:static\s+)?(?:get\s+|set\s+|async\s+)?([_a-zA-Z][\w$]*)\s*\(/gm)].map((m) => m[1])),
  ];

  // A bound handler counts as called: `this._boundClick = this._handleClick.bind(this)`
  // is a real reference, and this sees it as one.
  const uncalled = declared
    .filter((name) => !HOST_API.has(name))
    .filter((name) => !new RegExp(`this\\s*\\.\\s*${name}(?![\\w$])`).test(code));

  assert.deepEqual(
    uncalled,
    [],
    `these element members have no caller in production — delete them, or move what a test needs into test/helpers/:\n  ${uncalled.join("\n  ")}`
  );
});

test("the uncalled-member guard actually recognizes an orphan", () => {
  // Guards the guard: one regex is the whole check, so a typo would silently disable it.
  const sample = ["class X {", "  _used() { return 1; }", "  _orphan() { return 2; }", "  run() { return this._used(); }", "}"].join("\n");
  const declared = [...sample.matchAll(/^ {2}(?:static\s+)?(?:get\s+|set\s+|async\s+)?([_a-zA-Z][\w$]*)\s*\(/gm)].map((m) => m[1]);
  const uncalled = declared.filter((name) => name !== "run" && !new RegExp(`this\\s*\\.\\s*${name}(?![\\w$])`).test(sample));
  assert.deepEqual(uncalled, ["_orphan"]);
});

test("the element imports nothing it does not use", () => {
  // The build does not tree-shake (rollup.config.mjs: treeshake:false), so an
  // import that outlived its last caller ships dead weight and signals a module
  // still doing something it stopped doing.
  const raw = readSource(ELEMENT);
  const statements = [...raw.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/gms)];
  const last = [...raw.matchAll(/^import\s(?:\{[^}]*\}|[\w$]+)\s*from\s*"[^"]+";/gms)].pop();
  const body = stripCommentsAndStringText(raw.slice(last.index + last[0].length));

  const unused = [];
  for (const statement of statements) {
    for (const spec of statement[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const local = spec.includes(" as ") ? spec.split(" as ").pop().trim() : spec;
      if (!new RegExp(`(?<![\\w$.])${local}(?![\\w$])`).test(body)) unused.push(`${local} (from ${statement[2]})`);
    }
  }
  assert.deepEqual(unused, [], `unused imports in ${ELEMENT}:\n  ${unused.join("\n  ")}`);
});

test("nothing assigns to a read-only window onto controller-owned state", () => {
  // Some element fields are accessors onto controller-owned state. Those with a
  // getter but no setter are read-only on purpose: assigning creates a second
  // copy of the fact, or throws in the strict-mode bundle — and a throw inside a
  // pointermove listener is invisible, the card just stops handling gestures.
  // Read-only names are derived from the source, so a new accessor is covered
  // the day it is added.
  const violations = [];
  for (const file of files) {
    const code = stripCommentsAndStringText(readSource(file));
    const getters = new Set([...code.matchAll(/^\s{2,}get\s+([_a-zA-Z][a-zA-Z0-9]*)\s*\(/gm)].map((m) => m[1]));
    const setters = new Set([...code.matchAll(/^\s{2,}set\s+([_a-zA-Z][a-zA-Z0-9]*)\s*\(/gm)].map((m) => m[1]));
    const readOnly = [...getters].filter((name) => !setters.has(name));
    if (readOnly.length === 0) continue;
    for (const name of readOnly) {
      // `this.x =` but not `this.x ==` / `this.x ===`.
      const assignment = new RegExp(`\\bthis\\s*\\.\\s*${name}\\s*(?:=(?!=)|[-+*/|&^]?=(?!=))`);
      if (assignment.test(code)) violations.push(`${file} assigns to the read-only accessor ${name}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `clear controller-owned state through its owner, not through the window onto it:\n  ${violations.join("\n  ")}`
  );
});

test("the ownership guard actually recognizes an assignment", () => {
  // Guards the guard: the regexes above are the whole check, so a typo in one would
  // silently disable it.
  const sample = [
    "class X {",
    "  get _readOnly() { return 1; }",
    "  get _readWrite() { return 2; }",
    "  set _readWrite(v) {}",
    "  method() { this._readWrite = 3; }",
    "}",
  ].join("\n");
  const code = stripCommentsAndStringText(sample);
  const getters = new Set([...code.matchAll(/^\s{2,}get\s+([_a-zA-Z][a-zA-Z0-9]*)\s*\(/gm)].map((m) => m[1]));
  const setters = new Set([...code.matchAll(/^\s{2,}set\s+([_a-zA-Z][a-zA-Z0-9]*)\s*\(/gm)].map((m) => m[1]));
  assert.deepEqual([...getters].filter((name) => !setters.has(name)), ["_readOnly"]);

  const assigns = (name, source) => new RegExp(`\\bthis\\s*\\.\\s*${name}\\s*(?:=(?!=)|[-+*/|&^]?=(?!=))`).test(source);
  assert.equal(assigns("_readOnly", "this._readOnly = null;"), true);
  assert.equal(assigns("_readOnly", "if (this._readOnly === null) {}"), false, "a comparison is not an assignment");
  assert.equal(assigns("_readOnly", "if (this._readOnly == null) {}"), false);
  assert.equal(assigns("_readOnly", "return this._readOnly;"), false);
});

test("the custom element declares no method name twice", () => {
  // A duplicate class member is legal JavaScript: the later definition wins and
  // the earlier one becomes unreachable — a stale implementation that looks
  // present, reads plausibly and never runs.
  const seen = new Map();
  readSource(ELEMENT)
    .split("\n")
    .forEach((line, index) => {
      const match = line.match(/^ {4}(?:static )?([_a-zA-Z][a-zA-Z0-9]*)\(/);
      if (!match) return;
      if (!seen.has(match[1])) seen.set(match[1], []);
      seen.get(match[1]).push(index + 1);
    });
  const duplicates = [...seen.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([name, lines]) => `${name} at lines ${lines.join(", ")}`);
  assert.deepEqual(duplicates, [], `shadowed class members:\n  ${duplicates.join("\n  ")}`);
  assert.ok(seen.size > 50, "the scan must actually have found methods");
});

test("the custom element lives in its own layer and is reachable", () => {
  const elementFiles = files.filter((file) => classify(file).name === "element");
  assert.ok(elementFiles.includes(ELEMENT), "the element must live in element/");
  // Reachability is checked globally too; named here so a source change cannot
  // orphan the element while tests still pass.
  const rootImports = graph.get(ENTRY).specifiers.map((specifier) => resolveSpecifier(ENTRY, specifier));
  assert.ok(rootImports.includes(ELEMENT), "the composition root must import the element");
});

test("the composition root contains no class, no render logic and no domain logic", () => {
  // What it is allowed to do: import the element, register it, announce it to the
  // dashboard's card picker, expose the version. Nothing else.
  const code = stripCommentsAndStringText(readSource(ENTRY));
  assert.ok(!/\bclass\s/.test(code), "the custom element class does not belong in the composition root");
  for (const forbidden of [
    "shadowRoot",
    "innerHTML",
    "querySelector",
    "addEventListener",
    "setTimeout",
    "requestAnimationFrame",
    "buildCardViewModel",
    "buildCardDomainModel",
    "renderCardBody",
    "buildStyles",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(code),
      `${ENTRY} references ${forbidden} — the root registers the card, it does not run it`
    );
  }
  // The three global reads that ARE allowed here, and only here: the custom element
  // registry and the dashboard's card list cannot be reached any other way.
  assert.match(code, /customElements\s*\.\s*define/);
  assert.match(code, /window\s*\.\s*customCards/);
});


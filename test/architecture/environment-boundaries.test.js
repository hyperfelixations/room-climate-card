"use strict";

// Enforces deterministic, injected environment access across model, render, and controller layers.
// It owns ambient-global and clock boundaries, including the scanner that detects violations.
// Import direction belongs to architecture-imports.test.js; element member ownership belongs
// to element-ownership.test.js, so each failure names one architectural responsibility.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BROWSER_ADAPTER,
  FORBIDDEN_APPLICATION_GLOBALS,
  FORBIDDEN_CLOCK_READS,
  FORBIDDEN_CONTROLLER_GLOBALS,
  FORBIDDEN_RENDER_CONTEXT_IDENTIFIERS,
  FORBIDDEN_RENDER_GLOBALS,
  RENDER_LAYER_NAMES,
  classify,
  files,
  readSource,
  referencesGlobal,
  stripCommentsAndStringText,
} = require("./source-architecture.js");

test("the application layer stays free of ambient environment globals", () => {
  const violations = [];
  for (const file of files) {
    if (classify(file).name !== "application/model") continue;
    const code = stripCommentsAndStringText(readSource(file));
    for (const identifier of FORBIDDEN_APPLICATION_GLOBALS) {
      if (new RegExp(`\\b${identifier}\\b`).test(code)) {
        violations.push(`${file} references ${identifier}`);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `the application/model layer must be computable without a browser — pass what it needs as an argument:\n  ${violations.join("\n  ")}`
  );
});

test("the application layer reads no wall clock of its own", () => {
  const violations = [];
  for (const file of files) {
    if (classify(file).name !== "application/model") continue;
    const code = stripCommentsAndStringText(readSource(file));
    for (const pattern of FORBIDDEN_CLOCK_READS) {
      if (pattern.test(code)) violations.push(`${file} matches ${pattern}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `a clock must be injected so results stay reproducible:\n  ${violations.join("\n  ")}`
  );
});

test("the rendering layers touch the DOM only through what they are given", () => {
  const violations = [];
  for (const file of files) {
    if (!RENDER_LAYER_NAMES.includes(classify(file).name)) continue;
    const code = stripCommentsAndStringText(readSource(file));
    for (const identifier of FORBIDDEN_RENDER_GLOBALS) {
      if (referencesGlobal(code, identifier)) violations.push(`${file} references the global ${identifier}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `a render module must receive its document, window and nodes as arguments:\n  ${violations.join("\n  ")}`
  );
});

test("no renderer is handed the custom element as a generic context", () => {
  const violations = [];
  for (const file of files) {
    if (!RENDER_LAYER_NAMES.includes(classify(file).name)) continue;
    const code = stripCommentsAndStringText(readSource(file));
    for (const identifier of FORBIDDEN_RENDER_CONTEXT_IDENTIFIERS) {
      if (new RegExp(`\\b${identifier}\\b`).test(code)) violations.push(`${file} references ${identifier}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `render and view modules take a RenderContext and a view model, never the card:\n  ${violations.join("\n  ")}`
  );
});

test("only the named browser adapter touches an ambient platform global", () => {
  const violations = [];
  for (const file of files) {
    if (classify(file).name !== "controllers/runtime" || file === BROWSER_ADAPTER) continue;
    const code = stripCommentsAndStringText(readSource(file));
    for (const identifier of FORBIDDEN_CONTROLLER_GLOBALS) {
      if (referencesGlobal(code, identifier)) violations.push(`${file} references the global ${identifier}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `a controller receives its clock, timers and observers from the platform:\n  ${violations.join("\n  ")}`
  );
});

test("the browser adapter is the only production implementation of the platform", () => {
  // A second implementation would be a second answer to "what does this card do to the
  // browser", and the fake belongs to the tests, not to the shipped bundle.
  const implementations = files.filter((file) => /platform/i.test(file));
  assert.deepEqual(implementations, [BROWSER_ADAPTER]);
});

test("the source scanner sees through template substitutions", () => {
  // Guards the guard: a scanner that removed whole template literals would
  // miss the most likely way a global reaches a model module.
  const cases = [
    ["const a = `${window.innerWidth}px`;", true, "identifier inside a substitution"],
    ["const a = `plain window text`;", false, "identifier in template TEXT"],
    ['const a = "window";', false, "identifier in a string"],
    ["// window\nconst a = 1;", false, "identifier in a line comment"],
    ["/* window */\nconst a = 1;", false, "identifier in a block comment"],
    ["const a = `${ `${document.title}` }`;", true, "nested template inside a substitution"],
    ["const a = `${ { k: 1 }.k }` + document.title;", true, "braces inside a substitution"],
    ["const a = `${ { k: 1 }.k }`;", false, "object literal inside a substitution only"],
    ["const a = `a\\`window\\`b`;", false, "escaped backtick keeps us in template text"],
  ];
  for (const [source, shouldMatch, label] of cases) {
    const code = stripCommentsAndStringText(source);
    const found = /\b(window|document)\b/.test(code);
    assert.equal(found, shouldMatch, `${label}: scanned as ${JSON.stringify(code)}`);
  }
});

test("the global check distinguishes a global from a realm-correct property access", () => {
  // Guards the guard again: without the lookbehind, the one CORRECT way to reach
  // getComputedStyle would be the only thing the check could see.
  assert.equal(referencesGlobal("const s = getComputedStyle(el);", "getComputedStyle"), true);
  assert.equal(referencesGlobal("const s = el.ownerDocument.defaultView.getComputedStyle(el);", "getComputedStyle"), false);
  assert.equal(referencesGlobal("const d = document;", "document"), true);
  assert.equal(referencesGlobal("const d = el.ownerDocument;", "document"), false, "ownerDocument is not the global");
  assert.equal(referencesGlobal("const t = setTimeout;", "setTimeout"), true);
  assert.equal(referencesGlobal("const t = view.setTimeout;", "setTimeout"), false);
});

test("the source scanner preserves line numbers", () => {
  // Comments and template text are blanked, not deleted, so a reported
  // violation can still be located.
  const source = "const a = 1;\n// window\nconst b = `x\ny`;\nconst c = 3;\n";
  assert.equal(stripCommentsAndStringText(source).split("\n").length, source.split("\n").length);
});

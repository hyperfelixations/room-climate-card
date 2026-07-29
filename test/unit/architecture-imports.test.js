"use strict";

// Enforces the layering contract of the source split.
//
// The refactoring's whole value depends on dependencies pointing one way. A
// single "just this once" upward import — a domain module reaching into the
// renderer, a model module reading `document` through a view helper — is
// invisible in a passing test suite and cheap to add, but it is what turns a
// layered design back into the monolith it replaced. Rollup only rejects
// cycles and unresolved specifiers; direction is a design rule that nothing
// but a test can hold.
//
// The binding directory layout (paths are normative, not illustrative):
//
//   0  src/core/                     no project-internal dependencies at all
//   1  src/config/                   } may import core, but not each other
//      src/i18n/                     }
//      src/domain/                   }
//   2  src/application/model/        no DOM, window, document, custom elements
//   3  src/presentation/view-model/  may join model and i18n
//   4  src/views/  src/render/       no back-imports from runtime or element
//   5  src/controllers/runtime/
//   6  src/element/                  no domain computation
//   7  src/index.js                  composition root
//
// Anything under src/ that is not covered by one of those prefixes fails the
// test, so adding a directory forces an explicit decision here rather than a
// silent new layer.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "..", "src");
const ENTRY = "index.js";

// Ordered: the first matching prefix wins, so "application/model/" is checked
// before any shorter prefix could shadow it.
const LAYERS = [
  { layer: 0, name: "core", group: "core", prefix: "core/" },
  { layer: 1, name: "config", group: "config", prefix: "config/" },
  { layer: 1, name: "i18n", group: "i18n", prefix: "i18n/" },
  { layer: 1, name: "domain", group: "domain", prefix: "domain/" },
  { layer: 2, name: "application/model", group: "application/model", prefix: "application/model/" },
  { layer: 3, name: "presentation/view-model", group: "presentation/view-model", prefix: "presentation/view-model/" },
  { layer: 4, name: "views", group: "views", prefix: "views/" },
  { layer: 4, name: "render", group: "render", prefix: "render/" },
  { layer: 5, name: "controllers/runtime", group: "controllers/runtime", prefix: "controllers/runtime/" },
  { layer: 6, name: "element", group: "element", prefix: "element/" },
];
const COMPOSITION_ROOT = { layer: 7, name: "composition root", group: "(root)" };

// Ambient environment surface that must not appear in the application layer.
// Matched as whole identifiers, against code only (comments and string/template
// TEXT are removed first — see stripCommentsAndStringText).
//
// The point is not tidiness: a model module that reaches for a global is a
// module that cannot be unit-tested without a browser, cannot be reasoned about
// deterministically, and quietly reintroduces the coupling this refactoring
// exists to remove. Everything environmental has to arrive as an argument.
const FORBIDDEN_APPLICATION_GLOBALS = [
  // Realm
  "globalThis",
  "window",
  "document",
  "navigator",
  "location",
  // DOM types and registries
  "HTMLElement",
  "Element",
  "Node",
  "customElements",
  "shadowRoot",
  "attachShadow",
  "innerHTML",
  // Events
  "Event",
  "CustomEvent",
  "addEventListener",
  // Storage and network
  "localStorage",
  "sessionStorage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  // Timers and scheduling — a clock must be injected, never read ambiently
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  // Observers
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  // Layout and media queries
  "getComputedStyle",
  "matchMedia",
];

// Direct wall-clock reads are called out separately, because the fix is
// different: not "pass the DOM in" but "pass a clock in". Receiving and
// processing an already-supplied Date value stays fine, so only the reading
// entry points are forbidden.
const FORBIDDEN_CLOCK_READS = [/\bDate\s*\.\s*now\b/, /\bnew\s+Date\s*\(\s*\)/, /\bperformance\s*\.\s*now\b/];

function listSourceFiles(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listSourceFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out.sort();
}

function classify(relPath) {
  if (relPath === ENTRY) return COMPOSITION_ROOT;
  const found = LAYERS.find((l) => relPath.startsWith(l.prefix));
  return found ? { layer: found.layer, name: found.name, group: found.group } : null;
}

// Static specifiers only. A dynamic import() would break the single-file
// distribution contract outright and is asserted against separately below.
const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

function readSource(relPath) {
  return fs.readFileSync(path.join(SRC_DIR, relPath), "utf8");
}

function importsOf(relPath) {
  const text = readSource(relPath);
  const specifiers = [];
  for (const re of [STATIC_IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) specifiers.push(match[1]);
  }
  return { specifiers, hasDynamicImport: DYNAMIC_IMPORT_RE.test(text) };
}

function resolveSpecifier(fromRelPath, specifier) {
  const fromDir = path.posix.dirname(fromRelPath);
  return path.posix.normalize(path.posix.join(fromDir === "." ? "" : fromDir, specifier));
}

// Removes comments and the TEXT of string/template literals, while keeping
// everything that is actually evaluated — in particular the `${...}`
// substitutions inside template literals.
//
// A regex that deletes whole templates would hide the most likely way a global
// sneaks into a model module: `` `${window.innerWidth}px` ``. This is therefore a
// small character-by-character scanner rather than a set of replacements. It
// tracks template nesting depth so a template inside a substitution inside a
// template still ends up in the right state.
//
// Regex literals are deliberately NOT parsed away. Distinguishing `/` as
// division from `/` as a regex start needs real parsing, and getting that wrong
// would silently disable the whole check. Leaving regex bodies in can only ever
// produce a false positive, which is safe: it fails loudly and is trivial to
// resolve by renaming or restructuring.
function stripCommentsAndStringText(source) {
  let out = "";
  let i = 0;
  // Stack of template states: each entry is the substitution depth of braces
  // currently open inside that template's `${...}`.
  const templates = [];
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    const inTemplateText = templates.length > 0 && templates[templates.length - 1] === null;

    if (inTemplateText) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        templates.pop();
        out += " ";
        i += 1;
        continue;
      }
      if (c === "$" && next === "{") {
        // Enter a substitution: from here on this is real code again.
        templates[templates.length - 1] = 1;
        out += " ";
        i += 2;
        continue;
      }
      // Template text: drop it, but keep newlines so line-based tooling and
      // error messages stay aligned.
      out += c === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const block = source.slice(i, end === -1 ? n : end + 2);
      out += block.replace(/[^\n]/g, " ");
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      while (i < n && source[i] !== c) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += " ";
      continue;
    }
    if (c === "`") {
      templates.push(null);
      out += " ";
      i += 1;
      continue;
    }
    if (templates.length > 0 && templates[templates.length - 1] !== null) {
      // Inside a `${...}` substitution: track braces so the closing one
      // returns us to template text rather than ending the template.
      if (c === "{") templates[templates.length - 1] += 1;
      else if (c === "}") {
        templates[templates.length - 1] -= 1;
        if (templates[templates.length - 1] === 0) {
          templates[templates.length - 1] = null;
          out += " ";
          i += 1;
          continue;
        }
      }
    }
    out += c;
    i += 1;
  }
  return out;
}

const files = listSourceFiles(SRC_DIR);
const graph = new Map(files.map((file) => [file, importsOf(file)]));

test("every source file is assigned to exactly one architectural layer", () => {
  for (const file of files) {
    assert.notEqual(
      classify(file),
      null,
      `${file} is not covered by the layering contract — add its directory prefix to LAYERS in this test, with an explicit decision about where it belongs`
    );
  }
});

test("all imports are relative, resolvable, and inside src/", () => {
  for (const file of files) {
    for (const specifier of graph.get(file).specifiers) {
      assert.ok(
        specifier.startsWith("./") || specifier.startsWith("../"),
        `${file} imports "${specifier}" — the bundle must stay dependency-free, only relative source imports are allowed`
      );
      const target = resolveSpecifier(file, specifier);
      assert.ok(!target.startsWith(".."), `${file} imports "${specifier}", which resolves outside src/`);
      assert.ok(
        files.includes(target),
        `${file} imports "${specifier}" (-> ${target}), which does not exist; imports must carry the .js extension`
      );
    }
  }
});

test("no source file uses dynamic import()", () => {
  for (const file of files) {
    assert.equal(
      graph.get(file).hasDynamicImport,
      false,
      `${file} uses dynamic import() — Home Assistant loads the card as one plain script`
    );
  }
});

test("imports only ever point downwards through the layers", () => {
  const violations = [];
  for (const file of files) {
    const from = classify(file);
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      if (!files.includes(target)) continue;
      const to = classify(target);
      if (!to) continue;
      if (to.layer > from.layer) {
        violations.push(
          `${file} (layer ${from.layer} ${from.name}) imports ${target} (layer ${to.layer} ${to.name}) — upward import`
        );
      }
    }
  }
  assert.deepEqual(violations, [], `layering violations:\n  ${violations.join("\n  ")}`);
});

test("same-layer imports stay inside one group (config, i18n and domain must not import each other)", () => {
  const violations = [];
  for (const file of files) {
    const from = classify(file);
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      if (!files.includes(target)) continue;
      const to = classify(target);
      if (!to || to.layer !== from.layer) continue;
      if (to.group !== from.group) {
        violations.push(
          `${file} imports ${target} — both are layer ${from.layer}, but "${from.group}" and "${to.group}" are separate groups`
        );
      }
    }
  }
  assert.deepEqual(violations, [], `sideways imports:\n  ${violations.join("\n  ")}`);
});

test("core has no project-internal dependencies", () => {
  for (const file of files) {
    if (classify(file).layer !== 0) continue;
    assert.deepEqual(
      graph.get(file).specifiers,
      [],
      `${file} is in core and must not import anything from the project`
    );
  }
});

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

test("the source scanner preserves line numbers", () => {
  // Comments and template text are blanked, not deleted, so a reported
  // violation can still be located.
  const source = "const a = 1;\n// window\nconst b = `x\ny`;\nconst c = 3;\n";
  assert.equal(stripCommentsAndStringText(source).split("\n").length, source.split("\n").length);
});

test("the import graph is acyclic", () => {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map(files.map((file) => [file, WHITE]));
  const stack = [];
  let cycle = null;

  const visit = (file) => {
    if (cycle) return;
    colour.set(file, GREY);
    stack.push(file);
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      if (!files.includes(target)) continue;
      if (colour.get(target) === GREY) {
        cycle = [...stack.slice(stack.indexOf(target)), target];
        return;
      }
      if (colour.get(target) === WHITE) visit(target);
      if (cycle) return;
    }
    stack.pop();
    colour.set(file, BLACK);
  };

  for (const file of files) {
    if (colour.get(file) === WHITE) visit(file);
  }

  assert.equal(cycle, null, cycle ? `import cycle: ${cycle.join(" -> ")}` : "");
});

test("every source file is reachable from the composition root", () => {
  const seen = new Set([ENTRY]);
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.shift();
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      if (files.includes(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  const orphans = files.filter((file) => !seen.has(file));
  assert.deepEqual(orphans, [], `unreachable from src/${ENTRY} (dead modules):\n  ${orphans.join("\n  ")}`);
});

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
//   0  src/core/                      no project-internal dependencies at all
//   1  src/config/                    } may import core, but not each other
//      src/i18n/                      }
//      src/domain/                    }
//   2  src/application/model/         no DOM, window, document, custom elements
//   3  src/presentation/view-model/   may join model and i18n
//   4  src/render/primitives/         } markup and DOM patching, no view knowledge
//      src/render/layout/             } measure-and-position, no view knowledge
//      src/styles/                    } the stylesheet, no view knowledge
//   5  src/views/                     } one module per view; may use layer 4
//      src/render/composition/        } the card shell; gets the registry injected
//   6  src/controllers/runtime/
//   7  src/element/                   no domain computation
//   8  src/index.js                   composition root
//
// Anything under src/ that is not covered by one of those prefixes fails the
// test, so adding a directory forces an explicit decision here rather than a
// silent new layer.
//
// Layer 4 and layer 5 are deliberately split, and the split does real work:
//
//   - a render primitive can never import a view, so "the average button" cannot
//     acquire an opinion about the carousel;
//   - a view CAN import primitives, which is the whole point — the four views
//     share one scale bar, one metric card and one marker shape;
//   - the card shell cannot import the view registry, because the shell and the
//     registry are separate groups of the same layer. The composition root hands
//     the registry to the shell, so a shell that hardcoded a view key would have
//     nowhere to get it from.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "..", "src");
const ENTRY = "index.js";
const ELEMENT = "element/room-climate-card.js";

// Ordered: the first matching prefix wins, so "application/model/" is checked
// before any shorter prefix could shadow it.
const LAYERS = [
  { layer: 0, name: "core", group: "core", prefix: "core/" },
  { layer: 1, name: "config", group: "config", prefix: "config/" },
  { layer: 1, name: "i18n", group: "i18n", prefix: "i18n/" },
  { layer: 1, name: "domain", group: "domain", prefix: "domain/" },
  { layer: 2, name: "application/model", group: "application/model", prefix: "application/model/" },
  { layer: 3, name: "presentation/view-model", group: "presentation/view-model", prefix: "presentation/view-model/" },
  // primitives and layout are one group: the layout pass measures rendered nodes and
  // legitimately uses the same DOM-reading primitives the renderers do. styles is
  // separate — a stylesheet has nothing to say about a node.
  { layer: 4, name: "render/primitives", group: "render", prefix: "render/primitives/" },
  { layer: 4, name: "render/layout", group: "render", prefix: "render/layout/" },
  { layer: 4, name: "styles", group: "styles", prefix: "styles/" },
  { layer: 5, name: "views", group: "views", prefix: "views/" },
  { layer: 5, name: "render/composition", group: "render/composition", prefix: "render/composition/" },
  { layer: 6, name: "controllers/runtime", group: "controllers/runtime", prefix: "controllers/runtime/" },
  { layer: 7, name: "element", group: "element", prefix: "element/" },
];
const COMPOSITION_ROOT = { layer: 8, name: "composition root", group: "(root)" };

// Every layer at or above the rendering layers. Used by the checks that keep the
// element out of the render path.
const RENDER_LAYER_NAMES = ["render/primitives", "render/layout", "styles", "views", "render/composition"];

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

// The rendering layers DO touch the DOM — that is their job — but never through an
// ambient global. Every document, window and element they use arrives as an
// argument, either on the RenderContext or as the node being patched. That is what
// makes a render module testable against a foreign jsdom realm, and what stops the
// render path from depending on which document happens to be global.
//
// The timer and observer entries are not about the DOM at all: scheduling belongs to
// the controller layer, and a renderer that armed its own timer would be able to
// change the card after the render it was asked for.
const FORBIDDEN_RENDER_GLOBALS = [
  "globalThis",
  "window",
  "document",
  "navigator",
  "location",
  "customElements",
  "localStorage",
  "sessionStorage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  "matchMedia",
  // getComputedStyle must be reached through the element's OWN realm
  // (element.ownerDocument.defaultView), never as a global.
  "getComputedStyle",
];

// These names are forbidden as GLOBALS, not as property names. `defaultView
// .getComputedStyle(el)` is exactly the realm-correct form the contract asks for,
// while a bare `getComputedStyle(el)` silently resolves against whichever document
// happens to be ambient. The lookbehind is what distinguishes the two.
function referencesGlobal(code, identifier) {
  return new RegExp(`(?<![.\\w$])${identifier}\\b`).test(code);
}

// The custom element must never reach a renderer. Historically every render and
// update function took the card itself as a generic context and helped itself to
// whatever it needed — the formatter, the config, the translator, the classifier —
// which is precisely why the render path could not be tested or reasoned about
// separately. These identifiers are the fingerprints of that shape.
//
// `card` is included as a whole identifier. Longer names are unaffected
// (`cardColor`, `metricCardModel`, `cardEl` all pass), so the cost is a small
// naming convention in the render layers and the benefit is a rule a machine can
// actually check.
const FORBIDDEN_RENDER_CONTEXT_IDENTIFIERS = [
  "card",
  "hass",
  "shadowRoot",
  "attachShadow",
  "_config",
  "_hass",
  "this",
];

// The controller layer schedules, times and observes — which is precisely why it must
// not reach any of it ambiently. Everything comes from the platform object, and the
// platform has exactly ONE production implementation. That one file is the only place
// in the whole source tree where a timer, an observer, a clock or a document is
// touched directly, which makes "what does this card do to the browser" a question
// with a single file for an answer.
const BROWSER_ADAPTER = "controllers/runtime/browser-platform.js";
const FORBIDDEN_CONTROLLER_GLOBALS = [
  "globalThis",
  "window",
  "document",
  "navigator",
  "location",
  "customElements",
  "localStorage",
  "sessionStorage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "ResizeObserver",
  "MutationObserver",
  "IntersectionObserver",
  "matchMedia",
  "getComputedStyle",
  "DOMMatrix",
  "DOMMatrixReadOnly",
  "Event",
  "CustomEvent",
];

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

test("the card shell cannot reach the view registry, and no view reaches a controller", () => {
  // Both follow from the layer table, but they are the two rules the split exists
  // for, so they are asserted by name rather than left implicit in a generic
  // direction check that would still pass if someone merged the groups.
  const shell = files.filter((file) => classify(file).name === "render/composition");
  assert.ok(shell.length > 0, "the card shell must exist");
  for (const file of shell) {
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      assert.ok(
        !target.startsWith("views/"),
        `${file} imports ${target} — the shell receives the view registry from the composition root instead`
      );
    }
  }

  const viewFiles = files.filter((file) => classify(file).name === "views");
  assert.ok(viewFiles.length > 0, "the view modules must exist");
  for (const file of viewFiles) {
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      assert.ok(
        !target.startsWith("controllers/") && !target.startsWith("element/"),
        `${file} imports ${target} — a view renders, it does not drive the card`
      );
    }
  }
});

test("the legacy DTO adapter is gone from the shipped source entirely", () => {
  // It was scaffolding with a planned end, and this is that end. The flat object the
  // pre-refactoring card produced is no longer computed anywhere in src/: production
  // renders from the CardViewModel, and the 32 committed DTO baselines are served by a
  // frozen test-only helper (test/helpers/legacy-dto.js) that nothing here can reach.
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

test("the controller layer exists and imports nothing above itself", () => {
  const controllers = files.filter((file) => classify(file).name === "controllers/runtime");
  assert.ok(controllers.length > 0, "controllers/runtime must exist");
  assert.ok(controllers.includes(BROWSER_ADAPTER), "the browser adapter must be the named one");
  for (const file of controllers) {
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      assert.ok(
        !target.startsWith("element/") && target !== ENTRY,
        `${file} imports ${target} — a controller is driven BY the element, it does not reach back into it`
      );
    }
  }
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

test("no render primitive knows about a view", () => {
  for (const file of files) {
    if (!["render/primitives", "render/layout", "styles"].includes(classify(file).name)) continue;
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      assert.ok(
        !target.startsWith("views/") && !target.startsWith("render/composition/"),
        `${file} imports ${target} — a shared primitive must stay unaware of who uses it`
      );
    }
  }
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

test("nothing assigns to a read-only window onto controller-owned state", () => {
  // Since the runtime extraction, some element fields are accessors onto state a
  // controller owns. Those with a getter but NO setter are read-only on purpose: a
  // setter would either create a second copy of the same fact or, in the strict-mode
  // bundle, throw. The second one actually happened — `this._resumeAutoTimer = null`
  // right after the owner had already cleared it, inside a pointermove listener, where
  // a throw is invisible: the card just stops responding to gestures.
  //
  // This derives the read-only names from the source instead of listing them, so a
  // future accessor is covered the day it is added.
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
  // A duplicate class member is legal JavaScript: the later definition silently wins
  // and the earlier one becomes unreachable. During an extraction that is exactly how
  // a stale implementation survives — it looks present, reads plausibly, and is never
  // executed. A shadowed _trendDisplayText() lived here for a whole phase.
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
  // Reachability is already checked globally, but naming it here means a future
  // refactor cannot quietly orphan the element and still pass.
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
  assert.ok(readSource(ENTRY).split("\n").length < 80, "a registration root that grows past a screen is no longer a registration root");
});

test("no controller reaches back into the element or the composition root", () => {
  for (const file of files) {
    if (classify(file).name !== "controllers/runtime") continue;
    for (const specifier of graph.get(file).specifiers) {
      const target = resolveSpecifier(file, specifier);
      assert.ok(
        !target.startsWith("element/") && target !== ENTRY,
        `${file} imports ${target} — a controller is driven BY the element, never the other way round`
      );
    }
  }
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

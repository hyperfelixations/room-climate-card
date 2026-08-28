"use strict";

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
  { layer: 6, name: "controllers/render", group: "controllers/render", prefix: "controllers/render/" },
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
// deterministically, and quietly reintroduces the coupling the layer boundaries
// exist to prevent. Everything environmental has to arrive as an argument.
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

module.exports = {
  SRC_DIR,
  ENTRY,
  ELEMENT,
  RENDER_LAYER_NAMES,
  FORBIDDEN_APPLICATION_GLOBALS,
  FORBIDDEN_CLOCK_READS,
  FORBIDDEN_RENDER_GLOBALS,
  FORBIDDEN_RENDER_CONTEXT_IDENTIFIERS,
  BROWSER_ADAPTER,
  FORBIDDEN_CONTROLLER_GLOBALS,
  referencesGlobal,
  classify,
  readSource,
  resolveSpecifier,
  stripCommentsAndStringText,
  files,
  graph,
};

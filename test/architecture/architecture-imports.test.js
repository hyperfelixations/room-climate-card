"use strict";

// Enforces the source layering contract: every file lands in exactly one layer,
// imports are relative and resolvable inside src/, the graph is acyclic, and
// imports only ever point downwards (sideways only within one group). Full
// contract: interne Doku §4 "Import- und Layervertrag". Layer prefixes and the
// forbidden-global lists are data in source-architecture.js, which this drives.
//
//   0 core/   1 config|i18n|domain   2 application/model   3 presentation/view-model
//   4 render/{primitives,layout}|styles   5 views|render/composition
//   6 controllers/{runtime,render}   7 element   8 index.js
//
// A file under src/ matching no prefix fails, so a new directory forces a
// decision here. Boundary: src/ import direction only — suite-structure checks
// the test tree, environment-boundaries and element-ownership the global and
// accessor rules.

const test = require("node:test");
const assert = require("node:assert/strict");
const { BROWSER_ADAPTER, ENTRY, classify, files, graph, resolveSpecifier } = require("./source-architecture.js");

test("every source file is assigned to exactly one architectural layer", () => {
  for (const file of files) {
    assert.notEqual(
      classify(file),
      null,
      `${file} is not covered by the layering contract — add its directory prefix to LAYERS in source-architecture.js, with an explicit decision about where it belongs`
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

test("the card shell cannot reach the view registry, and no view reaches a controller", () => {
  // The two rules the layer split exists for, asserted by name so a generic
  // direction check that still passed after merging the groups cannot hide them.
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

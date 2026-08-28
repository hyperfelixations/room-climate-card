"use strict";

// Enforces the layering contract of the source split.
//
// The architecture depends on imports pointing one way. A
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
//   6  src/controllers/runtime/       } timers, gestures, the platform
//      src/controllers/render/        } what to render and how much of it
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
//
// Layer 6 is split the same way and for the same reason: the render controller
// decides WHETHER and HOW MUCH to render, the runtime controllers decide WHEN
// things move. Neither may import the other, so a render decision can never come
// to depend on a timer, and a timer can never trigger a render behind the
// element's back. The element wires them together and is the only thing that
// knows both exist.

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

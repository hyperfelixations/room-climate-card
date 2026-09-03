"use strict";

// The render decision, tested without a card: seven ports in, one decision out, no DOM and
// no clock. Driven with counters and plain objects, so the awkward cases — a render that
// throws, a gesture that swallows an update, a config change that invalidates the memory —
// can be stated directly.

const test = require("node:test");
const assert = require("node:assert/strict");

let createRenderController;
let RENDER_PATH;
let entityDataSignature;
let structuralConfigSignature;

// The surface, a constant here: this file is about which entity changes move the signature.
// Built with the real constructor so a change to the surface shape reaches this file.
let SURFACE;

test.before(async () => {
  ({ createRenderController, RENDER_PATH } = await import("../../../src/controllers/render/render-controller.js"));
  ({ entityDataSignature, structuralConfigSignature } = await import("../../../src/controllers/render/render-signatures.js"));
  const { surfaceOf } = await import("../../../src/domain/classification/paint-roles.js");
  SURFACE = surfaceOf(["#FFFFFF"], "#212121");
});

// A view model shaped only as far as cardStructureSignature() reads it; the real shell
// composition is tested in the rendering-layer tests.
function viewModelOf({ empty = false, structure = "s1", hintKind = "value-unavailable", headlineEntity = "" } = {}) {
  return {
    empty,
    // hasLabel and hasSubtitle are part of the structure signature: a caption or subtitle is
    // a node that either exists or does not, so the fixture carries it like the renderer does.
    average: { hasLabel: true, entity: headlineEntity },
    header: { hasSubtitle: true },
    rooms: { showChips: true },
    noData: { hintKind },
    views: empty
      ? { keys: [], collapsed: true, byKey: {} }
      : { keys: ["scale"], collapsed: false, byKey: { scale: { marker: structure } } },
  };
}

// The registry the controller hands to cardStructureSignature(): view renderers, each
// declaring the optional nodes it does not reconcile.
const RENDERERS = [{ key: "scale", structureSignature: (content) => content.marker }];

function harness({ viewModel = viewModelOf(), dragging = false, currentlyEmpty = false } = {}) {
  const calls = { renderAll: [], updateEmpty: 0, updateContent: 0, computeViewModel: 0 };
  const state = { viewModel, dragging, currentlyEmpty, throwOnCompute: null, throwOnRenderAll: null };

  const controller = createRenderController({
    viewRenderers: RENDERERS,
    computeViewModel: () => {
      calls.computeViewModel += 1;
      if (state.throwOnCompute) throw state.throwOnCompute;
      return state.viewModel;
    },
    isDragging: () => state.dragging,
    isCurrentlyEmpty: () => state.currentlyEmpty,
    renderAll: (vm, options) => {
      if (state.throwOnRenderAll) throw state.throwOnRenderAll;
      calls.renderAll.push({ vm, options });
      state.currentlyEmpty = vm.empty;
    },
    updateEmpty: () => {
      calls.updateEmpty += 1;
    },
    updateContent: () => {
      calls.updateContent += 1;
    },
  });

  const render = (overrides = {}) =>
    controller.render({ dataSignature: "d1", structuralConfigSignature: "c1", ...overrides });

  return { controller, calls, state, render };
}

// ---------------------------------------------------------------- the paths --

test("the first render is always a full one, whatever the signatures say", () => {
  const { controller, calls, render } = harness();
  assert.equal(render(), RENDER_PATH.FULL);
  assert.equal(calls.renderAll.length, 1);
  assert.equal(calls.renderAll[0].options.isFirstRender, true, "there is no previous view to protect");
  assert.equal(controller.hasRendered, true);
});

test("an unchanged data signature is skipped before any view model is computed", () => {
  const { calls, render } = harness();
  render();
  assert.equal(calls.computeViewModel, 1);
  assert.equal(render(), RENDER_PATH.SKIPPED);
  assert.equal(calls.computeViewModel, 1, "the skip must happen before the pipeline runs, not after");
});

test("allowSkip: false renders the same data again", () => {
  const { render, calls } = harness();
  render();
  assert.equal(render({ allowSkip: false }), RENDER_PATH.CONTENT);
  assert.equal(calls.updateContent, 1);
});

test("new data with the same structure is a content patch, not a rebuild", () => {
  const { render, calls } = harness();
  render();
  assert.equal(render({ dataSignature: "d2" }), RENDER_PATH.CONTENT);
  assert.equal(calls.renderAll.length, 1, "the markup must not be rebuilt for a value change");
  assert.equal(calls.updateContent, 1);
});

test("a changed structure signature forces a rebuild even when the data is identical", () => {
  const { render, calls, state } = harness();
  render();
  state.viewModel = viewModelOf({ structure: "s2" });
  assert.equal(render({ dataSignature: "d2" }), RENDER_PATH.FULL);
  assert.equal(calls.renderAll.length, 2);
  assert.equal(calls.renderAll[1].options.isFirstRender, false, "the previously visible view must be preserved");
});

test("a changed structural config signature forces a rebuild", () => {
  const { render, calls } = harness();
  render();
  assert.equal(render({ dataSignature: "d2", structuralConfigSignature: "c2" }), RENDER_PATH.FULL);
  assert.equal(calls.renderAll.length, 2);
});

test("crossing into and out of the no-data state rebuilds; staying there patches", () => {
  const { render, calls, state } = harness();
  render();

  state.viewModel = viewModelOf({ empty: true });
  assert.equal(render({ dataSignature: "d2" }), RENDER_PATH.FULL, "entering the no-data state changes the markup");
  assert.equal(calls.renderAll.length, 2);

  state.viewModel = viewModelOf({ empty: true, structure: "s9" });
  assert.equal(render({ dataSignature: "d3" }), RENDER_PATH.EMPTY, "an empty card that stays empty is patched");
  assert.equal(calls.updateEmpty, 1);

  state.viewModel = viewModelOf({ empty: true, hintKind: "entity-missing" });
  assert.equal(render({ dataSignature: "d3b" }), RENDER_PATH.FULL, "a different no-data structure is rebuilt");

  state.viewModel = viewModelOf({ empty: false });
  assert.equal(render({ dataSignature: "d4" }), RENDER_PATH.FULL, "leaving the no-data state changes it back");
});

// -------------------------------------------------------- commit on success --

test("a throwing computeViewModel commits nothing, so the identical retry still renders", () => {
  const { render, state } = harness();
  render();

  state.throwOnCompute = new Error("induced");
  assert.throws(() => render({ dataSignature: "d2" }), /induced/);

  state.throwOnCompute = null;
  assert.equal(
    render({ dataSignature: "d2" }),
    RENDER_PATH.CONTENT,
    "committing before the render succeeded would make this identical push compare equal and freeze the card"
  );
});

test("a throwing renderAll commits nothing either", () => {
  const { render, state, calls } = harness();
  render();

  state.throwOnRenderAll = new Error("induced");
  state.viewModel = viewModelOf({ structure: "s2" });
  assert.throws(() => render({ dataSignature: "d2" }), /induced/);

  state.throwOnRenderAll = null;
  assert.equal(render({ dataSignature: "d2" }), RENDER_PATH.FULL, "the structure change is still outstanding");
  assert.equal(calls.renderAll.length, 2);
});

test("the view model on screen is only updated once a render path has succeeded", () => {
  const { controller, render, state } = harness();
  render();
  const committed = controller.lastViewModel;
  assert.equal(committed, state.viewModel);

  state.throwOnCompute = new Error("induced");
  assert.throws(() => render({ dataSignature: "d2" }), /induced/);
  assert.equal(controller.lastViewModel, committed, "a failed render must not change what the card believes is on screen");
});

// ------------------------------------------------------------ deferred work --

test("a render arriving mid-gesture is deferred and nothing is computed for it", () => {
  const { controller, render, state, calls } = harness();
  render();

  state.dragging = true;
  assert.equal(render({ dataSignature: "d2" }), RENDER_PATH.DEFERRED);
  assert.equal(calls.computeViewModel, 1, "nothing may be computed for a render that cannot be applied");
  assert.equal(controller.isRenderPending, true);
});

test("a completed render settles the debt, whichever path it took", () => {
  for (const [name, arrange] of [
    ["content", (h) => h],
    ["full", (h) => (h.state.viewModel = viewModelOf({ structure: "s2" })) && h],
    ["empty", (h) => (h.state.viewModel = viewModelOf({ empty: true })) && h],
  ]) {
    const h = harness();
    h.render();
    h.state.dragging = true;
    h.render({ dataSignature: "d2" });
    assert.equal(h.controller.isRenderPending, true, name);

    arrange(h);
    h.state.dragging = false;
    h.render({ dataSignature: "d2" });
    assert.equal(h.controller.isRenderPending, false, `${name}: the render caught up, so nothing is owed`);
  }
});

test("a skip settles the debt too, because the card already shows what was deferred", () => {
  const { controller, render, state } = harness();
  render();
  state.dragging = true;
  render({ dataSignature: "d1" }); // the same data that is already committed
  assert.equal(controller.isRenderPending, true);

  state.dragging = false;
  assert.equal(render({ dataSignature: "d1" }), RENDER_PATH.SKIPPED);
  assert.equal(controller.isRenderPending, false);
});

test("a render that throws leaves the debt standing, so the update cannot be lost", () => {
  // Why the debt is cleared inside commit() and not at the call site: a failure that also
  // forgot the update would strand the card on stale data with nothing to retry from.
  const { controller, render, state } = harness();
  render();
  state.dragging = true;
  render({ dataSignature: "d2" });
  assert.equal(controller.isRenderPending, true);

  state.dragging = false;
  state.throwOnCompute = new Error("induced");
  assert.throws(() => render({ dataSignature: "d2" }), /induced/);
  assert.equal(controller.isRenderPending, true, "still owed");

  state.throwOnCompute = null;
  render({ dataSignature: "d2" });
  assert.equal(controller.isRenderPending, false);
});

// ------------------------------------------------- configuration boundaries --

test("invalidateDataSignature makes the next identical push render again", () => {
  const { controller, render } = harness();
  render();
  assert.equal(render(), RENDER_PATH.SKIPPED);

  // A new configuration can change the output without any entity changing (a language
  // override, a decimals setting), so the remembered signature must not skip the render
  // that applies it.
  controller.invalidateDataSignature();
  assert.equal(render(), RENDER_PATH.CONTENT);
});

test("the pre-config visual key reaches exactly the render that follows it, then stops", () => {
  const { controller, render, calls, state } = harness();
  render();
  assert.equal(calls.renderAll[0].options.preConfigVisualKey, undefined, "no snapshot outside a config change");

  controller.capturePreConfigVisualKey("range");
  state.viewModel = viewModelOf({ structure: "s2" });
  render({ dataSignature: "d2" });
  assert.equal(calls.renderAll[1].options.preConfigVisualKey, "range");

  controller.releasePreConfigVisualKey();
  state.viewModel = viewModelOf({ structure: "s3" });
  render({ dataSignature: "d3" });
  assert.equal(calls.renderAll[2].options.preConfigVisualKey, undefined);
});

test("null is a real snapshot meaning 'nothing was visible', not the absence of one", () => {
  const { controller, render, calls, state } = harness();
  render();
  controller.capturePreConfigVisualKey(null);
  state.viewModel = viewModelOf({ structure: "s2" });
  render({ dataSignature: "d2" });
  assert.equal(calls.renderAll[1].options.preConfigVisualKey, null, "null must survive as itself, or the render would recompute live");
});

// ----------------------------------------------------------- the signatures --

test("entityDataSignature covers every entity the card reads, including attribute-only updates", () => {
  const config = {
    entity: "sensor.avg",
    range_entity: "sensor.range",
    trend_entity: "sensor.trend",
    rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
    rotation_seconds: 8,
    slide_seconds: 0.4,
  };
  const states = {
    "sensor.avg": { state: "22", last_updated: "T0" },
    "sensor.range": { state: "3", last_updated: "T0" },
    "sensor.trend": { state: "1", last_updated: "T0" },
    "sensor.r1": { state: "21", last_updated: "T0" },
    "sensor.r2": { state: "23", last_updated: "T0" },
  };
  const base = entityDataSignature({ config, states, language: "en", activeViewIndex: 0, surface: SURFACE });

  // An attribute-only change leaves the state string alone but moves last_updated — why
  // last_updated is used rather than last_changed.
  const attributeOnly = { ...states, "sensor.r2": { state: "23", last_updated: "T1" } };
  assert.notEqual(entityDataSignature({ config, states: attributeOnly, language: "en", activeViewIndex: 0, surface: SURFACE }), base);

  assert.notEqual(entityDataSignature({ config, states, language: "de", activeViewIndex: 0, surface: SURFACE }), base, "language");
  assert.notEqual(entityDataSignature({ config, states, language: "en", activeViewIndex: 1, surface: SURFACE }), base, "active view");
  assert.notEqual(
    entityDataSignature({ config: { ...config, rotation_seconds: 9 }, states, language: "en", activeViewIndex: 0, surface: SURFACE }),
    base,
    "rotation_seconds"
  );
});

test("entityDataSignature ignores entities the card does not read", () => {
  const config = { entity: "sensor.avg", rooms: [], rotation_seconds: 8, slide_seconds: 0.4 };
  const args = { config, language: "en", activeViewIndex: 0, surface: SURFACE };
  const a = entityDataSignature({ ...args, states: { "sensor.avg": { state: "22", last_updated: "T0" } } });
  const b = entityDataSignature({
    ...args,
    states: { "sensor.avg": { state: "22", last_updated: "T0" }, "sensor.other": { state: "99", last_updated: "T9" } },
  });
  assert.equal(a, b, "an unrelated entity updating must not cost a render");
});

test("entityDataSignature tolerates a missing state object", () => {
  const config = { entity: "sensor.gone", rooms: [], rotation_seconds: 8, slide_seconds: 0.4 };
  const signature = entityDataSignature({ config, states: {}, language: "en", activeViewIndex: 0, surface: SURFACE });
  assert.match(signature, /^sensor\.gone::\|/, "an absent entity is still part of the signature, as an empty reading");
  assert.equal(signature, entityDataSignature({ config, states: undefined, language: "en", activeViewIndex: 0, surface: SURFACE }));
});

test("structuralConfigSignature changes for every option that cannot be patched", () => {
  const config = {
    hide_footer: false,
    rotation_seconds: 8,
    slide_seconds: 0.4,
    auto_slide: true,
    views: [{ type: "scale", options: { show_comfort_band: true } }],
  };
  const base = structuralConfigSignature(config);
  for (const change of [
    { hide_footer: true },
    { rotation_seconds: 9 },
    { slide_seconds: 0.5 },
    { auto_slide: false },
    { views: [{ type: "scale", options: { show_comfort_band: false } }] },
  ]) {
    assert.notEqual(structuralConfigSignature({ ...config, ...change }), base, JSON.stringify(change));
  }
});

test("structuralConfigSignature is stable for a change that CAN be patched", () => {
  const config = { hide_footer: false, rotation_seconds: 8, slide_seconds: 0.4, auto_slide: true, views: null };
  assert.equal(structuralConfigSignature({ ...config, entity: "sensor.other" }), structuralConfigSignature(config));
});

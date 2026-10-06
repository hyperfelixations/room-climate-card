"use strict";

// The registration contract for a view: one presentation module (definition plus content
// builder) and one renderer are everything a new view adds. A synthetic fifth view is
// registered beside the four shipped ones and driven through view state, content, render,
// structure signature, patch and layout; drift between the two lists fails at composition.
// Boundary: the shell's own markup is render-shell.test.js, each shipped view's markup is
// render-views.test.js.

process.env.TZ = "UTC";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { viewModel } = require("../../fixtures/render-models.js");

let renderContext;
let cardShell;
let registry;
let viewState;
let optionSchemas;

test.before(async () => {
  renderContext = await import("../../../src/render/primitives/render-context.js");
  cardShell = await import("../../../src/render/composition/card-shell.js");
  registry = await import("../../../src/views/registry.js");
  viewState = await import("../../../src/presentation/view-model/view-state.js");
  optionSchemas = await import("../../../src/config/option-schemas.js");
});

function fifthDefinition() {
  return {
    key: "fifth",
    condition: (availability) => availability.hasFifth === true,
    defaultEnabled: () => true,
    optionsSchema: { show_label: optionSchemas.boolOption(true) },
    buildContent: (shared, options) => ({ label: options.show_label ? shared.label : null }),
  };
}

const fifthView = {
  key: "fifth",
  structureSignature: (content) => (content.label === null ? "-" : "l"),
  render: (context, content) => `<div class="fifth-view">${content.label ?? ""}</div>`,
  patch: (context, viewEl, content) => {
    viewEl.querySelector(".fifth-view").textContent = content.label ?? "";
  },
  resolveLayout: (context, viewEl) => {
    viewEl.querySelector(".fifth-view").dataset.measured = "yes";
  },
};

const AVAILABILITY = { hasRange: false, roomsComparable: false, rangeScaleAvailable: false, hasFifth: true };

function fifthModel(definitions, label) {
  const state = viewState.buildViewState(
    { availability: AVAILABILITY, config: { views: [{ type: "fifth", enabled: "auto", options: {} }] } },
    definitions
  );
  const byKey = viewState.buildViewContent({ shared: { label }, viewState: state }, definitions);
  return viewModel({ views: { ...viewModel().views, keys: state.keys, options: state.options, byKey } });
}

test("a fifth view registers with one definition and one renderer, and runs every stage", () => {
  const definitions = viewState.defineViews([...viewState.VIEW_DEFINITIONS, fifthDefinition()]);
  const renderers = registry.composeViewRenderers(definitions, [...registry.VIEW_RENDERERS, fifthView]);
  assert.deepEqual(renderers.map((view) => view.key), ["range", "range_scale", "scale", "extremes", "fifth"]);

  const model = fifthModel(definitions, "Hello");
  assert.deepEqual(model.views.keys, ["fifth"]);
  assert.deepEqual(model.views.options.fifth, { show_label: true });
  assert.equal(model.views.byKey.scale, null, "an inactive view builds no content");

  const jsdom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const root = jsdom.window.document.getElementById("root");
  const context = renderContext.createRenderContext(jsdom.window.document);
  root.innerHTML = cardShell.renderCardBody(context, model, renderers);
  const label = root.querySelector(".rtc-rotator-solo .fifth-view");
  assert.equal(label.textContent, "Hello");
  assert.match(cardShell.cardStructureSignature(model, renderers), /\|fifth:l$/);

  cardShell.patchCardBody(context, root, fifthModel(definitions, "Bye"), renderers);
  assert.equal(root.querySelector(".fifth-view"), label, "patched in place");
  assert.equal(label.textContent, "Bye");

  cardShell.resolveViewLayouts(context, root, model, renderers);
  assert.equal(label.dataset.measured, "yes");
});

test("a definition without its content builder, or a repeated key, is refused", () => {
  const { buildContent, ...withoutBuilder } = fifthDefinition();
  assert.equal(typeof buildContent, "function");
  assert.throws(() => viewState.defineViews([...viewState.VIEW_DEFINITIONS, withoutBuilder]), /fifth.*buildContent/);
  assert.throws(() => viewState.defineViews([...viewState.VIEW_DEFINITIONS, viewState.VIEW_DEFINITIONS[0]]), /duplicate.*range/);
});

test("drift between definitions and renderers is refused at composition", () => {
  const definitions = viewState.defineViews([...viewState.VIEW_DEFINITIONS, fifthDefinition()]);
  assert.throws(() => registry.composeViewRenderers(definitions, registry.VIEW_RENDERERS), /no implementation for view "fifth"/);
  assert.throws(
    () => registry.composeViewRenderers(viewState.VIEW_DEFINITIONS, [...registry.VIEW_RENDERERS, fifthView]),
    /implementation without a definition.*fifth/
  );
  assert.throws(
    () => registry.composeViewRenderers(definitions, [...registry.VIEW_RENDERERS, { ...fifthView, structureSignature: "l" }]),
    /fifth.*structureSignature/
  );
});

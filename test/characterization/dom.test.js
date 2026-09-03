"use strict";

// Characterization of rendered shadow-DOM markup, verbatim. The card builds its DOM from
// template strings and patches it in place. The browser layer
// (test/browser/visual/visual-golden.spec.js) owns the visual contract; what it cannot see
// is the markup — class names, attribute order, ARIA labels, title tooltips, data-* hooks,
// inline custom properties, hidden flags, template whitespace. The <style> block is a digest
// reference here (full text in characterization-styles.test.js). A second baseline captures
// the state after a partial update, because the keyed patch path builds the same markup
// through different code and the two must converge.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, captureShadowMarkup, expectBaseline } = require("../helpers/characterization.js");
const { SCENARIOS, buildHass } = require("../helpers/characterization-scenarios.js");

let env;
let console_;

test.before(() => {
  env = createFrozenEnvironment();
  console_ = recordConsole(env);
});

test.after(() => {
  console_.restore();
  env.cleanupAll();
});

for (const scenario of SCENARIOS) {
  test(`shadow DOM baseline: ${scenario.name}`, () => {
    const el = env.createCard(scenario.config, buildHass(scenario));
    const { markup } = captureShadowMarkup(el);
    expectBaseline(`dom/${scenario.name}.html`, `${markup}\n`);
    env.cleanup(el);
  });
}

test("the partial-update path (_updateContent) converges on the same DOM as the full render path", () => {
  for (const scenario of SCENARIOS) {
    const rendered = env.createCard(scenario.config, buildHass(scenario));
    const afterFullRender = captureShadowMarkup(rendered).markup;

    // _render(false) forces past the signature fast-path skip, exercising _updateContent()/
    // the keyed patchers on an already-built DOM.
    rendered._render(false);
    const afterPatch = captureShadowMarkup(rendered).markup;

    assert.equal(
      afterPatch,
      afterFullRender,
      `scenario ${scenario.name}: the keyed patch path must not change any markup for unchanged data`
    );
    env.cleanup(rendered);
  }
});

test("re-rendering an identical config/hass pair is byte-identical across two separate elements", () => {
  for (const scenario of SCENARIOS) {
    const a = env.createCard(scenario.config, buildHass(scenario));
    const b = env.createCard(scenario.config, buildHass(scenario));
    assert.equal(captureShadowMarkup(b).markup, captureShadowMarkup(a).markup, `scenario ${scenario.name}`);
    env.cleanup(a);
    env.cleanup(b);
  }
});

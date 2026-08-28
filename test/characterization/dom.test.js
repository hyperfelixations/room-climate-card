"use strict";

// Characterization of rendered shadow-DOM markup, verbatim.
//
// The card builds its DOM from template strings and then patches it in place.
// The browser layer (test/browser/visual/visual-golden.spec.js) owns the VISUAL
// contract with real Chromium screenshots; what it cannot see is the markup
// itself — class names, attribute order, ARIA labels, title tooltips,
// data-* hooks, inline CSS custom properties, hidden flags, and the exact
// whitespace that the template literals produce. Those are precisely what a
// renderer extraction is most likely to disturb, and they had no verbatim
// coverage before.
//
// The <style> block is replaced by a digest reference here; its full text is
// pinned by characterization-styles.test.js.
//
// A second baseline captures the state AFTER a partial update (_updateContent()
// via a plain hass push), because the keyed DOM-patching path builds the same
// markup through completely different code (setAttribute/textContent/
// style.setProperty instead of template strings). Render path and patch path
// must converge on the same DOM — that convergence is an explicit acceptance
// compatibility criterion.

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

    // A fresh hass object with identical states forces _render() past its
    // signature fast-path skip (the signature is unchanged, so allowSkip
    // would return early) — pushing the same states through _render(false)
    // exercises _updateContent()/the keyed patchers on an already-built DOM.
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

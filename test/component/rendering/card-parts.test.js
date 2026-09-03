"use strict";

// Which parts of the card are drawn, and what the card looks like when one is not. The
// `show:` block turns seven parts on and off (accent bar, icon, the two header lines, the
// headline caption, the status pill, the middle panel), plus the room chips with a third
// answer of their own. Each is a node: hiding it removes the element, like `subtitle: ""`.
// The default comes first in every test — a card that asks for nothing must look exactly
// as it always has, which the DOM characterization baselines pin. Boundary: accent-line
// .test.js owns the top bar and its older top-level spelling; this file owns the block,
// the combinations, and what the card says when nothing is left.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { scenario, buildScenario } = require("../../fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

const parts = (card) => ({
  header: card.shadowRoot.querySelector(".rtc-header"),
  icon: card.shadowRoot.querySelector(".rtc-icon-badge"),
  titleBlock: card.shadowRoot.querySelector(".rtc-title-block"),
  title: card.shadowRoot.querySelector(".rtc-title"),
  subtitle: card.shadowRoot.querySelector(".rtc-subtitle"),
  pill: card.shadowRoot.querySelector(".rtc-status-pill"),
  panel: card.shadowRoot.querySelector(".rtc-main-panel"),
  chips: card.shadowRoot.querySelector(".rtc-room-grid"),
  nothing: card.shadowRoot.querySelector(".rtc-nothing-shown"),
  root: card.shadowRoot.querySelector(".rtc-root"),
});

const cardWith = (show, overrides = {}) => {
  const built = scenario().rooms(2).config({ show, ...overrides }).build();
  return env.createCard(built.config, built.hass);
};

// ============================================ the default =======================

test("a card that asks for nothing draws every part", () => {
  const card = cardWith(undefined);
  const found = parts(card);
  for (const name of ["header", "icon", "titleBlock", "title", "subtitle", "pill", "panel", "chips"]) {
    assert.ok(found[name], `${name} is drawn without being asked for`);
  }
  assert.equal(found.nothing, null, "and nothing announces itself as hidden");
  assert.equal(found.root.getAttribute("data-parts"), null, "the ordinary card carries no data-parts attribute");
  assert.equal(found.root.getAttribute("data-title"), null, "and no title-overflow attribute");
  env.cleanup(card);
});

// ============================================ one part at a time ================

test("each part can be removed on its own, and removes nothing else", () => {
  const cases = [
    ["icon", ["icon"]],
    ["pill", ["pill"]],
    ["panel", ["panel"]],
    ["subtitle", ["subtitle"]],
  ];
  for (const [key, gone] of cases) {
    const card = cardWith({ [key]: false });
    const found = parts(card);
    for (const name of ["header", "icon", "titleBlock", "title", "subtitle", "pill", "panel", "chips"]) {
      const expected = !gone.includes(name);
      assert.equal(Boolean(found[name]), expected, `show.${key}: false — ${name} should ${expected ? "stay" : "go"}`);
    }
    env.cleanup(card);
  }
});

test("hiding the title leaves the block that carries the line under it", () => {
  const card = cardWith({ title: false });
  const found = parts(card);
  assert.equal(found.title, null);
  assert.ok(found.titleBlock, "the subtitle still needs the box that positions it");
  assert.ok(found.subtitle);
  env.cleanup(card);
});

test("hiding both header lines removes the block they shared", () => {
  const card = cardWith({ title: false, subtitle: false });
  const found = parts(card);
  assert.equal(found.titleBlock, null, "an empty box would still bring its grid column and its gap");
  assert.ok(found.icon);
  assert.ok(found.pill);
  env.cleanup(card);
});

test("the caption over the headline goes without taking the headline with it", () => {
  const card = cardWith({ entity_label: false });
  assert.equal(card.shadowRoot.querySelector(".rtc-avg-label"), null);
  assert.ok(card.shadowRoot.querySelector(".rtc-avg-value"), "the number itself is untouched");
  env.cleanup(card);
});

// ============================================ what the stylesheet is told =======

test("the header says which parts it has, and only when one is missing", () => {
  const cases = [
    [{}, null],
    [{ icon: false }, "title pill"],
    [{ pill: false }, "icon title"],
    [{ title: false, subtitle: false }, "icon pill"],
    [{ icon: false, pill: false }, "title"],
    [{ icon: false, title: false, subtitle: false }, "pill"],
    [{ pill: false, title: false, subtitle: false }, "icon"],
  ];
  for (const [show, expected] of cases) {
    const card = cardWith(show);
    assert.equal(parts(card).root.getAttribute("data-parts"), expected, JSON.stringify(show));
    env.cleanup(card);
  }
});

test("with no header part left the row itself is gone, not merely empty", () => {
  // An empty grid container is 0px tall and still contributes the root's 11px gap, so the
  // panel would sit lower than on a card that never had a header at all.
  const card = cardWith({ icon: false, title: false, subtitle: false, pill: false });
  const found = parts(card);
  assert.equal(found.header, null);
  assert.ok(found.panel, "and everything below simply moves up");
  assert.ok(found.chips);
  env.cleanup(card);
});

// ============================================ the two header lines ==============

test("the title clips only when asked, and says so on the root", () => {
  const wrapping = cardWith(undefined, { title: "A very long name for one card" });
  assert.equal(parts(wrapping).root.getAttribute("data-title"), null, "wrapping is what the title has always done");
  env.cleanup(wrapping);

  const clipping = cardWith(undefined, { title: { text: "A very long name for one card", overflow: "clip" } });
  assert.equal(parts(clipping).root.getAttribute("data-title"), "clip");
  assert.equal(parts(clipping).title.textContent, "A very long name for one card");
  env.cleanup(clipping);
});

test("emptying a line and hiding it produce the same absent node", () => {
  const emptied = cardWith(undefined, { title: "" });
  const hidden = cardWith({ title: false });
  assert.equal(parts(emptied).title, null);
  assert.equal(parts(hidden).title, null);
  env.cleanup(emptied);
  env.cleanup(hidden);
});

// ============================================ nothing left ======================

test("a card with every part hidden says so instead of showing nothing", () => {
  const card = cardWith({ icon: false, title: false, subtitle: false, pill: false, panel: false, rooms: false });
  const found = parts(card);
  assert.equal(found.header, null);
  assert.equal(found.panel, null);
  assert.equal(found.chips, null);
  assert.ok(found.nothing, "an empty card is indistinguishable from a broken one");
  assert.match(found.nothing.textContent, /show/, "and the message names the switch that did it");
  env.cleanup(card);
});

test("the bar across the top does not count as something to show", () => {
  // The 3px accent line is not "something shown".
  const card = cardWith({ icon: false, title: false, subtitle: false, pill: false, panel: false, rooms: false });
  assert.ok(card.shadowRoot.querySelector(".rtc-top-line"), "the line itself is still drawn");
  assert.ok(parts(card).nothing);
  env.cleanup(card);
});

test("one part left is enough, and the hint stays away", () => {
  for (const show of [{ panel: false, rooms: false, icon: false, subtitle: false, pill: false }, { icon: false, title: false, subtitle: false, pill: false, panel: false }]) {
    const card = cardWith(show);
    assert.equal(parts(card).nothing, null, JSON.stringify(show));
    env.cleanup(card);
  }
});

// ============================================ the no-data state =================

test("the explanation outranks a hidden subtitle, because it is the one fact left to give", () => {
  const built = buildScenario({
    metric: "temperature",
    primary: { state: "unavailable" },
    rooms: [],
    config: { show: { subtitle: false } },
  });
  const card = env.createCard(built.config, built.hass);
  const found = parts(card);
  assert.equal(found.root.getAttribute("data-state"), "no-data");
  assert.ok(found.subtitle, "a card showing -- with no reason given would withhold what its reader needs");
  assert.ok(found.subtitle.textContent.length > 0);
  env.cleanup(card);

  // And when there IS data, the same configuration draws no subtitle at all.
  const withData = cardWith({ subtitle: false });
  assert.equal(parts(withData).subtitle, null, "the exception is the explanation, not the switch");
  env.cleanup(withData);
});

// ============================================ the render path ===================

test("toggling a part forces a rebuild rather than a patch", () => {
  // A patch cannot create or delete a node, so every part must appear in the structure signature.
  const built = scenario().rooms(2).build();
  const card = env.createCard(built.config, built.hass);
  assert.ok(parts(card).pill);

  card.setConfig({ ...built.config, show: { pill: false } });
  card.hass = built.hass;
  assert.equal(parts(card).pill, null, "the pill is gone after the reconfiguration");
  assert.ok(parts(card).panel, "and the rest of the card came back with it");
  env.cleanup(card);
});

test("a card with no panel arms no rotation timer", () => {
  // The carousel lives inside the panel; no panel, no track, so no timer.
  const built = scenario().rooms(3).config({ show: { panel: false }, auto_slide: true }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(card.shadowRoot.querySelector(".rtc-track"), null);
  assert.equal(card.shadowRoot.querySelector(".rtc-rotator"), null);
  assert.doesNotThrow(() => card._startRotation(), "starting the rotation on a panel-less card is a no-op");
  env.cleanup(card);
});

test("hiding a part changes what is drawn and nothing that is measured", () => {
  // A hidden part is a layout decision; every room still feeds extrema, comfort count and spread.
  const built = scenario().rooms(3).build();
  const shown = env.createCard(built.config, built.hass);
  const full = shown._computeViewModel();
  env.cleanup(shown);

  const hiddenBuilt = scenario().rooms(3).config({ show: { panel: false, pill: false, icon: false } }).build();
  const hidden = env.createCard(hiddenBuilt.config, hiddenBuilt.hass);
  const reduced = hidden._computeViewModel();
  assert.deepEqual(reduced.comfort, full.comfort);
  assert.deepEqual(reduced.spread, full.spread);
  assert.deepEqual(
    reduced.roomMarkers.map((marker) => marker.value),
    full.roomMarkers.map((marker) => marker.value)
  );
  assert.equal(reduced.average.value, full.average.value);
  env.cleanup(hidden);
});

test("no data and no panel still leaves the card able to explain itself", () => {
  // Hiding the panel in the no-data state must not take the explanation (the subtitle) with it.
  const built = buildScenario({
    metric: "temperature",
    primary: { state: "unavailable" },
    rooms: [],
    config: { show: { panel: false, rooms: false } },
  });
  const card = env.createCard(built.config, built.hass);
  const found = parts(card);
  assert.equal(found.root.getAttribute("data-state"), "no-data");
  assert.equal(found.panel, null);
  assert.ok(found.subtitle, "the reason survives the hidden panel");
  assert.equal(found.nothing, null, "and the card is not reported as empty, because it is not");
  assert.ok(card.shadowRoot.querySelector('[tabindex="-1"]'), "the last-resort focus target is still there");

  // A second update must not trip over the missing nodes.
  assert.doesNotThrow(() => {
    card.hass = built.hass;
  });
  env.cleanup(card);
});

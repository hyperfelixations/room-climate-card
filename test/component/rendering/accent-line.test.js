"use strict";

// The accent line is a 3px bar on the configured edge of the card. `accent_line` selects
// top or bottom and is patchable; top is the markup-stable default. `show.accent_line`
// independently removes the element, which is structural because a patch cannot create or
// delete that node. Invalid values keep the top edge and produce one diagnostic.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { scenario } = require("../../fixtures/scenario.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

const topLineOf = (card) => card.shadowRoot.querySelector(".rtc-top-line");

test("the line is there when nobody says otherwise", () => {
  const built = scenario().rooms(2).build();
  const card = env.createCard(built.config, built.hass);
  assert.ok(topLineOf(card), "the default card carries the accent line");
  // First child of the content root: a line that drifted below the header would still match the querySelector.
  assert.equal(card.shadowRoot.querySelector(".rtc-root").firstElementChild.className, "rtc-top-line");
  assert.equal(card._config.accent_line, "top");
  assert.equal(card.shadowRoot.querySelector(".rtc-root").hasAttribute("data-accent-line"), false);
  env.cleanup(card);
});

test("show.accent_line: false removes the node instead of hiding it", () => {
  const built = scenario().rooms(2).config({ show: { accent_line: false } }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(topLineOf(card), null, "the line is gone");
  // Nothing takes its place: the header is now the first child of the content root.
  assert.equal(card.shadowRoot.querySelector(".rtc-root").firstElementChild.className, "rtc-header");
  env.cleanup(card);
});

test("the no-data card follows visibility and position", () => {
  // One shell renders both states; the no-data card must follow the same option.
  // No usable value anywhere: the configured rooms exist, their entities do not.
  const built = scenario().rooms(2).config({ show: { accent_line: false } }).build();
  const card = env.createCard(built.config, { ...built.hass, states: {} });
  assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "no-data");
  assert.equal(topLineOf(card), null);
  env.cleanup(card);

  const bottom = scenario().rooms(2).config({ accent_line: "bottom" }).build();
  const bottomCard = env.createCard(bottom.config, { ...bottom.hass, states: {} });
  assert.ok(topLineOf(bottomCard));
  assert.equal(bottomCard.shadowRoot.querySelector(".rtc-root").getAttribute("data-accent-line"), "bottom");
  env.cleanup(bottomCard);
});

test("anything that is not a boolean leaves the line alone", () => {
  for (const value of ["false", "no", 0, null, undefined, {}]) {
    const built = scenario().rooms(2).config({ show: { accent_line: value } }).build();
    const card = env.createCard(built.config, built.hass);
    // Both halves at once: what the normalizer decided and what the card drew.
    assert.equal(card._config.show.accent_line, true, `show.accent_line: ${JSON.stringify(value)} falls back to the default`);
    assert.ok(topLineOf(card), `show.accent_line: ${JSON.stringify(value)} must keep the default`);
    env.cleanup(card);
  }

  const off = scenario().rooms(2).config({ show: { accent_line: false } }).build();
  const card = env.createCard(off.config, off.hass);
  assert.equal(card._config.show.accent_line, false, "only a literal false turns it off");
  env.cleanup(card);
});

test("accent_line accepts top or bottom and diagnoses any other value", () => {
  const built = scenario().rooms(2).config({ accent_line: "bottom" }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(card._config.accent_line, "bottom");
  assert.ok(topLineOf(card), "and the line is drawn");
  assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-accent-line"), "bottom");
  env.cleanup(card);

  const invalid = scenario().rooms(2).config({ accent_line: false }).build();
  const invalidCard = env.createCard(invalid.config, invalid.hass);
  assert.equal(invalidCard._config.accent_line, "top");
  assert.equal(invalidCard._config._configDiagnostics.length, 1);
  assert.equal(invalidCard._config._configDiagnostics[0].path, "accent_line");
  assert.equal(invalidCard.shadowRoot.querySelector(".rtc-root").hasAttribute("data-accent-line"), false);
  env.cleanup(invalidCard);
});

test("show.accent_line: false dominates a configured bottom edge", () => {
  const built = scenario().rooms(2).config({ accent_line: "bottom", show: { accent_line: false } }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(card._config.accent_line, "bottom");
  assert.equal(topLineOf(card), null);
  env.cleanup(card);
});

test("changing only the edge patches the same root and line nodes", () => {
  const top = scenario().rooms(2).build();
  const card = env.createCard(top.config, top.hass);
  const root = card.shadowRoot.querySelector(".rtc-root");
  const line = topLineOf(card);

  card.setConfig(scenario().rooms(2).config({ accent_line: "bottom" }).build().config);
  assert.equal(card.shadowRoot.querySelector(".rtc-root"), root);
  assert.equal(topLineOf(card), line);
  assert.equal(root.getAttribute("data-accent-line"), "bottom");

  card.setConfig(scenario().rooms(2).config({ accent_line: "top" }).build().config);
  assert.equal(card.shadowRoot.querySelector(".rtc-root"), root);
  assert.equal(topLineOf(card), line);
  assert.equal(root.hasAttribute("data-accent-line"), false);
  env.cleanup(card);
});

test("toggling the option rebuilds the markup rather than patching it", () => {
  // The structural-config signature must include the option; otherwise setConfig() takes the patch path, which cannot create or delete the node.
  const withLine = scenario().rooms(2).build();
  const card = env.createCard(withLine.config, withLine.hass);
  assert.ok(topLineOf(card));

  card.setConfig(scenario().rooms(2).config({ show: { accent_line: false } }).build().config);
  assert.equal(topLineOf(card), null, "the line went away when the option turned it off");

  card.setConfig(scenario().rooms(2).build().config);
  assert.ok(topLineOf(card), "and came back when it turned on again");
  env.cleanup(card);
});

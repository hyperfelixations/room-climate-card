"use strict";

// The accent line across the top of the card, and the one option that removes it.
// `.rtc-top-line` is a 3px bar fading from the tone colour to transparent along the top
// edge of `.rtc-root` — the card's default appearance. `show.accent_line: false` removes
// the element rather than hiding it (like `subtitle: ""`), which makes the option
// structural: toggling it forces a full rebuild, since a patch cannot create or delete a
// node. The switch is strict — `true`/`false` only, otherwise the default plus a diagnostic.

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

test("the no-data card follows the same option", () => {
  // One shell renders both states; the no-data card must follow the same option.
  // No usable value anywhere: the configured rooms exist, their entities do not.
  const built = scenario().rooms(2).config({ show: { accent_line: false } }).build();
  const card = env.createCard(built.config, { ...built.hass, states: {} });
  assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "no-data");
  assert.equal(topLineOf(card), null);
  env.cleanup(card);
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

test("the top-level accent_line is not a key of this card", () => {
  // The old top-level spelling was never released; a card still carrying it gets the default, like any unrecognized top-level key.
  const built = scenario().rooms(2).config({ accent_line: false }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(card._config.show.accent_line, true, "the old spelling decides nothing");
  assert.ok(topLineOf(card), "and the line is drawn");
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

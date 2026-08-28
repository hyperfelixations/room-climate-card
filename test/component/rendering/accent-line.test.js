"use strict";

// THE LINE ACROSS THE TOP OF THE CARD, and the one option that removes it.
//
// `.rtc-top-line` is a 3px bar fading from the tone colour to transparent along the top edge
// of `.rtc-root`. It is the card's default appearance and stays exactly that: the tests below
// pin the DEFAULT first, because the whole point of the option is that nobody who does not ask
// for it sees any change at all.
//
// A NODE, NOT A STYLE. `accent_line: false` removes the element rather than hiding it, for the
// same reason `subtitle: ""` removes the subtitle: an element with `display:none` is still an
// element, and "the card ends at its top edge the way it ends at its bottom edge" is a
// statement about what is there. That makes the option STRUCTURAL — a patch can change text
// and colours, it cannot create or delete a node — which is why toggling it has to force a
// full rebuild, and why the last test here is about the render path rather than the markup.
//
// The tolerant reading (`accent_line: "yes"` is not false, so the line stays) is the same
// convention `auto_slide` and `swipe` already use: a cosmetic option with a typo in it falls
// back to the default rather than breaking the card.

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
  // It is the FIRST child of the content root: the line sits on the top edge, and the header
  // follows it. A line that had drifted below the header would still answer the query above.
  assert.equal(card.shadowRoot.querySelector(".rtc-root").firstElementChild.className, "rtc-top-line");
  env.cleanup(card);
});

test("accent_line: false removes the node instead of hiding it", () => {
  const built = scenario().rooms(2).config({ accent_line: false }).build();
  const card = env.createCard(built.config, built.hass);
  assert.equal(topLineOf(card), null, "the line is gone");
  // Nothing takes its place. The card ends at its top edge the way it ends at its bottom one,
  // so the header must be the first thing inside the content root.
  assert.equal(card.shadowRoot.querySelector(".rtc-root").firstElementChild.className, "rtc-header");
  env.cleanup(card);
});

test("the no-data card follows the same option", () => {
  // One shell renders both states, so this would only fail if the option were read in a
  // branch — but the no-data card is the one a user meets when something is wrong, and it
  // looking different from the card beside it is exactly the kind of inconsistency nobody
  // reports and everybody notices.
  // No usable value anywhere: the configured rooms exist, their entities do not.
  const built = scenario().rooms(2).config({ accent_line: false }).build();
  const card = env.createCard(built.config, { ...built.hass, states: {} });
  assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "no-data");
  assert.equal(topLineOf(card), null);
  env.cleanup(card);
});

test("anything that is not false leaves the line alone", () => {
  for (const value of [true, "false", "no", 0, null, undefined, {}]) {
    const built = scenario().rooms(2).config({ accent_line: value }).build();
    const card = env.createCard(built.config, built.hass);
    // Both halves of the contract in one place: what the normalizer decided, and what the
    // card actually drew. A normalizer that said `true` while the shell drew nothing would
    // pass either assertion on its own.
    assert.equal(card._config.show.accent_line, true, `accent_line: ${JSON.stringify(value)} normalizes to the default`);
    assert.ok(topLineOf(card), `accent_line: ${JSON.stringify(value)} must keep the default`);
    env.cleanup(card);
  }

  const off = scenario().rooms(2).config({ accent_line: false }).build();
  const card = env.createCard(off.config, off.hass);
  assert.equal(card._config.show.accent_line, false, "only a literal false turns it off");
  env.cleanup(card);
});

test("toggling the option rebuilds the markup rather than patching it", () => {
  // The structural-config signature is what stands between a config change and a rebuild.
  // Without the option in it, setConfig() would take the patch path, and the patch path
  // cannot create or delete a node — the line would simply stay whatever it was.
  const withLine = scenario().rooms(2).build();
  const card = env.createCard(withLine.config, withLine.hass);
  assert.ok(topLineOf(card));

  card.setConfig(scenario().rooms(2).config({ accent_line: false }).build().config);
  assert.equal(topLineOf(card), null, "the line went away when the option turned it off");

  card.setConfig(scenario().rooms(2).build().config);
  assert.ok(topLineOf(card), "and came back when it turned on again");
  env.cleanup(card);
});

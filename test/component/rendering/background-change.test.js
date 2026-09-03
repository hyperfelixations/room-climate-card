"use strict";

// The card re-reads its background when the ground under it changes. Split from
// background-reading.test.js: that file asks what the card reads, this one asks when it
// asks again. The defect pinned here: switching a dashboard light→dark changes no entity
// and no config, so nothing called the render path and the card kept the old palette.
// jsdom paints nothing, so readBackgroundSamples is stubbed with a value the test controls;
// everything else is real. The live reading is covered in
// test/browser/visual/palette-fit-calibration.spec.js.

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

// The watch coalesces into a frame, so poll for the condition rather than sleep a fixed time.
async function settle(predicate, what) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
}

function cardOnBackground(samples) {
  const built = scenario().rooms(2).config({ palette: "white" }).build();
  const card = env.createCard(built.config, built.hass);
  // Stubbed on the instance, so the adapter and other cards are untouched.
  let current = samples;
  card._platform.readBackgroundSamples = () => [...current];
  card._surfaceCacheKey = undefined;
  return { card, repaint: (next) => (current = next) };
}

const toneColorOf = (card) => card.shadowRoot.querySelector(".rtc-root").getAttribute("style").match(/--tone-color:([^;]+)/)[1];

test("a theme switch repaints the palette without any state or config arriving", async () => {
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const onLight = toneColorOf(card);

  // What a dashboard does: repaint the ground, write the theme on the root element. No hass, no setConfig.
  repaint(["#1C1C1C"]);
  card.ownerDocument.documentElement.setAttribute("data-theme", "dark");

  await settle(() => toneColorOf(card) !== onLight, "the card to follow its new background");
  assert.notEqual(toneColorOf(card), onLight, "`palette: white` is adapted for white and left alone on black");
  card.ownerDocument.documentElement.removeAttribute("data-theme");
  env.cleanup(card);
});

test("an attribute that changed nothing about the background costs a comparison, not a render", async () => {
  const { card } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const before = card._renderController.lastViewModel;
  assert.ok(before, "there is a view model to compare against");

  // Root attributes change for many reasons; the data signature decides, and an unchanged
  // background skips the render, leaving the committed view model untouched.
  card.ownerDocument.documentElement.setAttribute("lang", "de");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(card._renderController.lastViewModel, before, "nothing was rebuilt");

  card.ownerDocument.documentElement.removeAttribute("lang");
  env.cleanup(card);
});

test("a card-mod rule on this one card is a reason to look again", async () => {
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const onLight = toneColorOf(card);

  // card-mod colours a single card by writing on the element itself. Nothing about the
  // document changes, so the root observer would never see it.
  repaint(["#0A2A4F"]);
  card.setAttribute("style", "background:#0A2A4F");

  await settle(() => toneColorOf(card) !== onLight, "the card to follow a rule aimed at it alone");
  env.cleanup(card);
});

test("a disconnected card stops listening", async () => {
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const before = card._renderController.lastViewModel;

  card.remove();
  repaint(["#1C1C1C"]);
  card.ownerDocument.documentElement.setAttribute("data-theme", "dark");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(card._renderController.lastViewModel, before, "a card that left the document renders nothing");

  card.ownerDocument.documentElement.removeAttribute("data-theme");
  env.cleanup(card);
});

test("coming back into the document is itself a reason to look", async () => {
  // HA does not re-send hass on reconnect, so without re-reading on connect the card keeps the old dashboard colours.
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const onLight = toneColorOf(card);

  const parent = card.parentNode;
  card.remove();
  repaint(["#1C1C1C"]);
  parent.appendChild(card);

  await settle(() => toneColorOf(card) !== onLight, "the reconnected card to look at where it now stands");
  env.cleanup(card);
});

test("no timer is left behind by any of it", async () => {
  // The mechanism is event-driven; a poll would pass every assertion above and still be wrong at scale.
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const onLight = toneColorOf(card);
  repaint(["#1C1C1C"]);
  card.ownerDocument.documentElement.setAttribute("data-theme", "dark");
  // Wait for the repaint to have happened, not just be scheduled — an in-flight frame would look like a poll.
  await settle(() => toneColorOf(card) !== onLight, "the repaint to land");

  const before = toneColorOf(card);
  // Nothing changes the background now; a poll would keep calling readBackgroundSamples.
  let reads = 0;
  const previous = card._platform.readBackgroundSamples;
  card._platform.readBackgroundSamples = () => {
    reads += 1;
    return previous();
  };
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(reads, 0, `the card read its background ${reads} times while nothing happened`);
  assert.equal(toneColorOf(card), before);

  card.ownerDocument.documentElement.removeAttribute("data-theme");
  env.cleanup(card);
});

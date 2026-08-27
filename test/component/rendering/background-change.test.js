"use strict";

// THE CARD NOTICES WHEN THE GROUND UNDER IT CHANGES.
//
// Split from background-reading.test.js on purpose: that file asks WHAT the card reads, this
// one asks WHEN it asks again. They fail for different reasons and a single file would make
// either failure ambiguous.
//
// The defect this pins down: switching a dashboard from light to dark changes no entity and
// no configuration, so nothing called the render path, so the card kept the palette of a
// background it was no longer on. Removing `palette: white` and typing it again brought the
// adaptation back — which is what made it obvious that the reading was right and only the
// occasion was missing.
//
// WHAT IS STUBBED, AND WHY ONLY THAT. jsdom paints nothing and its getComputedStyle reports
// no background at all, so the platform's reading is replaced with a value the test controls.
// Everything else is the real thing: the real element, the real watch, the real data
// signature, the real palette adaptation. The live reading itself is covered where a real
// CSSOM exists, in test/browser/visual/palette-fit-calibration.spec.js.

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

// The watch coalesces into an animation frame, so the answer is one frame away rather than
// synchronous. Polling for the condition rather than sleeping a fixed time: a fixed sleep is
// either too short on a loaded machine or wasted on every run.
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
  // The one thing jsdom cannot do. Replaced on the instance, so the adapter itself is
  // untouched and every other card in this file is unaffected.
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

  // Exactly what a dashboard does and nothing else: the ground is repainted, and the theme
  // says so by writing on the root element. No hass, no setConfig.
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

  // The root element's attributes change for all sorts of reasons a card has no interest in.
  // The watch cannot tell them apart — it is the data signature that decides, and an
  // unchanged background produces an unchanged signature and therefore a skipped render.
  // A skipped render leaves the committed view model untouched, which is the exact signal.
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
  // A card can be moved between dashboards, and Home Assistant does not re-send hass for a
  // reconnect. Without asking on connect, the card would show the colours of the dashboard it
  // came from until something unrelated happened along.
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
  // The promise this whole mechanism makes is that it is event-driven. A card that polled
  // would be indistinguishable in every assertion above and wrong in the only way that
  // matters on a dashboard with thirty cards on it.
  const { card, repaint } = cardOnBackground(["#FFFFFF"]);
  card._render(false);
  const onLight = toneColorOf(card);
  repaint(["#1C1C1C"]);
  card.ownerDocument.documentElement.setAttribute("data-theme", "dark");
  // Wait for the repaint to have HAPPENED, not merely to have been scheduled: a frame still
  // in flight would read the background after the counter goes in and look like a poll.
  await settle(() => toneColorOf(card) !== onLight, "the repaint to land");

  const before = toneColorOf(card);
  // Nothing changes the background now. If anything were polling, the card would keep asking
  // — and the surface reading is the one thing a poll would have to call.
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

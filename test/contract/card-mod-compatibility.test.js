"use strict";

// The promise the card makes to card-mod, the frontend module dashboards use to restyle cards:
// the configuration card-mod reads is the one written in YAML, and a stylesheet card-mod puts
// into the card — into its shadow root, or into its ha-card — outlives every render the card
// performs. Driven through the built bundle in jsdom with card-mod's mechanics from
// helpers/card-mod-double.js; the real card-mod bundle runs in the browser spec of the same name.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { cardModConfigOf, findConfigLikeCardMod, attachCardMod } = require("../helpers/card-mod-double.js");
const { TEMPERATURE_C } = require("../fixtures/attributes.js");

let env;
test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  if (env) env.cleanupAll();
});

const CONFIG = Object.freeze({
  type: "custom:room-climate-card",
  entity: "sensor.avg",
  rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
  card_mod: { style: "ha-card { background: #0A2A4F; }" },
});

const states = () => ({
  "sensor.avg": mkState("sensor.avg", 21.5, TEMPERATURE_C),
  "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
  "sensor.r2": mkState("sensor.r2", 22, TEMPERATURE_C),
});

const surfaceOf = (card) => card.shadowRoot.querySelector("ha-card");
const cardModsIn = (card) => [
  ...Array.from(card.shadowRoot.children).filter((node) => node.localName === "card-mod"),
  ...Array.from(surfaceOf(card)?.children ?? []).filter((node) => node.localName === "card-mod"),
];

// ------------------------------------------------------------------ the configuration --

test("the card exposes the configuration exactly as it was written", () => {
  const card = env.document.createElement("room-climate-card");
  assert.equal(card.config, null, "nothing is written before setConfig()");
  env.document.body.appendChild(card);
  card.hass = mkHass(states());
  card.setConfig(CONFIG);

  assert.equal(card.config, CONFIG, "the same object, including type and card_mod");
  assert.equal(cardModConfigOf(card), CONFIG, "what card-mod reads for a card inside hui-card");
  assert.equal(findConfigLikeCardMod(surfaceOf(card)), CONFIG, "and for a card outside hui-card, starting at its ha-card");
  assert.equal(card._config.card_mod, undefined, "the normalized configuration stays the card's own");
  env.cleanup(card);
});

test("a refused configuration leaves the written one in place", () => {
  env.withCard(CONFIG, mkHass(states()), (card) => {
    assert.throws(() => card.setConfig({ ...CONFIG, entity: 42, rooms: [] }));
    assert.equal(card.config, CONFIG);

    const next = { ...CONFIG, card_mod: { style: ":host { --rtc-radius: 8px; }" } };
    card.setConfig(next);
    assert.equal(card.config, next, "an accepted one replaces it");
  });
});

test("the written configuration is read-only", () => {
  const descriptor = Object.getOwnPropertyDescriptor(env.window.customElements.get("room-climate-card").prototype, "config");
  assert.equal(typeof descriptor.get, "function");
  assert.equal(descriptor.set, undefined, "Home Assistant hands a card its configuration through setConfig() only");
});

test("the card declares none of the fields card-mod keeps on the element", () => {
  // card-mod stores its elements in `_cardMod` and reads `modElement` to pick a target; a
  // member of that name on the card would change where card-mod puts its styles.
  env.withCard(CONFIG, mkHass(states()), (card) => {
    assert.equal("_cardMod" in card, false);
    assert.equal("modElement" in card, false);
  });
});

// ------------------------------------------------------------------ the stylesheet --

test("a stylesheet in the shadow root outlives every kind of full render", () => {
  env.withCard(CONFIG, mkHass(states()), (card) => {
    const surface = surfaceOf(card);
    const cardMod = attachCardMod(card.shadowRoot, CONFIG.card_mod.style);

    card.setConfig({ ...CONFIG, views: [{ type: "scale" }] });
    assert.equal(card.shadowRoot.lastChild, cardMod.element, "a structural configuration change");

    card.hass = mkHass({});
    assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "no-data");
    card.hass = mkHass(states());
    assert.equal(card.shadowRoot.querySelector(".rtc-root").getAttribute("data-state"), "data");
    assert.equal(card.shadowRoot.lastChild, cardMod.element, "data -> no-data -> data");

    assert.equal(surfaceOf(card), surface, "the ha-card card-mod may have styled is the same element throughout");
    assert.deepEqual(cardModsIn(card), [cardMod.element], "exactly the one card-mod element, nothing duplicated");
  });
});

test("a stylesheet inside ha-card outlives a full render too", () => {
  // Where card-mod puts it for a card that is not a direct child of hui-card.
  env.withCard(CONFIG, mkHass(states()), (card) => {
    const cardMod = attachCardMod(surfaceOf(card), CONFIG.card_mod.style);
    card.setConfig({ ...CONFIG, views: [{ type: "extremes" }, { type: "scale" }] });
    card.hass = mkHass({});
    assert.equal(cardMod.element.parentNode, surfaceOf(card));
    assert.equal(surfaceOf(card).lastChild, cardMod.element, "the card's body stays in front of it");
    assert.equal(surfaceOf(card).querySelectorAll(".rtc-root").length, 1);
  });
});

test("the failure message keeps the stylesheet, and so does the plain-text last resort", () => {
  env.withCard(CONFIG, mkHass(states()), (card) => {
    const cardMod = attachCardMod(card.shadowRoot, CONFIG.card_mod.style);
    const originalConsoleError = env.window.console.error;
    env.window.console.error = () => {};
    try {
      const compute = card._computeViewModel;
      card._computeViewModel = () => {
        throw new Error("induced render failure");
      };
      card._renderSafely(false);
      assert.ok(card.shadowRoot.querySelector(".rtc-render-failed"));
      assert.equal(card.shadowRoot.lastChild, cardMod.element);

      const styles = card._styles;
      card._styles = () => {
        throw new Error("induced stylesheet failure");
      };
      card._renderSafely(false);
      assert.equal(card.shadowRoot.querySelector("ha-card"), null, "nothing but the message is left of the card");
      assert.match(card.shadowRoot.textContent, /could not be drawn/);
      assert.equal(card.shadowRoot.lastChild, cardMod.element);

      card._styles = styles;
      card._computeViewModel = compute;
      card._renderSafely(false);
      assert.ok(card.shadowRoot.querySelector(".rtc-root[data-state='data']"), "the card recovers");
      assert.equal(card.shadowRoot.lastChild, cardMod.element);
      assert.deepEqual(cardModsIn(card), [cardMod.element]);
    } finally {
      env.window.console.error = originalConsoleError;
    }
  });
});

// ------------------------------------------------------------------ the pinned module --

test("the installed card-mod is the release the browser contract was written against", () => {
  // package.json pins the v4.2.1 commit; the digest also catches a modified install.
  const bundle = fs.readFileSync(path.join(__dirname, "..", "..", "node_modules", "card-mod", "card-mod.js"));
  assert.equal(crypto.createHash("sha256").update(bundle).digest("hex"), "5e7e71ad61796f59070f8c4621e69fa8e71a9864d0be0922bc4dbc72f990cd35");
});

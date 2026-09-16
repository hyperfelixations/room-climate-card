"use strict";

// The card under the real card-mod 4.2.1 bundle (devDependency pinned to the release commit;
// contract/card-mod-compatibility.test.js checks its digest). Home Assistant is reduced to
// what card-mod reaches for: a <home-assistant> element carrying hass with themes, and a
// <hui-card> whose _loadElement/_updateElement mirror frontend src/panels/lovelace/cards/hui-card.ts,
// which card-mod patches. Asserted through computed styles, because what matters is whether
// the rule a dashboard writes paints the card, and keeps painting it after the card re-renders.

const { test, expect } = require("../../helpers/playwright.js");
const { gotoHarness, mkStateObj } = require("../../helpers/browser-helpers");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

const NAVY = "rgb(10, 42, 79)";

function statesWithData() {
  return {
    "sensor.avg": mkStateObj("sensor.avg", 21.5, TEMPERATURE_C),
    "sensor.r1": mkStateObj("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkStateObj("sensor.r2", 22, TEMPERATURE_C),
  };
}

const BASE = {
  type: "custom:room-climate-card",
  entity: "sensor.avg",
  rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }],
  auto_slide: false,
};

// The harness, the Home Assistant surroundings card-mod needs, then card-mod itself.
async function setUp(page, { themes = {}, cardModTheme = null } = {}) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await gotoHarness(page);
  await page.evaluate(({ themes, cardModTheme }) => {
    if (cardModTheme) document.documentElement.style.setProperty("--card-mod-theme", cardModTheme);
    window.__hass = {
      language: "en",
      locale: { language: "en" },
      states: {},
      user: { name: "test" },
      themes: { themes: { default: {}, ...themes }, theme: cardModTheme || "default", darkMode: false },
      connection: { subscribeEvents: async () => () => {}, subscribeMessage: async () => () => {} },
      callService: async () => {},
    };
    customElements.define("home-assistant", class extends HTMLElement {});
    const homeAssistant = document.createElement("home-assistant");
    homeAssistant.hass = window.__hass;
    document.body.appendChild(homeAssistant);

    customElements.define(
      "hui-card",
      class extends HTMLElement {
        load() {
          this._loadElement(this.config);
        }
        _loadElement(config) {
          const element = document.createElement(config.type.replace("custom:", ""));
          element.setConfig(config);
          this._element = element;
          if (this.hass) element.hass = this.hass;
          while (this.lastChild) this.removeChild(this.lastChild);
          this.appendChild(element);
        }
        _updateElement(config) {
          this._element.setConfig(config);
        }
      }
    );
  }, { themes, cardModTheme });
  await page.addScriptTag({ url: "/node_modules/card-mod/card-mod.js", type: "module" });
  await page.waitForFunction(() => Boolean(customElements.get("card-mod")));
  return errors;
}

// A card the way a dashboard creates one: inside hui-card, which card-mod patches.
async function cardInHuiCard(page, config, states) {
  await page.evaluate(({ config, states }) => {
    const huiCard = document.createElement("hui-card");
    huiCard.hass = { ...window.__hass, states };
    huiCard.config = config;
    huiCard.style.width = "400px";
    huiCard.style.display = "block";
    document.getElementById("stage").appendChild(huiCard);
    huiCard.load();
    window.__huiCard = huiCard;
    window.__card = huiCard.firstElementChild;
  }, { config, states });
}

const surfaceStyle = (page, property) =>
  page.evaluate((property) => getComputedStyle(window.__card.shadowRoot.querySelector("ha-card"))[property], property);

const cardModCount = (page) =>
  page.evaluate(() => {
    const root = window.__card.shadowRoot;
    return root.querySelectorAll("card-mod").length;
  });

const setHass = (page, states) => page.evaluate((states) => (window.__card.hass = { ...window.__hass, states }), states);

test("a card_mod rule on ha-card paints the card", async ({ page }) => {
  const errors = await setUp(page);
  await cardInHuiCard(page, { ...BASE, card_mod: { style: `ha-card { background: ${NAVY}; border: none; }` } }, statesWithData());

  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe(NAVY);
  expect(await surfaceStyle(page, "backgroundImage")).toBe("none");
  expect(await surfaceStyle(page, "borderTopWidth")).toBe("0px");
  expect(await page.evaluate(() => window.__card.classList.contains("type-custom-room-climate-card"))).toBe(true);
  expect(errors).toEqual([]);
});

test("the rule keeps painting the card through every kind of full render", async ({ page }) => {
  const errors = await setUp(page);
  const config = { ...BASE, card_mod: { style: `ha-card { background: ${NAVY}; }` } };
  await cardInHuiCard(page, config, statesWithData());
  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe(NAVY);

  // A configuration edit Home Assistant hands to the same element: a different view list.
  await page.evaluate((config) => window.__huiCard._updateElement({ ...config, views: [{ type: "scale" }] }), config);
  expect(await page.evaluate(() => window.__card.shadowRoot.querySelectorAll(".rtc-view, .rtc-rotator-solo").length)).toBeGreaterThan(0);
  expect(await surfaceStyle(page, "backgroundColor")).toBe(NAVY);

  // Every sensor gone, and back.
  await setHass(page, {});
  expect(await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-root").dataset.state)).toBe("no-data");
  expect(await surfaceStyle(page, "backgroundColor")).toBe(NAVY);
  await setHass(page, statesWithData());
  expect(await page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-root").dataset.state)).toBe("data");
  expect(await surfaceStyle(page, "backgroundColor")).toBe(NAVY);

  // Give card-mod every chance to re-attach itself; there must still be exactly one.
  await page.waitForTimeout(200);
  expect(await cardModCount(page)).toBe(1);
  expect(errors).toEqual([]);
});

test("a rule on :host reaches the card's own design tokens", async ({ page }) => {
  await setUp(page);
  await cardInHuiCard(page, { ...BASE, card_mod: { style: ":host { --rtc-radius: 4px; }" } }, statesWithData());
  await expect.poll(() => surfaceStyle(page, "borderTopLeftRadius")).toBe("4px");
});

test("a card-mod theme styles the card like a rule in its own configuration", async ({ page }) => {
  await setUp(page, { cardModTheme: "navy", themes: { navy: { "card-mod-card": `ha-card { background: ${NAVY}; }` } } });
  await cardInHuiCard(page, BASE, statesWithData());
  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe(NAVY);
});

test("the palette follows a background card-mod repaints, with no state arriving", async ({ page }) => {
  // `palette: white` is adapted to be legible on a white card and left as it is on navy, so
  // the tone colour tells which background the card last judged itself against.
  await setUp(page);
  await cardInHuiCard(page, { ...BASE, palette: "white", card_mod: { style: "ha-card { background: #FFFFFF; }" } }, statesWithData());
  const toneColor = () => page.evaluate(() => window.__card.shadowRoot.querySelector(".rtc-root").style.getPropertyValue("--tone-color"));
  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe("rgb(255, 255, 255)");
  await page.waitForTimeout(100);
  const onWhite = await toneColor();

  // What a theme reload or a Jinja template does: card-mod rewrites the stylesheet it placed.
  await page.evaluate((navy) => {
    window.__card.shadowRoot.querySelector("card-mod").styles = `ha-card { background: ${navy}; }`;
  }, NAVY);
  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe(NAVY);
  await expect.poll(toneColor, { message: "the card judged its palette against the new background" }).not.toBe(onWhite);
});

test("a card outside hui-card is styled through its ha-card, and only once however often it re-renders", async ({ page }) => {
  // Third-party wrappers create cards without hui-card; card-mod then patches ha-card's
  // firstUpdated(). The harness ha-card is not a Lit element, so the test makes the one call
  // Lit would make after the element's first render.
  const errors = await setUp(page);
  const config = { ...BASE, card_mod: { style: `ha-card { background: ${NAVY}; }` } };
  await page.evaluate(async ({ config, states }) => {
    const wrapper = document.createElement("div");
    wrapper.style.width = "400px";
    document.getElementById("stage").appendChild(wrapper);
    const card = document.createElement("room-climate-card");
    card.setConfig(config);
    card.hass = { ...window.__hass, states };
    wrapper.appendChild(card);
    window.__card = card;
    await card.shadowRoot.querySelector("ha-card").firstUpdated();
  }, { config, states: statesWithData() });
  await expect.poll(() => surfaceStyle(page, "backgroundColor")).toBe(NAVY);

  for (const views of [[{ type: "scale" }], [{ type: "extremes" }], null]) {
    await page.evaluate(({ config, views }) => window.__card.setConfig(views ? { ...config, views } : config), { config, views });
    expect(await surfaceStyle(page, "backgroundColor")).toBe(NAVY);
  }
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__card.shadowRoot.querySelector("ha-card").querySelectorAll("card-mod").length)).toBe(1);
  expect(errors).toEqual([]);
});

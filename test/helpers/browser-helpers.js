"use strict";

// Shared helpers for the Playwright (test/browser/) layer — real Chromium,
// real layout/ResizeObserver/pointer events, unlike the jsdom unit layer.
// page.evaluate() can only cross the Node<->page boundary with serializable
// data (no functions), so `hass.callService` is created fresh inside the
// page-side callback rather than passed in.

function mkStateObj(entityId, state, attributes) {
  return {
    entity_id: entityId,
    state: String(state),
    attributes: attributes || {},
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

async function gotoHarness(page) {
  await page.goto("/test/fixtures/harness.html");
}

// Creates a <room-climate-card>, appends it to #stage, sets hass+config,
// and returns its id so the caller can locate it. `statesObj` maps
// entity_id -> {state, attributes} (plain data, see mkStateObj above).
// Awaits document.fonts.ready before resolving -- the harness now loads a
// real (self-hosted) Roboto webfont (see harness.html/fonts/roboto.css) so
// that text-metric-dependent assertions match production Home Assistant
// instead of whatever generic sans-serif Chromium substitutes; a freshly
// requested subset needs a network round-trip, so callers that measure
// text immediately after createCard() (scrollWidth/clientWidth/
// boundingBox) would otherwise risk measuring pre-webfont-swap layout.
async function createCard(page, config, statesObj, language) {
  return page.evaluate(
    async ({ config, statesObj, language }) => {
      const hass = {
        language: language || "en",
        locale: { language: language || "en" },
        states: statesObj,
        callService: () => {},
      };
      const el = document.createElement("room-climate-card");
      const id = "card-" + Math.random().toString(36).slice(2);
      el.id = id;
      el.style.display = "block";
      document.getElementById("stage").appendChild(el);
      el.hass = hass;
      el.setConfig(config);
      await document.fonts.ready;
      return id;
    },
    { config, statesObj, language }
  );
}

async function updateHass(page, cardId, statesObj, language) {
  // The card exposes `hass` as a setter only (no matching getter — see
  // `set hass(hass)` in room-climate-card.js), so `el.hass` reads back as
  // undefined; the caller must pass the language explicitly if it wants to
  // keep it, rather than reading it back off the element.
  await page.evaluate(
    ({ cardId, statesObj, language }) => {
      const el = document.getElementById(cardId);
      const lang = language || "en";
      el.hass = {
        language: lang,
        locale: { language: lang },
        states: statesObj,
        callService: () => {},
      };
    },
    { cardId, statesObj, language }
  );
}

module.exports = { mkStateObj, gotoHarness, createCard, updateHass };

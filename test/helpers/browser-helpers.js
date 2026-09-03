"use strict";

// Shared helpers for the Playwright (test/browser/) layer — real Chromium, real
// layout/ResizeObserver/pointer events. page.evaluate() only crosses the
// Node<->page boundary with serializable data, so `hass.callService` is built
// inside the page-side callback rather than passed in.

const { expect } = require("@playwright/test");

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

// Creates a <room-climate-card>, appends it to #stage, sets hass+config, returns
// its id. `statesObj` maps entity_id -> {state, attributes} (see mkStateObj).
// Awaits document.fonts.ready first: the harness self-hosts Roboto so text
// metrics match production, and the subset swap is a network round-trip a caller
// measuring text right after createCard() would otherwise race.
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
  // `hass` is a setter only, so `el.hass` reads back undefined; a caller that
  // wants to keep the language must pass it in again.
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

// Waits for the card to finish laying out by observing the mechanism, never a duration.
// Four observable conditions:
//
//   1. the card is at the width the caller asked for;
//   2. the resize runtime has no animation frame outstanding (its ResizeObserver callback
//      coalesces notifications onto one frame, so a pending frame means a re-measure is
//      queued — see resize-runtime.js);
//   3. document.fonts.ready has settled;
//   4. the subtree's box sizes match across two consecutive animation frames.
//
// Sizes, not positions: the auto-slide carousel translates the track every frame, so a
// position signature would never settle. Nothing this waits for can change a layout
// without changing some box's width or height.
async function waitForStableLayout(page, cardId, widthPx = null) {
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ cardId, widthPx }) => {
            const el = document.getElementById(cardId);
            if (!el?.shadowRoot) return false;
            if (widthPx !== null && Math.round(el.getBoundingClientRect().width) !== widthPx) return false;
            if (el._resize?.hasPendingFrame?.()) return false;
            await document.fonts.ready;

            const read = () =>
              Array.from(el.shadowRoot.querySelectorAll("*"), (node) => {
                const rect = node.getBoundingClientRect();
                return `${rect.width},${rect.height}`;
              }).join("|");

            const before = read();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            if (el._resize?.hasPendingFrame?.()) return false;
            return read() === before;
          },
          { cardId, widthPx }
        ),
      { message: `the card never settled into a stable layout${widthPx === null ? "" : ` at ${widthPx}px`}` }
    )
    .toBe(true);
}

// Sets the card's own width and returns once the resulting layout has settled. The one
// entry point for "measure this card at this width".
async function setCardWidth(page, cardId, widthPx) {
  await page.evaluate(
    ({ cardId, widthPx }) => {
      document.getElementById(cardId).style.width = `${widthPx}px`;
    },
    { cardId, widthPx }
  );
  await waitForStableLayout(page, cardId, widthPx);
}

module.exports = { mkStateObj, gotoHarness, createCard, updateHass, waitForStableLayout, setCardWidth };

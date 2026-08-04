"use strict";

// Shared helpers for the Playwright (test/browser/) layer — real Chromium,
// real layout/ResizeObserver/pointer events, unlike the jsdom unit layer.
// page.evaluate() can only cross the Node<->page boundary with serializable
// data (no functions), so `hass.callService` is created fresh inside the
// page-side callback rather than passed in.

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

// Waits until the card has finished laying itself out, by asking the mechanism rather
// than by guessing a duration.
//
// WHY NOT A TIMEOUT. Every measuring test used to sleep 120-200 ms here. That is not a
// contract, it is a bet on how busy the machine is, and the bet was lost often enough
// to matter: a full-suite run under two workers failed a label-overlap assertion that
// passed 6/6 in isolation, because the measurement was taken against the layout that was
// about to be replaced. A sleep can only ever be too short or wasteful.
//
// Four conditions, all observable, none of them a duration:
//
//   1. the card is actually at the width the caller asked for, so nothing is measured
//      against a layout that is already superseded;
//   2. the resize runtime has no animation frame outstanding — its ResizeObserver
//      callback coalesces every notification onto exactly one frame, so a pending frame
//      means a re-measurement is still queued (see resize-runtime.js);
//   3. document.fonts.ready has settled, the other thing that moves text after the fact;
//   4. the subtree's box SIZES are identical across two consecutive animation frames.
//
// Sizes, deliberately, and not positions: the auto-slide carousel translates the track
// on every frame, so a position-based signature would never settle for a multi-view
// card. Nothing that this waits for — a container query flipping, a web font swapping,
// a chip grid reflowing — can change a layout without changing some box's width or
// height.
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

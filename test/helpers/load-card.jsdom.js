"use strict";

// Runs the built artifact (dist/room-climate-card.js, the bytes Home Assistant
// loads) inside a fresh jsdom window per test file, so component, contract and
// property tests instantiate the real custom element. Every public test script
// builds first, so the artifact under test is always this checkout's src/.
//
// jsdom has no layout engine (getBoundingClientRect returns zeros, no font
// metrics) — anything depending on rendered geometry belongs in test/browser/.
//
// jsdom implements neither ResizeObserver, matchMedia nor document.fonts; the
// card degrades safely without them, and the stubs below exist so those code
// paths (bind/unbind lifecycle, reduced-motion branch, font-ready chain) get
// real coverage instead of being skipped.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const environmentCleanups = new Set();
test.afterEach(() => {
  for (const cleanup of environmentCleanups) cleanup();
});

// The one place that knows where the built artifact lives; everything else imports
// this constant rather than rebuilding the path.
const CARD_SOURCE_PATH = path.join(__dirname, "..", "..", "dist", "room-climate-card.js");
if (!fs.existsSync(CARD_SOURCE_PATH)) {
  throw new Error(
    `Missing build artifact ${CARD_SOURCE_PATH}. Run "npm run build" (it is generated from src/ and not committed).`
  );
}
const CARD_SOURCE = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
const CARD_TAG = "room-climate-card";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Creates one isolated jsdom window and loads the card script into it. Call once
// per test file (e.g. in a `before()` hook), not per test case — it is correct
// per case but pays the eval cost each time.
function createTestEnvironment() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true, // gives real requestAnimationFrame/cancelAnimationFrame
  });
  const { window } = dom;

  let reducedMotion = false;
  window.matchMedia = (query) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? reducedMotion : false;
    },
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });

  window.ResizeObserver = ResizeObserverStub;
  window.document.fonts = { ready: Promise.resolve() };
  // Guarded by try/catch in the card; stubbed so that path runs instead of
  // always hitting the catch.
  window.DOMMatrixReadOnly = class DOMMatrixReadOnly {
    constructor() {
      this.m41 = 0;
    }
  };

  const context = dom.getInternalVMContext();
  vm.runInContext(CARD_SOURCE, context, { filename: CARD_SOURCE_PATH });

  if (!window.customElements.get(CARD_TAG)) {
    throw new Error(`${CARD_SOURCE_PATH} did not register <${CARD_TAG}> in the jsdom environment`);
  }

  const liveCards = new Set();

  function createCard(config, hass) {
    const el = window.document.createElement(CARD_TAG);
    window.document.body.appendChild(el);
    liveCards.add(el);
    try {
      if (hass !== undefined) el.hass = hass;
      if (config !== undefined) el.setConfig(config);
    } catch (error) {
      // A card whose first setConfig was refused was never created; detach it so it does
      // not leak (the caller is in a catch block with no reference). First setConfig only —
      // refusing a later one must leave the card as it was (atomicity, tested separately).
      cleanup(el);
      throw error;
    }
    return el;
  }

  function cleanup(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el); // triggers disconnectedCallback, clears the resume timer
    liveCards.delete(el);
  }

  function cleanupAll() {
    for (const el of Array.from(liveCards)) cleanup(el);
  }

  // The environment owns every card it creates, including one stranded by an assertion
  // before a hand-written cleanup line; it joins the module-level afterEach registry here.
  environmentCleanups.add(cleanupAll);

  // Create, use, and clean up even when the body throws. The manual
  // create/use/cleanup shape leaks the card (and its running resume timer) on a failing
  // assertion, and the next test in the file inherits it.
  function withCard(config, hass, body) {
    const el = createCard(config, hass);
    try {
      return body(el);
    } finally {
      cleanup(el);
    }
  }

  // How many cards this environment still holds. A test file that cleans up after itself
  // ends at zero; anything else means a card — and its timers — outlived its test.
  function liveCardCount() {
    return liveCards.size;
  }

  function setReducedMotion(value) {
    reducedMotion = Boolean(value);
  }

  return {
    window,
    document: window.document,
    createCard,
    withCard,
    cleanup,
    cleanupAll,
    liveCardCount,
    setReducedMotion,
  };
}

// vm.runInContext() puts the card in a separate V8 realm, so every array/plain
// object it returns carries that realm's prototypes. assert/strict's deepEqual
// compares prototype identity and fails on an otherwise value-identical value
// from the vm context. normalize() rebuilds arrays/plain objects with this
// realm's constructors; primitives pass through. Call it only on pure data from
// the card's data-only methods, never on a live element or DOM node.
function normalize(value) {
  // Array.from (this realm's) is what rehomes the result into this realm.
  if (Array.isArray(value)) return Array.from(value, normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

module.exports = { createTestEnvironment, CARD_TAG, CARD_SOURCE_PATH, normalize };

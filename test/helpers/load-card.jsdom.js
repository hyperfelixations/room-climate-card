"use strict";

// Runs the built distribution artifact (dist/room-climate-card.js — a
// dependency-free browser IIFE with no exports, exactly the bytes Home
// Assistant loads) inside a fresh jsdom window per test file, so unit tests
// can instantiate the real custom element and call its real methods directly.
//
// Testing the ARTIFACT rather than the sources is deliberate: it is the only
// thing users ever execute, and it keeps the whole suite honest about the
// build. dist/ is generated, not stored: every public test script runs
// `npm run build` first, so the artifact under test is always the one this
// checkout's src/ produces and a stale bundle cannot be silently tested.
//
// jsdom has no real layout engine (getBoundingClientRect always returns zeros,
// no font metrics) — anything that depends on actual rendered geometry belongs
// in test/browser/ (Playwright/Chromium) instead.
//
// jsdom does not implement ResizeObserver, matchMedia, or the CSS Font
// Loading API (document.fonts) at all; the card is defensive
// about ResizeObserver/document.fonts (feature-detected/optional-chained)
// but calls window.matchMedia unconditionally through optional chaining, so
// it degrades safely without a stub too — the stubs below exist so those
// code paths (bind/unbind lifecycle, reduced-motion branch, font-ready
// promise chain) get real test coverage instead of being silently skipped.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

// The single place in the test suite that knows where the built artifact
// lives. Everything else (including test/unit/i18n.test.js, which loads the
// bundle a second time to observe its module-load self-check) imports this
// constant rather than rebuilding the path.
const CARD_SOURCE_PATH = path.join(__dirname, "..", "..", "dist", "room-climate-card.js");
if (!fs.existsSync(CARD_SOURCE_PATH)) {
  throw new Error(
    `Missing build artifact ${CARD_SOURCE_PATH}. Run "npm run build" (it is generated from src/ and committed).`
  );
}
const CARD_SOURCE = fs.readFileSync(CARD_SOURCE_PATH, "utf8");
const CARD_TAG = "room-climate-card";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Creates one isolated jsdom window + loads the card script into it. Call
// once per test file (e.g. in a `before()` hook), not once per test case —
// re-registering the same custom element tag on a second window is fine
// (each jsdom window has its own CustomElementRegistry), but there is no
// reason to pay the eval cost per test.
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
  // Guarded by try/catch in the card (_getTrackTranslatePct()); stubbed
  // anyway so that code path runs instead of always hitting the catch.
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
      // A card whose very first setConfig was refused was never created. Leaving it
      // attached leaks it: the caller is in a catch block, holds no reference, and has
      // nothing to clean up. Measured before this existed — a property run creating cards
      // from randomly broken configurations retained about 3.8 MB per refusal and ran the
      // heap out at four thousand cases.
      //
      // This is the FIRST setConfig only. Refusing a LATER one must leave the card exactly
      // as it was, which is the atomicity contract and is tested separately.
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

  // Create, use, and clean up — even when the body throws.
  //
  // The manual `const el = createCard(...); ...; cleanup(el);` shape leaks the card on
  // every FAILING assertion, which is precisely when a leaked card does most harm: the
  // resume timer keeps running and the next test in the same file inherits it. This wraps
  // the pair so the failure that matters is the assertion, not the mess it left behind.
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

// vm.runInContext() gives room-climate-card.js a genuinely separate V8
// realm — correct isolation, but it means every array/plain-object value
// returned by a card method (e.g. _computeViewModel(), _carousel.holdSequence()) has that
// realm's Array.prototype/Object.prototype, not this process's. Array.isArray
// is realm-safe by design and still reports true, but assert.deepStrictEqual
// (and assert/strict's deepEqual, which is an alias for it) also compares
// prototype identity and fails on an otherwise value-identical array/object
// pulled from the vm context. normalize() rebuilds arrays/plain objects using
// this realm's constructors before assertions; primitives (including NaN,
// Infinity, null, undefined) pass through unchanged. Only ever call this on
// pure data returned by the card's data-only methods (_holdSequence(),
// _computeViewModel(), _roomGridRows(), ...) — never on a live element/DOM node,
// which this deliberately does not special-case.
function normalize(value) {
  // Array.from (this realm's, not the foreign array's own .map()/species
  // constructor) is what actually rehomes the result into this realm.
  if (Array.isArray(value)) return Array.from(value, normalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

module.exports = { createTestEnvironment, CARD_TAG, CARD_SOURCE_PATH, normalize };

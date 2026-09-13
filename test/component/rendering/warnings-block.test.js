"use strict";

// The warnings block: where a warning appears on a rendered card. It sits between the header
// and the panel, is present only while a warning is shown, counts as content when every other
// part is hidden, and can be switched off with show.warnings. Boundary: which warnings exist
// and how they read is pinned by the config and notices unit tests; that a warning leaves the
// subtitle alone is rendering/subtitle.test.js's. See internal dev doc §4 "Diagnosevertrag".

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const ROOMS = [{ entity: "sensor.r1", name: "Living room" }, { entity: "sensor.r2", name: "Bedroom" }];
const BASE = { entity: "sensor.avg", rooms: ROOMS };
const HIDE_EVERYTHING_ELSE = { accent_line: false, icon: false, title: false, subtitle: false, entity_label: false, pill: false, panel: false, rooms: false };

function hass(primary = 22) {
  return mkHass({
    "sensor.avg": mkState("sensor.avg", primary, TEMPERATURE_C),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  });
}

const block = (el) => el.shadowRoot.querySelector(".rtc-warning");
const blockText = (el) => el.shadowRoot.querySelector(".rtc-warning-text")?.textContent ?? null;
const rootChildren = (el) => [...el.shadowRoot.querySelector(".rtc-root").children].map((node) => node.getAttribute("class"));

function withWarnSpy(el, body) {
  const view = el.ownerDocument.defaultView;
  const original = view.console.warn;
  const lines = [];
  view.console.warn = (...args) => lines.push(args.join(" "));
  try {
    body();
  } finally {
    view.console.warn = original;
  }
  return lines;
}

test("an invalid value is shown in its own block between the header and the panel", () => {
  env.withCard({ ...BASE, auto_slide: "yes" }, hass(), (el) => {
    assert.deepEqual(rootChildren(el), ["rtc-top-line", "rtc-header", "rtc-warning", "rtc-main-panel", "rtc-room-grid"]);
    assert.equal(blockText(el), '"yes" is not a valid value for auto_slide. Using default: true.');
    assert.equal(el.shadowRoot.querySelector(".rtc-warning-icon").getAttribute("aria-label"), "Warning");
  });
});

test("a valid configuration has no warnings block at all", () => {
  env.withCard(BASE, hass(), (el) => {
    assert.equal(block(el), null);
  });
});

test("two or more warnings are counted in the block, not listed", () => {
  env.withCard({ ...BASE, auto_slide: "yes", views: ["sclae"] }, hass(), (el) => {
    assert.equal(blockText(el), "2 problems with this card. Details in the browser console.");
  });
});

test("the block disappears once the configuration is corrected, and returns with the next mistake", () => {
  env.withCard({ ...BASE, auto_slide: "yes" }, hass(), (el) => {
    el.setConfig(BASE);
    assert.equal(block(el), null);
    el.setConfig({ ...BASE, swipe: "no" });
    assert.equal(blockText(el), '"no" is not a valid value for swipe. Using default: true.');
  });
});

test("a card without data shows its reason in the subtitle and the warning in the block", () => {
  const unavailable = mkHass({ "sensor.avg": mkState("sensor.avg", "unavailable", TEMPERATURE_C) });
  env.withCard({ entity: "sensor.avg", start_view: "sclae" }, unavailable, (el) => {
    assert.equal(el.shadowRoot.querySelector(".rtc-subtitle").textContent, "The value is currently unavailable.");
    assert.equal(blockText(el), '"sclae" is not a valid value for start_view. Starting on the first available view.');
  });
});

test("show.warnings: false hides the block, and the console still reports", () => {
  const el = env.createCard(BASE, hass());
  const lines = withWarnSpy(el, () => el.setConfig({ ...BASE, auto_slide: "yes", show: { warnings: false } }));
  assert.equal(block(el), null);
  assert.deepEqual(lines, ['Room Climate Card: "yes" is not a valid value for auto_slide. Using default: true.']);
  env.cleanup(el);
});

test("an invalid show.warnings value is itself a warning, shown under the default", () => {
  env.withCard({ ...BASE, show: { warnings: "no" } }, hass(), (el) => {
    assert.equal(blockText(el), '"no" is not a valid value for show.warnings. Using default: true.');
  });
});

test("with every other part hidden, the block is what the card shows; hidden too, the card says why", () => {
  env.withCard({ ...BASE, auto_slide: "yes", show: HIDE_EVERYTHING_ELSE }, hass(), (el) => {
    assert.deepEqual(rootChildren(el), ["rtc-warning"]);
  });
  env.withCard({ ...BASE, auto_slide: "yes", show: { ...HIDE_EVERYTHING_ELSE, warnings: false } }, hass(), (el) => {
    assert.deepEqual(rootChildren(el), ["rtc-nothing-shown"]);
  });
});

test("the block speaks the card's language and follows a language change in place", () => {
  env.withCard({ ...BASE, auto_slide: "yes", language: "de" }, hass(), (el) => {
    const before = block(el);
    assert.equal(blockText(el), '"yes" ist kein gültiger Wert für auto_slide. Es gilt der Standard: true.');
    assert.equal(el.shadowRoot.querySelector(".rtc-warning-icon").getAttribute("aria-label"), "Warnung");
    el.setConfig({ ...BASE, auto_slide: "yes", language: "en" });
    assert.equal(block(el), before, "patched, not rebuilt");
    assert.equal(blockText(el), '"yes" is not a valid value for auto_slide. Using default: true.');
    assert.equal(el.shadowRoot.querySelector(".rtc-warning-icon").getAttribute("aria-label"), "Warning");
  });
});

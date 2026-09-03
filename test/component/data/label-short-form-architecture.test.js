"use strict";

// Long-/short-form label architecture: every collision-prone label has a canonical long
// form and a short fallback in TRANSLATIONS, and the card picks between them at measure
// time (resolveLabelForm in src/render/layout/label-form.js). Real width measurement needs
// a layout engine jsdom lacks — that is test/browser/geometry/label-geometry.spec.js.
// Here: resolveLabelForm's pure control flow and the TRANSLATIONS content.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { TEMPERATURE } = require("../../fixtures/attributes.js");

// Direct imports make the owner of each label-selection contract explicit.
let labelForm;

let env;
let el; // pure helper/translation access, no config/hass needed

test.before(async () => {
  labelForm = await import("../../../src/render/layout/label-form.js");
  env = createTestEnvironment();
  el = env.document.createElement("room-climate-card");
});
test.after(() => {
  env.cleanupAll();
});

function fakeLabelEl() {
  return env.document.createElement("span");
}

// resolveLabelForm() control flow

test("_resolveLabelForm: identical long/short forms always resolve to the long form, without ever calling fitsWithWidth", () => {
  const node = fakeLabelEl();
  let fitsCalled = false;
  const width = labelForm.resolveLabelForm(node, "now", "now", () => {
    fitsCalled = true;
    return false;
  });
  assert.equal(node.textContent, "now");
  assert.equal(fitsCalled, false, "no reason to ask whether it fits when there is no distinct short form to fall back to");
  assert.equal(typeof width, "number");
});

test("_resolveLabelForm: distinct forms, long form fits -> stays on the long form", () => {
  const node = fakeLabelEl();
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => true);
  assert.equal(node.textContent, "maintenant");
});

test("_resolveLabelForm: distinct forms, long form does not fit -> substitutes the short form", () => {
  const node = fakeLabelEl();
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => false);
  assert.equal(node.textContent, "act.");
});

test("_resolveLabelForm: fitsWithWidth is called with the long form's measured width, not the short form's", () => {
  const node = fakeLabelEl();
  const seenWidths = [];
  labelForm.resolveLabelForm(node, "maintenant", "act.", (width) => {
    seenWidths.push(width);
    return false;
  });
  assert.equal(seenWidths.length, 1, "fitsWithWidth is consulted exactly once per resolve, not once per candidate form");
});

test("_resolveLabelForm: reverts a previously-shortened element back to the long form once it fits again (idempotent across repeated calls)", () => {
  const node = fakeLabelEl();
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => false);
  assert.equal(node.textContent, "act.");
  // A later pass (card grew wider) must re-derive from the long form, not stay stuck on
  // the short form an earlier pass left.
  labelForm.resolveLabelForm(node, "maintenant", "act.", () => true);
  assert.equal(node.textContent, "maintenant");
});

// TRANSLATIONS content

// From the manifest — see test/manifests/product-surface.js.
const { LANGUAGES } = require("../../manifests/product-surface.js");

test("every language declares scale.comfortLabelShort/scale.optimalLabelShort/rangeScale.currentLabelShort", () => {
  for (const lang of LANGUAGES) {
    const card = env.createCard({ entity: "sensor.avg", language: lang }, mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }));
    for (const key of ["scale.comfortLabelShort", "scale.optimalLabelShort", "rangeScale.currentLabelShort"]) {
      const value = card._t(key, { range: "20–24°C" });
      assert.ok(typeof value === "string" && value.length > 0, `${lang}.${key} must resolve to a non-empty string`);
    }
    env.cleanup(card);
  }
});

test("Polish scale.optimalLabel is restored to the full word, opt. now only lives on scale.optimalLabelShort", () => {
  const card = env.createCard({ entity: "sensor.avg", language: "pl" }, mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }));
  const full = card._t("scale.optimalLabel", { range: "20–24°C" });
  const short = card._t("scale.optimalLabelShort", { range: "20–24°C" });
  assert.ok(!full.includes("opt."), `scale.optimalLabel must no longer be the permanently-abbreviated form, got "${full}"`);
  assert.ok(full.includes("20–24°C"), "the long form must still carry the live range");
  assert.equal(short, "20–24°C opt.", "the exact, already width-verified abbreviation from the original 320px fix must survive as the short-form fallback");
  env.cleanup(card);
});

test("French rangeScale.currentLabel is restored to 'maintenant', act. now only lives on rangeScale.currentLabelShort", () => {
  const card = env.createCard({ entity: "sensor.avg", language: "fr" }, mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }));
  assert.equal(card._t("rangeScale.currentLabel"), "maintenant");
  assert.equal(card._t("rangeScale.currentLabelShort"), "act.");
  env.cleanup(card);
});

test("languages with no documented overlap issue keep an identical long/short pair (no unnecessary new translation risk)", () => {
  const card = env.createCard({ entity: "sensor.avg", language: "de" }, mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) }));
  assert.equal(card._t("scale.comfortLabel", { range: "R" }), card._t("scale.comfortLabelShort", { range: "R" }));
  assert.equal(card._t("scale.optimalLabel", { range: "R" }), card._t("scale.optimalLabelShort", { range: "R" }));
  assert.equal(card._t("rangeScale.currentLabel"), card._t("rangeScale.currentLabelShort"));
  env.cleanup(card);
});

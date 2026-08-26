"use strict";

// Manipulated unit_of_measurement, trend unit, value_level,
// title, entity_label, room name/short, and entity id must never produce
// extra DOM nodes or event handlers. Also covers
// action-type allowlisting (_normalizeAction()).
//
// Because these tests run in a real jsdom DOM (not a string diff), an
// escaping regression here would actually create a real <img>/<script>
// element in the tree — exactly the failure mode a browser user would hit.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { TEMPERATURE } = require("../fixtures/attributes.js");

// Direct imports keep each escaping and rendering trust boundary explicit.
let actions, text;

let env;

test.before(async () => {
  actions = await import("../../src/config/actions.js");
  text = await import("../../src/core/text.js");
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const XSS_PAYLOAD = '<img src=x onerror="window.__xss_fired=true">';
const XSS_SCRIPT = '"><script>window.__xss_fired=true</script>';

function countInjectedNodes(root) {
  return root.querySelectorAll("img[onerror], script").length;
}

test("_esc(): escapes all five HTML-significant characters", () => {
  const el = env.document.createElement("room-climate-card");
  const escaped = text.escapeHtml(`& < > " '`);
  assert.equal(escaped, "&amp; &lt; &gt; &quot; &#39;");
});

test("_esc(): null/undefined become an empty string, not the literal word", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(text.escapeHtml(null), "");
  assert.equal(text.escapeHtml(undefined), "");
});

test("XSS payload in unit_of_measurement produces no extra DOM nodes", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", unit_of_measurement: XSS_PAYLOAD }) });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  env.cleanup(el);
});

test("XSS payload in a room name/short produces no extra DOM nodes, before AND after a partial update", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE),
  });
  const el = env.createCard(
    { entity: "sensor.avg", rooms: [{ name: XSS_PAYLOAD, short: XSS_SCRIPT, entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  );
  assert.equal(countInjectedNodes(el.shadowRoot), 0, "initial render");
  // Trigger a partial update (innerHTML-based room-grid rebuild path) with the same payload.
  el.hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22.5, TEMPERATURE),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE),
  });
  assert.equal(countInjectedNodes(el.shadowRoot), 0, "after partial update");
  env.cleanup(el);
});

test("XSS payload in value_level (HA attribute) produces no extra DOM nodes", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, { device_class: "temperature", value_level: XSS_PAYLOAD, value_color: "#79A86C" }),
  });
  const el = env.createCard({ entity: "sensor.avg" }, hass);
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  env.cleanup(el);
});

test("XSS payload in title/entity_label config overrides produces no extra DOM nodes", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) });
  const el = env.createCard({ entity: "sensor.avg", title: XSS_PAYLOAD, entity_label: XSS_SCRIPT }, hass);
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  env.cleanup(el);
});

test("XSS payload in the entity id itself (used in tooltips/aria-labels) produces no extra DOM nodes", () => {
  const maliciousEntity = `sensor.avg" onmouseover="window.__xss_fired=true`;
  const hass = mkHass({ [maliciousEntity]: mkState(maliciousEntity, 22, TEMPERATURE) });
  const el = env.createCard({ entity: maliciousEntity }, hass);
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  // Also confirm no element in the shadow root actually carries the injected onmouseover handler.
  const withHandler = Array.from(el.shadowRoot.querySelectorAll("*")).filter((node) => node.getAttribute("onmouseover"));
  assert.equal(withHandler.length, 0);
  env.cleanup(el);
});

test("XSS payload in a trend_entity's unit produces no extra DOM nodes", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE),
    "sensor.trend": mkState("sensor.trend", 0.2, { unit_of_measurement: XSS_PAYLOAD }),
  });
  const el = env.createCard(
    { entity: "sensor.avg", trend_entity: "sensor.trend", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] },
    hass
  );
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  env.cleanup(el);
});

test("XSS payload in an icon config value produces no extra DOM nodes (icon is set as an attribute, not interpolated as trusted HTML)", () => {
  const hass = mkHass({ "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE) });
  const el = env.createCard({ entity: "sensor.avg", icon: XSS_PAYLOAD }, hass);
  assert.equal(countInjectedNodes(el.shadowRoot), 0);
  env.cleanup(el);
});

// ---- Action allowlist (_normalizeAction()) ----

test("_normalizeAction: all 7 allowlisted action types are accepted verbatim", () => {
  const el = env.document.createElement("room-climate-card");
  for (const action of ["more-info", "toggle", "perform-action", "navigate", "url", "assist", "none"]) {
    assert.deepEqual(normalize(actions.normalizeAction({ action }, null)), { action });
  }
});

test("_normalizeAction: an unknown action type falls back to the fallback, not passed through raw", () => {
  const el = env.document.createElement("room-climate-card");
  const fallback = { action: "more-info" };
  assert.deepEqual(normalize(actions.normalizeAction({ action: "javascript:alert(1)" }, fallback)), fallback);
  assert.deepEqual(normalize(actions.normalizeAction({ action: "eval" }, fallback)), fallback);
});

test("_normalizeAction: a non-object value falls back safely", () => {
  const el = env.document.createElement("room-climate-card");
  const fallback = { action: "more-info" };
  assert.deepEqual(normalize(actions.normalizeAction("more-info", fallback)), fallback, "a bare string is not a valid action object");
  assert.deepEqual(normalize(actions.normalizeAction(null, fallback)), fallback);
  assert.deepEqual(normalize(actions.normalizeAction([], fallback)), fallback, "an array is not a plain object");
});

test("_normalizeAction: a per-room override with no fallback (null) inherits nothing, stays null", () => {
  const el = env.document.createElement("room-climate-card");
  assert.equal(actions.normalizeAction(undefined, null), null);
  assert.equal(actions.normalizeAction({ action: "bogus" }, null), null);
});

test("integration: config-level and per-room tap_action/hold_action are both wired through the allowlist", () => {
  const hass = mkHass({
    "sensor.avg": mkState("sensor.avg", 22, TEMPERATURE),
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE),
  });
  const el = env.createCard(
    {
      entity: "sensor.avg",
      tap_action: { action: "navigate", navigation_path: "/lovelace/0" },
      rooms: [{ entity: "sensor.r1", tap_action: { action: "bogus-type" } }, { entity: "sensor.r2" }],
    },
    hass
  );
  assert.equal(el._config.tap_action.action, "navigate");
  assert.equal(el._config.rooms[0].tap_action, null, "a per-room bogus action type falls back to null (inherits card-level action at render time)");
  env.cleanup(el);
});

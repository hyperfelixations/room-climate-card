"use strict";

// Characterization of error and warning behaviour, verbatim.
//
// The card has two deliberately different failure modes, and the boundary
// between them is a product decision, not an implementation detail:
//
//   throw      structurally invalid configuration (bad entity, malformed
//              classification profile) — Home Assistant's setConfig() contract
//              requires the error to propagate so the dashboard shows it.
//   console    recoverable/ignorable misconfiguration (unknown view type,
//              stray option key, incompatible sensor set) — the card degrades
//              instead of breaking, and says so exactly once.
//
// Changes must move neither the boundary nor the wording: the messages
// are the only diagnostic channel users have, they are quoted in the public
// README's troubleshooting section, and the once-per-change deduplication is
// what keeps a permanently misconfigured dashboard from flooding the console.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { st } = require("../helpers/characterization-scenarios.js");

const C = { device_class: "temperature", unit_of_measurement: "°C" };
const F = { device_class: "temperature", unit_of_measurement: "°F" };

function hassWith(states, language) {
  return {
    language: language || "en",
    locale: { language: language || "en" },
    states,
    callService: () => {},
  };
}

const VALID_HASS = hassWith({
  "sensor.avg": st("sensor.avg", 22.4, C),
  "sensor.r1": st("sensor.r1", 21.1, C),
  "sensor.r2": st("sensor.r2", 23.6, C),
});

const FAHRENHEIT_HASS = hassWith({ "sensor.avg": st("sensor.avg", 72.5, F) });

const VALID_HASS_HUMIDITY = hassWith({
  "sensor.avg": st("sensor.avg", 48, { device_class: "humidity", unit_of_measurement: "%" }),
});

// A structurally valid custom profile, cloned and then broken one field at a
// time below, so each case isolates exactly one validation rule.
function validCustom() {
  return {
    source: "custom",
    unit: "°C",
    bands: { comfort: { min: 19, max: 25 }, optimal: { min: 21, max: 23 } },
    scale: { min: 16, max: 28, step: 2 },
    tiers: [
      { min: 24, score: 3, level: "Warm", color: "#cc4444", zone: "outside" },
      { min: 20, score: 2, level: "Ok", color: "#44cc66", zone: "optimal" },
      { default: true, score: 1, level: "Cold", color: "#4488cc", zone: "outside" },
    ],
  };
}

const INVALID_CONFIGS = [
  ["config-not-an-object", VALID_HASS, "not a config"],
  ["config-is-an-array", VALID_HASS, []],
  ["null-config-has-no-entity", VALID_HASS, null],
  ["entity-missing", VALID_HASS, {}],
  ["entity-blank", VALID_HASS, { entity: "   " }],
  ["entity-not-a-string", VALID_HASS, { entity: 5 }],
  ["rooms-not-an-array", VALID_HASS, { entity: "sensor.avg", rooms: "sensor.r1" }],
  ["room-not-an-object", VALID_HASS, { entity: "sensor.avg", rooms: ["sensor.r1"] }],
  ["room-entity-missing", VALID_HASS, { entity: "sensor.avg", rooms: [{ name: "A" }] }],
  [
    "room-entity-duplicated",
    VALID_HASS,
    { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r1" }] },
  ],
  ["range-entity-not-a-string", VALID_HASS, { entity: "sensor.avg", range_entity: 7 }],
  ["trend-entity-not-a-string", VALID_HASS, { entity: "sensor.avg", trend_entity: 7 }],
  ["classification-shorthand-profile", VALID_HASS, { entity: "sensor.avg", classification: "profile" }],
  ["classification-shorthand-custom", VALID_HASS, { entity: "sensor.avg", classification: "custom" }],
  ["classification-not-string-or-object", VALID_HASS, { entity: "sensor.avg", classification: 5 }],
  [
    "classification-unknown-key",
    VALID_HASS,
    { entity: "sensor.avg", classification: { source: "auto", bogus: true } },
  ],
  ["classification-unknown-source", VALID_HASS, { entity: "sensor.avg", classification: { source: "nope" } }],
  [
    "classification-entity-source-with-profile",
    VALID_HASS,
    { entity: "sensor.avg", classification: { source: "entity", profile: "indoor" } },
  ],
  [
    "classification-blank-profile",
    VALID_HASS,
    { entity: "sensor.avg", classification: { source: "profile", profile: "   " } },
  ],
  [
    "classification-unknown-profile-for-metric-kind",
    VALID_HASS,
    { entity: "sensor.avg", classification: { source: "profile", profile: "greenhouse" } },
  ],
  [
    "custom-unit-missing",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), unit: undefined } },
  ],
  ["custom-unit-unknown", VALID_HASS, { entity: "sensor.avg", classification: { ...validCustom(), unit: "hPa" } }],
  ["custom-bands-missing", VALID_HASS, { entity: "sensor.avg", classification: { ...validCustom(), bands: undefined } }],
  [
    "custom-optimal-not-contained-in-comfort",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: { ...validCustom(), bands: { comfort: { min: 21, max: 23 }, optimal: { min: 19, max: 25 } } },
    },
  ],
  // The two shapes of `scale`, and the two ways of asking for neither.
  [
    "custom-scale-without-a-range",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { step: 2 } } },
  ],
  [
    "custom-scale-range-with-anchor-scale-false",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { min: 16, max: 28, step: 2, anchor_scale: false } } },
  ],
  [
    "custom-one-sided-without-an-anchor",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        scale: { step: 2, anchor_scale: false, one_sided: true },
      },
    },
  ],
  [
    "custom-scale-step-not-positive",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { min: 16, max: 28, step: 0 } } },
  ],
  [
    "custom-band-min-not-below-max",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: { ...validCustom(), bands: { comfort: { min: 25, max: 25 }, optimal: { min: 21, max: 23 } } },
    },
  ],
  [
    "custom-tiers-not-strictly-descending",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [
          { min: 20, score: 3, level: "A", color: "#cc4444", zone: "outside" },
          { min: 24, score: 2, level: "B", color: "#44cc66", zone: "optimal" },
          { default: true, score: 1, level: "C", color: "#4488cc", zone: "outside" },
        ],
      },
    },
  ],
  [
    "custom-default-tier-not-last",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [
          { default: true, score: 3, level: "A", color: "#cc4444", zone: "outside" },
          { min: 20, score: 1, level: "B", color: "#4488cc", zone: "outside" },
        ],
      },
    },
  ],
  [
    "custom-no-default-tier",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [{ min: 20, score: 1, level: "B", color: "#4488cc", zone: "outside" }],
      },
    },
  ],
  [
    "custom-tier-unknown-zone",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [
          { min: 24, score: 3, level: "A", color: "#cc4444", zone: "elsewhere" },
          { default: true, score: 1, level: "C", color: "#4488cc", zone: "outside" },
        ],
      },
    },
  ],
  [
    "custom-tier-invalid-color",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [
          { min: 24, score: 3, level: "A", color: "red", zone: "outside" },
          { default: true, score: 1, level: "C", color: "#4488cc", zone: "outside" },
        ],
      },
    },
  ],
  [
    "custom-valid-range-without-bounds",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), valid_range: {} } },
  ],
  [
    "custom-icons-threshold-object-not-descending",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: { ...validCustom(), icons: { fire: 20, high: 26, normal: 19, low: 15 } },
    },
  ],
  [
    "custom-icons-not-a-list",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), icons: "mdi:thermometer" } },
  ],
  [
    "custom-icons-threshold-object-on-a-non-temperature-profile",
    VALID_HASS_HUMIDITY,
    {
      entity: "sensor.avg",
      classification: {
        source: "custom",
        unit: "%",
        bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } },
        scale: { min: 30, max: 70, step: 5 },
        tiers: [
          { min: 60, score: 2, level: "Humid", color: "#4488cc", zone: "outside" },
          { default: true, score: 1, level: "Dry", color: "#cc8844", zone: "outside" },
        ],
        icons: { fire: 90, high: 75, normal: 40, low: 20 },
      },
    },
  ],
  [
    "custom-icons-list-without-a-default-tier",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: { ...validCustom(), icons: [{ min: 28, icon: "mdi:fire-alert" }] },
    },
  ],
  [
    "custom-unit-belongs-to-another-metric-kind",
    VALID_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        unit: "%",
        bands: { comfort: { min: 40, max: 60 }, optimal: { min: 45, max: 55 } },
        scale: { min: 30, max: 70, step: 5 },
      },
    },
  ],
  [
    "custom-profile-collapses-when-projected-to-fahrenheit",
    FAHRENHEIT_HASS,
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        tiers: [
          { min: 24, score: 4, level: "A", color: "#cc4444", zone: "outside" },
          { min: 22.3, score: 3, level: "B", color: "#ccaa44", zone: "comfort" },
          { min: 22.0, score: 2, level: "C", color: "#44cc66", zone: "optimal" },
          { default: true, score: 1, level: "D", color: "#4488cc", zone: "outside" },
        ],
      },
    },
  ],
];

const WARNING_CONFIGS = [
  ["views-not-an-array", { entity: "sensor.avg", views: "scale" }],
  ["views-unknown-type", { entity: "sensor.avg", views: ["scale", "bogus"] }],
  ["views-duplicate-type", { entity: "sensor.avg", views: ["scale", "scale"] }],
  ["views-invalid-enabled", { entity: "sensor.avg", views: [{ type: "scale", enabled: "yes" }] }],
  ["views-entry-wrong-shape", { entity: "sensor.avg", views: [42] }],
  ["views-entry-missing-type", { entity: "sensor.avg", views: [{ enabled: true }] }],
  ["views-entry-empty-string", { entity: "sensor.avg", views: ["   "] }],
  ["views-options-not-an-object", { entity: "sensor.avg", views: [{ type: "scale", options: "all" }] }],
  ["views-options-unknown-key", { entity: "sensor.avg", views: [{ type: "scale", options: { bogus: true, also_bogus: 1 } }] }],
  ["views-options-invalid-boolean", { entity: "sensor.avg", views: [{ type: "scale", options: { show_comfort_band: "yes" } }] }],
  ["views-options-invalid-enum", { entity: "sensor.avg", views: [{ type: "scale", options: { markers: "some" } }] }],
];

let env;

test.before(() => {
  env = createFrozenEnvironment();
});

test.after(() => {
  env.cleanupAll();
});

function newCard(hass) {
  const el = env.document.createElement("room-climate-card");
  env.document.body.appendChild(el);
  el.hass = hass;
  return el;
}

test("every rejected configuration throws its documented message", () => {
  const catalog = {};
  const recorder = recordConsole(env);
  for (const [name, hass, config] of INVALID_CONFIGS) {
    const el = newCard(hass);
    let message = null;
    try {
      el.setConfig(config);
    } catch (err) {
      message = err.message;
    }
    assert.notEqual(message, null, `${name}: must throw`);
    catalog[name] = message;
    el.remove();
  }
  recorder.restore();
  expectBaseline("diagnostics/config-errors.json", stableStringify(catalog));
});

test("every tolerated misconfiguration warns with its documented message", () => {
  const catalog = {};
  for (const [name, config] of WARNING_CONFIGS) {
    const el = newCard(VALID_HASS);
    const recorder = recordConsole(env);
    el.setConfig(config);
    recorder.restore();
    catalog[name] = recorder.warnings;
    assert.ok(recorder.warnings.length > 0, `${name}: must produce at least one warning`);
    assert.equal(recorder.errors.length, 0, `${name}: must not escalate to console.error`);
    el.remove();
  }
  expectBaseline("diagnostics/config-warnings.json", stableStringify(catalog));
});

test("a tolerated misconfiguration still renders a working card (degrade, never break)", () => {
  for (const [name, config] of WARNING_CONFIGS) {
    const el = newCard(VALID_HASS);
    const recorder = recordConsole(env);
    el.setConfig(config);
    recorder.restore();
    assert.ok(el.shadowRoot.querySelector(".rtc-card"), `${name}: the card must still render`);
    el.remove();
  }
});

test("incompatible room metric kinds warn once and are exposed as a defined configuration state", () => {
  const hass = hassWith({
    "sensor.avg": st("sensor.avg", "unavailable", C),
    "sensor.r1": st("sensor.r1", 21.5, C),
    "sensor.r2": st("sensor.r2", 55.0, { device_class: "humidity", unit_of_measurement: "%" }),
  });
  const el = newCard(hass);
  const recorder = recordConsole(env);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  const afterFirst = recorder.warnings.length;

  // A second hass push with the same diagnosis must stay silent — the card
  // re-resolves the measurement context on every update, so without the dedup
  // this would warn on every single state change.
  el.hass = hassWith(hass.states);
  recorder.restore();

  assert.equal(afterFirst, 1, "exactly one warning for the first occurrence");
  assert.equal(recorder.warnings.length, 1, "an unchanged diagnosis must not re-warn");
  assert.equal(el._computeViewModel().configurationState, "mixed_metric_kinds");
  expectBaseline("diagnostics/mixed-metric-kinds.json", stableStringify(recorder.warnings));
  el.remove();
});

test("a throwing hass object is contained: logged once, last good render preserved", () => {
  const el = newCard(VALID_HASS);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  const before = el.shadowRoot.innerHTML;

  const recorder = recordConsole(env);
  el.hass = {
    language: "en",
    locale: { language: "en" },
    states: new Proxy({}, { get() { throw new Error("simulated integration failure"); } }),
    callService: () => {},
  };
  recorder.restore();

  assert.equal(recorder.errors.length, 1, "the failure must be reported exactly once");
  assert.match(recorder.errors[0], /^Room Climate Card: render failed/);
  assert.equal(el.shadowRoot.innerHTML, before, "the last good render must stay on screen");
  el.remove();
});

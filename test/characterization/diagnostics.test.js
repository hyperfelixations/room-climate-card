"use strict";

// Characterization of error and warning behaviour, verbatim. The card has two failure modes,
// and the boundary is a product decision: a configuration setConfig() cannot use at all — a key
// the card does not have, a missing or malformed source — throws (HA's setConfig() contract
// requires it to propagate); every invalid value and every foreign key degrades to its default,
// is shown in the warnings block and is written to the console once per change. Changes must
// move neither the boundary nor the wording without a deliberate baseline update — the messages
// are what a user has to act on, and the once-per-change dedup keeps a misconfigured dashboard
// from flooding the console.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFrozenEnvironment, recordConsole, stableStringify, expectBaseline } = require("../helpers/characterization.js");
const { st } = require("../helpers/characterization-scenarios.js");
const { HUMIDITY, TEMPERATURE_C, TEMPERATURE_F } = require("../fixtures/attributes.js");

const C = TEMPERATURE_C;
const F = TEMPERATURE_F;

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
  "sensor.avg": st("sensor.avg", 48, HUMIDITY),
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

// The closed catalog of refusals, and an unknown key in every object the card owns.
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
  ["top-level-misspelled-key", VALID_HASS, { entity: "sensor.avg", pallete: "vivid" }],
  ["room-unknown-key", VALID_HASS, { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", nmae: "Kitchen" }] }],
  ["show-unknown-key", VALID_HASS, { entity: "sensor.avg", show: { ikon: false } }],
  ["title-unknown-key", VALID_HASS, { entity: "sensor.avg", title: { text: "Hall", overflw: "wrap" } }],
  ["views-entry-unknown-key", VALID_HASS, { entity: "sensor.avg", views: [{ type: "scale", enable: true }] }],
  ["views-options-unknown-key", VALID_HASS, { entity: "sensor.avg", views: [{ type: "scale", options: { bogus: true, also_bogus: 1 } }] }],
  [
    "classification-unknown-key",
    VALID_HASS,
    { entity: "sensor.avg", classification: { source: "auto", bogus: true } },
  ],
  [
    "custom-profile-unknown-nested-key",
    VALID_HASS,
    { entity: "sensor.avg", classification: { ...validCustom(), unit: "hPa", scale: { min: 16, max: 28, step: 2, anchorScale: false } } },
  ],
  ["palette-unknown-key", VALID_HASS, { entity: "sensor.avg", palette: { optimal: "1DB85D", abve: "FD9808" } }],
];

// [name, config, hass]; hass defaults to VALID_HASS.
const WARNING_CONFIGS = [
  ["top-level-foreign-key", { entity: "sensor.avg", wibble_wobble: 1 }],
  ["range-entity-not-a-string", { entity: "sensor.avg", range_entity: 7 }],
  ["trend-entity-not-a-string", { entity: "sensor.avg", trend_entity: 7 }],
  ["room-name-not-text", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", name: true }] }],
  ["room-action-unknown", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1", hold_action: { action: "explode" } }] }],
  ["tap-action-not-an-object", { entity: "sensor.avg", tap_action: "toggle" }],
  ["title-not-text", { entity: "sensor.avg", title: 42 }],
  ["subtitle-overflow-unknown", { entity: "sensor.avg", subtitle: { text: "Downstairs", overflow: "sideways" } }],
  ["entity-label-not-text", { entity: "sensor.avg", entity_label: 5 }],
  ["icon-empty", { entity: "sensor.avg", icon: "" }],
  ["accent-line-unknown", { entity: "sensor.avg", accent_line: "under" }],
  ["decimals-out-of-range", { entity: "sensor.avg", decimals: 3 }],
  ["language-unsupported", { entity: "sensor.avg", language: "xx" }],
  ["show-not-an-object", { entity: "sensor.avg", show: "yes" }],
  ["show-part-not-a-boolean", { entity: "sensor.avg", show: { pill: "no" } }],
  ["show-rooms-unknown", { entity: "sensor.avg", show: { rooms: "alway" } }],
  ["room-sort-unknown", { entity: "sensor.avg", room_sort: "names" }],
  ["room-label-unknown", { entity: "sensor.avg", room_label: "long" }],
  ["room-columns-out-of-range", { entity: "sensor.avg", room_columns: 0 }],
  ["auto-slide-not-a-boolean", { entity: "sensor.avg", auto_slide: "yes" }],
  ["rotation-seconds-out-of-range", { entity: "sensor.avg", rotation_seconds: 0 }],
  ["slide-seconds-not-a-number", { entity: "sensor.avg", slide_seconds: "NaN" }],
  ["views-not-an-array", { entity: "sensor.avg", views: "scale" }],
  ["views-unknown-type", { entity: "sensor.avg", views: ["scale", "bogus"] }],
  ["views-duplicate-type", { entity: "sensor.avg", views: ["scale", "scale"] }],
  ["views-invalid-enabled", { entity: "sensor.avg", views: [{ type: "scale", enabled: "yes" }] }],
  ["views-entry-wrong-shape", { entity: "sensor.avg", views: [42] }],
  ["views-entry-missing-type", { entity: "sensor.avg", views: [{ enabled: true }] }],
  ["views-entry-empty-string", { entity: "sensor.avg", views: ["   "] }],
  ["views-options-not-an-object", { entity: "sensor.avg", views: [{ type: "scale", options: "all" }] }],
  ["views-options-invalid-boolean", { entity: "sensor.avg", views: [{ type: "scale", options: { show_comfort_band: "yes" } }] }],
  ["views-options-invalid-enum", { entity: "sensor.avg", views: [{ type: "scale", options: { markers: "some" } }] }],
  ["start-view-unknown", { entity: "sensor.avg", start_view: "sclae" }],
  ["show-rooms-legacy-unknown", { entity: "sensor.avg", show_rooms: "alway" }],
  ["unavailable-values-legacy-unknown", { entity: "sensor.avg", unavailable_values: "hidden" }],
  ["palette-unknown-name", { entity: "sensor.avg", palette: "neon" }],
  ["palette-gradient-with-an-empty-part", { entity: "sensor.avg", palette: "teal--black" }],
  ["palette-written-color-invalid", { entity: "sensor.avg", palette: { optimal: "1DB85D", above: "FD9808, nope" } }],
  // What `optimal: #1DB85D` reaches the card as: a YAML comment left the value empty.
  ["palette-written-color-swallowed-by-a-comment", { entity: "sensor.avg", palette: { optimal: null } }],
  ["classification-shorthand-profile", { entity: "sensor.avg", classification: "profile" }],
  ["classification-shorthand-custom", { entity: "sensor.avg", classification: "custom" }],
  ["classification-not-string-or-object", { entity: "sensor.avg", classification: 5 }],
  ["classification-unknown-source", { entity: "sensor.avg", classification: { source: "nope" } }],
  ["classification-entity-source-with-profile", { entity: "sensor.avg", classification: { source: "entity", profile: "indoor" } }],
  ["classification-blank-profile", { entity: "sensor.avg", classification: { source: "profile", profile: "   " } }],
  ["custom-unit-missing", { entity: "sensor.avg", classification: { ...validCustom(), unit: undefined } }],
  ["custom-unit-unknown", { entity: "sensor.avg", classification: { ...validCustom(), unit: "hPa" } }],
  ["custom-bands-missing", { entity: "sensor.avg", classification: { ...validCustom(), bands: undefined } }],
  [
    "custom-optimal-not-contained-in-comfort",
    { entity: "sensor.avg", classification: { ...validCustom(), bands: { comfort: { min: 21, max: 23 }, optimal: { min: 19, max: 25 } } } },
  ],
  [
    "custom-band-min-not-below-max",
    { entity: "sensor.avg", classification: { ...validCustom(), bands: { comfort: { min: 25, max: 25 }, optimal: { min: 21, max: 23 } } } },
  ],
  // The two shapes of `scale`, and the ways of asking for neither.
  ["custom-scale-without-a-range", { entity: "sensor.avg", classification: { ...validCustom(), scale: { step: 2 } } }],
  [
    "custom-scale-range-with-anchor-scale-false",
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { min: 16, max: 28, step: 2, anchor_scale: false } } },
  ],
  [
    "custom-one-sided-without-an-anchor",
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { step: 2, anchor_scale: false, one_sided: true } } },
  ],
  ["custom-scale-step-not-positive", { entity: "sensor.avg", classification: { ...validCustom(), scale: { min: 16, max: 28, step: 0 } } }],
  [
    "custom-tiers-not-strictly-descending",
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
    { entity: "sensor.avg", classification: { ...validCustom(), tiers: [{ min: 20, score: 1, level: "B", color: "#4488cc", zone: "outside" }] } },
  ],
  [
    "custom-tier-unknown-zone",
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
  ["custom-valid-range-without-bounds", { entity: "sensor.avg", classification: { ...validCustom(), valid_range: {} } }],
  [
    "custom-icons-threshold-object-not-descending",
    { entity: "sensor.avg", classification: { ...validCustom(), icons: { fire: 20, high: 26, normal: 19, low: 15 } } },
  ],
  ["custom-icons-not-a-list", { entity: "sensor.avg", classification: { ...validCustom(), icons: "mdi:thermometer" } }],
  [
    "custom-icons-threshold-object-on-a-non-temperature-profile",
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
    VALID_HASS_HUMIDITY,
  ],
  [
    "custom-icons-list-without-a-default-tier",
    { entity: "sensor.avg", classification: { ...validCustom(), icons: [{ min: 28, icon: "mdi:fire-alert" }] } },
  ],
  [
    "custom-value-cannot-be-converted-to-the-canonical-unit",
    {
      entity: "sensor.avg",
      classification: {
        ...validCustom(),
        unit: "°F",
        bands: { comfort: { min: 66, max: 77 }, optimal: { min: 70, max: 73 } },
        scale: { min: 60, max: 1e308, step: 2 },
      },
    },
  ],
  // Decidable only with the sensors: the card applies the measurement's default profile.
  ["classification-unknown-profile-for-metric-kind", { entity: "sensor.avg", classification: { source: "profile", profile: "greenhouse" } }],
  [
    "custom-unit-belongs-to-another-metric-kind",
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
    FAHRENHEIT_HASS,
  ],
  [
    "custom-profile-cannot-be-expressed-in-fahrenheit",
    { entity: "sensor.avg", classification: { ...validCustom(), scale: { min: -5e307, max: 5e307, step: 2 } } },
    FAHRENHEIT_HASS,
  ],
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
      assert.equal(err.name, "ConfigError", `${name}: a refusal from the catalog, not a programming error`);
      message = err.message;
    }
    assert.notEqual(message, null, `${name}: must throw`);
    catalog[name] = message;
    el.remove();
  }
  recorder.restore();
  expectBaseline("diagnostics/config-errors.json", stableStringify(catalog));
});

test("every invalid value and foreign key warns in the warnings block and in the console", () => {
  const catalog = {};
  for (const [name, config, hass = VALID_HASS] of WARNING_CONFIGS) {
    const el = newCard(hass);
    const recorder = recordConsole(env);
    el.setConfig(config);
    recorder.restore();
    catalog[name] = {
      console: recorder.warnings,
      block: el.shadowRoot.querySelector(".rtc-warning-text")?.textContent ?? null,
    };
    assert.ok(recorder.warnings.length > 0, `${name}: must produce at least one warning`);
    assert.equal(recorder.errors.length, 0, `${name}: must not escalate to console.error`);
    assert.ok(el.shadowRoot.querySelector(".rtc-warning"), `${name}: the warnings block is shown`);
    el.remove();
  }
  expectBaseline("diagnostics/config-warnings.json", stableStringify(catalog));
});

test("a tolerated misconfiguration still renders a working card (degrade, never break)", () => {
  for (const [name, config, hass = VALID_HASS] of WARNING_CONFIGS) {
    const el = newCard(hass);
    const recorder = recordConsole(env);
    el.setConfig(config);
    recorder.restore();
    assert.ok(el.shadowRoot.querySelector(".rtc-main-panel"), `${name}: the card must still render`);
    el.remove();
  }
});

// What the sensors get wrong while the configuration is fine: a warning for a fault that stays,
// a hint in the subtitle for a source that is momentarily out. [name, config, states].
const RUNTIME_SCENARIOS = [
  ["rooms-measure-different-things", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, {
    "sensor.avg": st("sensor.avg", "unavailable", {}),
    "sensor.r1": st("sensor.r1", 21.5, C),
    "sensor.r2": st("sensor.r2", 55.0, HUMIDITY),
  }],
  ["room-entity-not-found", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.gone" }] }, VALID_HASS.states],
  ["entity-unit-fits-several-measurements", { entity: "sensor.air" }, { "sensor.air": st("sensor.air", 700, { unit_of_measurement: "ppm" }) }],
  ["entity-unidentified", { entity: "sensor.mute" }, { "sensor.mute": st("sensor.mute", 7, {}) }],
  ["entity-unit-unreadable", { entity: "sensor.odd" }, { "sensor.odd": st("sensor.odd", 22, { device_class: "temperature", unit_of_measurement: "furlongs" }) }],
  ["room-measures-something-else", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.h" }] }, {
    ...VALID_HASS.states,
    "sensor.h": st("sensor.h", 45, HUMIDITY),
  }],
  ["room-declares-a-foreign-measurement", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.battery" }] }, {
    ...VALID_HASS.states,
    "sensor.battery": st("sensor.battery", 100, { device_class: "battery", unit_of_measurement: "%" }),
  }],
  ["range-entity-unit-unreadable", { entity: "sensor.avg", range_entity: "sensor.range" }, {
    ...VALID_HASS.states,
    "sensor.range": st("sensor.range", 4, { unit_of_measurement: "hPa", minimum: 18, maximum: 22 }),
  }],
  ["hint-room-unavailable", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, {
    ...VALID_HASS.states,
    "sensor.r2": st("sensor.r2", "unavailable", C),
  }],
  ["hint-main-sensor-unavailable", { entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] }, {
    ...VALID_HASS.states,
    "sensor.avg": st("sensor.avg", "unavailable", C),
  }],
  ["hint-range-and-trend-unavailable", { entity: "sensor.avg", range_entity: "sensor.range", trend_entity: "sensor.trend" }, {
    ...VALID_HASS.states,
    "sensor.range": st("sensor.range", "unavailable", C),
    "sensor.trend": st("sensor.trend", "unknown", {}),
  }],
];

test("every runtime warning names its entity in the block and the console, and every hint rides on the subtitle", () => {
  const catalog = {};
  for (const [name, config, states] of RUNTIME_SCENARIOS) {
    const el = newCard(hassWith(states));
    const recorder = recordConsole(env);
    el.setConfig(config);
    recorder.restore();
    catalog[name] = {
      console: recorder.warnings,
      block: el.shadowRoot.querySelector(".rtc-warning-text")?.textContent ?? null,
      subtitle: el.shadowRoot.querySelector(".rtc-subtitle")?.textContent ?? null,
    };
    assert.equal(recorder.errors.length, 0, `${name}: must not escalate to console.error`);
    assert.equal(catalog[name].console.length, catalog[name].block === null ? 0 : 1, `${name}: the console reports exactly what the block shows`);
    el.remove();
  }
  expectBaseline("diagnostics/runtime-notices.json", stableStringify(catalog));
});

test("incompatible room metric kinds warn once and are exposed as a defined configuration state", () => {
  // The primary declares neither a device_class nor a unit, so nothing settles the room
  // disagreement — the mixed state. A primary that declares a kind arbitrates instead.
  const hass = hassWith({
    "sensor.avg": st("sensor.avg", "unavailable", {}),
    "sensor.r1": st("sensor.r1", 21.5, C),
    "sensor.r2": st("sensor.r2", 55.0, HUMIDITY),
  });
  const el = newCard(hass);
  const recorder = recordConsole(env);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  const afterFirst = recorder.warnings.length;

  // A second push with the same diagnosis must stay silent; the context is re-resolved every update.
  el.hass = hassWith(hass.states);
  recorder.restore();

  assert.equal(afterFirst, 1, "exactly one warning for the first occurrence");
  assert.equal(recorder.warnings.length, 1, "an unchanged diagnosis must not re-warn");
  assert.equal(el._computeViewModel().configurationState, "mixed_metric_kinds");
  el.remove();
});

test("a render that throws is contained: reported once, shown as one line, and recovered from", () => {
  const el = newCard(VALID_HASS);
  el.setConfig({ entity: "sensor.avg", rooms: [{ entity: "sensor.r1" }, { entity: "sensor.r2" }] });
  const throwing = () => ({
    language: "en",
    locale: { language: "en" },
    states: new Proxy({}, { get() { throw new Error("simulated integration failure"); } }),
    callService: () => {},
  });

  const recorder = recordConsole(env);
  el.hass = throwing();
  el.hass = throwing();
  el.hass = throwing();
  recorder.restore();

  assert.equal(recorder.errors.length, 1, "one cause over three updates is reported exactly once");
  assert.match(recorder.errors[0], /^Room Climate Card: render failed/);
  assert.equal(
    el.shadowRoot.querySelector(".rtc-render-failed").textContent,
    "The card could not be drawn. Details in the browser console."
  );
  el.hass = VALID_HASS;
  assert.ok(el.shadowRoot.querySelector(".rtc-main-panel"), "the next good update rebuilds the card");
  el.remove();
});

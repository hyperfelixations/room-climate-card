"use strict";

// Trend summary contract:
// - classification is metric-specific and happens in canonical rate units;
// - the direction SVG stays attached to the average unit;
// - the signed rate belongs only to the room-bound main scale footer;
// - live trend changes patch the existing average/footer DOM in place.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment, normalize } = require("../../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../../helpers/hass-fixtures.js");
const { loadCardInternals } = require("../../helpers/card-internals.js");
const { TEMPERATURE_C } = require("../../fixtures/attributes.js");

// Load cross-module compositions through the dedicated test helper.
let internals;

let env;

test.before(async () => {
  internals = await loadCardInternals();
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

const METRIC_CASES = {
  temperature: {
    deviceClass: "temperature",
    unit: "°C",
    avg: 22,
    stableLimit: 0.1,
  },
  humidity: {
    deviceClass: "humidity",
    unit: "%",
    avg: 50,
    stableLimit: 0.5,
  },
  co2: {
    deviceClass: "carbon_dioxide",
    unit: "ppm",
    avg: 700,
    stableLimit: 25,
  },
  pm25: {
    deviceClass: "pm25",
    unit: "µg/m³",
    avg: 8,
    stableLimit: 0.5,
  },
};

function trendCard(metric, trendValue, extraConfig = {}, extraStates = {}) {
  const fx = METRIC_CASES[metric];
  const states = {
    "sensor.avg": mkState("sensor.avg", fx.avg, {
      device_class: fx.deviceClass,
      unit_of_measurement: fx.unit,
    }),
    "sensor.trend": mkState("sensor.trend", trendValue, {
      unit_of_measurement: `${fx.unit}/h`,
    }),
    ...extraStates,
  };
  return env.createCard(
    {
      entity: "sensor.avg",
      trend_entity: "sensor.trend",
      auto_slide: false,
      ...extraConfig,
    },
    mkHass(states)
  );
}

test("trend policy: each metric uses its own inclusive stable deadband in canonical rate units", () => {
  for (const [metric, fx] of Object.entries(METRIC_CASES)) {
    const epsilon = metric === "co2" ? 0.01 : 0.001;
    const cases = [
      [-fx.stableLimit - epsilon, "falling"],
      [-fx.stableLimit, "stable"],
      [0, "stable"],
      [fx.stableLimit, "stable"],
      [fx.stableLimit + epsilon, "rising"],
    ];

    for (const [value, expectedDirection] of cases) {
      const el = trendCard(metric, value);
      const data = el._computeViewModel();
      assert.deepEqual(
        normalize({
          direction: data.trend.model?.direction,
          fallingBelow: data.trend.model?.policy?.fallingBelow,
          risingAbove: data.trend.model?.policy?.risingAbove,
        }),
        {
          direction: expectedDirection,
          fallingBelow: -fx.stableLimit,
          risingAbove: fx.stableLimit,
        },
        `${metric} at ${value}${fx.unit}/h`
      );
      env.cleanup(el);
    }
  }
});

test("trend policy: Fahrenheit rates are classified after conversion to canonical °C/h", () => {
  const states = {
    "sensor.avg": mkState("sensor.avg", 71.6, {
      device_class: "temperature",
      unit_of_measurement: "°F",
    }),
    "sensor.trend": mkState("sensor.trend", 0.18, {
      unit_of_measurement: "°F/h",
    }),
  };
  const stable = env.createCard(
    { entity: "sensor.avg", trend_entity: "sensor.trend" },
    mkHass(states)
  );
  const data = stable._computeViewModel();
  assert.equal(data.trend.model.direction, "stable");
  assert.ok(Math.abs(data.trend.model.canonicalValue - 0.1) < 1e-12);
  assert.ok(Math.abs(data.trend.model.value - 0.18) < 1e-12);
  assert.equal(data.trend.model.unit, "°F/h");
  env.cleanup(stable);

  const rising = env.createCard(
    { entity: "sensor.avg", trend_entity: "sensor.trend" },
    mkHass({
      ...states,
      "sensor.trend": mkState("sensor.trend", 0.181, {
        unit_of_measurement: "°F/h",
      }),
    })
  );
  assert.equal(rising._computeViewModel().trend.model.direction, "rising");
  env.cleanup(rising);
});

test("trend model: missing, unavailable, non-numeric, unitless, and incompatible trend entities stay absent", () => {
  const variants = [
    {
      config: { entity: "sensor.avg" },
      state: undefined,
    },
    {
      config: { entity: "sensor.avg", trend_entity: "sensor.trend" },
      state: mkState("sensor.trend", "unavailable", { unit_of_measurement: "°C/h" }),
    },
    {
      config: { entity: "sensor.avg", trend_entity: "sensor.trend" },
      state: mkState("sensor.trend", "not-a-number", { unit_of_measurement: "°C/h" }),
    },
    {
      config: { entity: "sensor.avg", trend_entity: "sensor.trend" },
      state: mkState("sensor.trend", 0.2, {}),
    },
    {
      config: { entity: "sensor.avg", trend_entity: "sensor.trend" },
      state: mkState("sensor.trend", 0.2, { unit_of_measurement: "hPa/h" }),
    },
  ];

  for (const variant of variants) {
    const states = {
      "sensor.avg": mkState("sensor.avg", 22, {
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
    };
    if (variant.state) states["sensor.trend"] = variant.state;
    const el = env.createCard(variant.config, mkHass(states));
    const data = el._computeViewModel();
    assert.equal(data.trend.model, null);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-button").classList.contains("rtc-has-trend"), false);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-trend"), null);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-reading"), null);
    assert.equal(el.shadowRoot.querySelector(".rtc-avg-trend-arrow").hidden, true);
    env.cleanup(el);
  }
});

test("trend rendering: minimal mode keeps the compact average and shows only the direction arrow above its unit", () => {
  const el = trendCard("temperature", 0.2);
  const avg = el.shadowRoot.querySelector(".rtc-avg-button");
  const value = avg.querySelector(".rtc-avg-value");
  const unit = avg.querySelector(".rtc-avg-value-unit");
  const arrow = avg.querySelector(".rtc-avg-trend-arrow");

  assert.equal(avg.classList.contains("rtc-has-trend"), true);
  assert.equal(avg.dataset.trendDirection, "rising");
  assert.equal(arrow.hidden, false);
  assert.equal(arrow.textContent.trim(), "", "the arrow must never be a Unicode/emoji glyph");
  const svg = arrow.querySelector("svg.rtc-avg-trend-arrow-svg");
  const path = svg?.querySelector("path");
  assert.ok(svg, "the direction indicator must use the platform-independent inline SVG");
  assert.equal(svg.getAttribute("viewBox"), "0 0 16 16");
  assert.equal(svg.getAttribute("fill"), "none");
  assert.equal(svg.getAttribute("stroke"), "currentColor");
  assert.ok(path?.getAttribute("d"), "the SVG must contain the minimalist arrow path");
  assert.equal(avg.querySelector(".rtc-avg-trend"), null, "the signed rate must not leave a hidden placeholder in average");
  assert.equal(avg.querySelector(".rtc-avg-reading"), null, "the 2.33 label/value structure must be restored");
  assert.deepEqual(
    Array.from(avg.children, (child) => child.className),
    ["rtc-avg-value"],
    "a primary-only card omits the redundant label row while retaining the compact value row"
  );
  assert.equal(value.contains(unit), true);
  assert.equal(value.contains(arrow), true);
  assert.match(avg.getAttribute("aria-label"), /rising/i);
  assert.match(avg.getAttribute("aria-label"), /\+0\.2 °C\/h/);
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-footer"), null, "historical minimal mode has no visible rate without a room-bound scale footer");
  env.cleanup(el);
});

test("trend rendering: all four metrics expose semantic direction, SVG indicator, signed text, and display unit", () => {
  const cases = [
    ["temperature", -0.2, "falling", "-0.2 °C/h"],
    ["humidity", 0.5, "stable", "+0.5 %/h"],
    ["co2", 26, "rising", "+26 ppm/h"],
    ["pm25", 0, "stable", "0.0 µg/m³/h"],
  ];

  for (const [metric, value, direction, text] of cases) {
    const el = trendCard(metric, value);
    const data = el._computeViewModel();
    const avg = el.shadowRoot.querySelector(".rtc-avg-button");
    assert.equal(data.trend.model.direction, direction);
    assert.equal(Object.hasOwn(data.trend.model, "symbol"), false, "presentation glyphs do not belong in the trend data model");
    assert.equal(avg.dataset.trendDirection, direction);
    assert.equal(avg.querySelectorAll(".rtc-avg-trend-arrow svg").length, 1);
    assert.equal(avg.querySelector(".rtc-avg-trend-arrow").textContent.trim(), "");
    assert.equal(avg.querySelector(".rtc-avg-trend"), null);
    assert.equal(internals.trendText(el, data.trend.model), text);
    env.cleanup(el);
  }
});

test("trend rendering: negative zero is normalized to an unsigned zero", () => {
  const el = trendCard("temperature", 0);
  assert.equal(internals.trendText(el, { value: -0, unit: "°C/h" }), "0.0 °C/h");
  env.cleanup(el);
});

test("scale footer: a valid configured trend is restored as the localized third segment", () => {
  const rooms = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }];
  const el = trendCard(
    "temperature",
    0.2,
    { rooms, views: [{ type: "scale" }] },
    {
      "sensor.r1": mkState("sensor.r1", 21, {
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
      "sensor.r2": mkState("sensor.r2", 23, {
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
    }
  );
  const data = el._computeViewModel();
  const footer = el.shadowRoot.querySelector(".rtc-scale-view .rtc-scale-footer");
  assert.ok(footer);
  assert.match(footer.textContent, /comfort/i);
  assert.match(footer.textContent, /spread/i);
  assert.match(footer.textContent, /trend \+0\.2 °C\/h/i);
  assert.equal(internals.footerText(el, "scale").split("·").length, 3);
  env.cleanup(el);
});

test("trend live updates: direction, footer text, visibility, and ARIA patch without replacing the focused average node", () => {
  const rooms = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }];
  const roomStates = {
    "sensor.r1": mkState("sensor.r1", 21, {
      device_class: "temperature",
      unit_of_measurement: "°C",
    }),
    "sensor.r2": mkState("sensor.r2", 23, {
      device_class: "temperature",
      unit_of_measurement: "°C",
    }),
  };
  const el = trendCard("temperature", 0.2, { rooms, views: [{ type: "scale" }] }, roomStates);
  const avg = el.shadowRoot.querySelector("button.rtc-avg-button");
  const footerNode = el.shadowRoot.querySelector(".rtc-scale-view .rtc-scale-footer");
  const arrowNode = avg.querySelector(".rtc-avg-trend-arrow");
  const arrowSvg = arrowNode.querySelector("svg");
  avg.focus();

  const statesFor = (trendState) =>
    mkHass({
      "sensor.avg": mkState("sensor.avg", 22, {
        device_class: "temperature",
        unit_of_measurement: "°C",
      }),
      "sensor.trend": mkState("sensor.trend", trendState, {
        unit_of_measurement: "°C/h",
      }),
      ...roomStates,
    });

  el.hass = statesFor(0);
  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), avg);
  assert.equal(el.shadowRoot.activeElement, avg);
  assert.equal(el.shadowRoot.querySelector(".rtc-scale-view .rtc-scale-footer"), footerNode);
  assert.equal(avg.querySelector(".rtc-avg-trend-arrow"), arrowNode);
  assert.equal(avg.querySelector(".rtc-avg-trend-arrow svg"), arrowSvg);
  assert.equal(avg.querySelector(".rtc-avg-trend"), null);
  assert.equal(avg.dataset.trendDirection, "stable");
  assert.equal(arrowNode.textContent.trim(), "");
  assert.match(footerNode.textContent, /Trend 0\.0 °C\/h/);

  el.hass = statesFor(-0.2);
  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), avg);
  assert.equal(avg.querySelector(".rtc-avg-trend-arrow svg"), arrowSvg);
  assert.equal(avg.dataset.trendDirection, "falling");
  assert.equal(arrowNode.textContent.trim(), "");
  assert.match(footerNode.textContent, /Trend -0\.2 °C\/h/);

  el.hass = statesFor("unavailable");
  assert.equal(el.shadowRoot.querySelector("button.rtc-avg-button"), avg);
  assert.equal(el.shadowRoot.activeElement, avg);
  assert.equal(avg.classList.contains("rtc-has-trend"), false);
  assert.equal(avg.hasAttribute("data-trend-direction"), false);
  assert.equal(arrowNode.hidden, true);
  assert.doesNotMatch(footerNode.textContent, /Trend/i);
  assert.equal(footerNode.textContent.split("·").length, 2);
  assert.doesNotMatch(avg.getAttribute("aria-label"), /trend/i);
  env.cleanup(el);
});

test("trend footer: visibility options and RangeScale keep the rate out of every non-Scale footer", () => {
  const rooms = [{ entity: "sensor.r1" }, { entity: "sensor.r2" }];
  const roomStates = {
    "sensor.r1": mkState("sensor.r1", 21, TEMPERATURE_C),
    "sensor.r2": mkState("sensor.r2", 23, TEMPERATURE_C),
  };
  const hidden = trendCard(
    "temperature",
    0.2,
    { rooms, views: [{ type: "scale" }], hide_footer: true },
    roomStates
  );
  assert.equal(hidden.shadowRoot.querySelector(".rtc-scale-footer"), null);
  assert.equal(hidden.shadowRoot.querySelector(".rtc-avg-trend"), null);
  env.cleanup(hidden);

  const rangeScale = trendCard(
    "temperature",
    0.2,
    {
      rooms,
      range_entity: "sensor.range",
      views: [{ type: "range_scale", enabled: true }],
    },
    {
      ...roomStates,
      "sensor.range": mkState("sensor.range", 4, {
        unit_of_measurement: "°C",
        minimum: 20,
        maximum: 24,
      }),
    }
  );
  const rangeFooter = rangeScale.shadowRoot.querySelector(".rtc-range-scale-view .rtc-scale-footer");
  assert.ok(rangeFooter);
  assert.doesNotMatch(rangeFooter.textContent, /Trend|0\.2 °C\/h/i);
  env.cleanup(rangeScale);
});

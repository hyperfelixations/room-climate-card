"use strict";

// Generic regression net for the unit-spelling-normalization bug class that
// made 2.21.1's PM2.5 hotfix necessary (see room-climate-card.js's
// normalizeUnitToken() and pm25-unit-regression.test.js for the original,
// PM2.5-specific incident). The underlying issue was never PM2.5-specific:
// _resolveUnitProfileKey() compares an entity's raw unit_of_measurement
// against METRIC_DEFINITIONS' registered `units` arrays, and any metric kind
// can in principle have a real-world Home Assistant integration reporting a
// technically-equivalent but differently-spelled unit (case, whitespace, or
// an NFKC-compatible Unicode variant like "℃"/"℉"/full-width "％"). This
// file exercises that same equivalence class across ALL FOUR registered
// metric kinds, not just the one that happened to be reported in production,
// so the next such incident is caught here instead of after a user report.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestEnvironment } = require("../helpers/load-card.jsdom.js");
const { mkState, mkHass } = require("../helpers/hass-fixtures.js");
const { computeLegacyData } = require("../helpers/legacy-dto.js");

let env;

test.before(() => {
  env = createTestEnvironment();
});
test.after(() => {
  env.cleanupAll();
});

// metricKind -> { deviceClass, profiles: { profileKey: [equivalent raw unit_of_measurement spellings] } }
const CASES = {
  temperature: {
    deviceClass: "temperature",
    profiles: {
      celsius: ["°C", "°c", "  C  ", "CELSIUS", "℃"],
      fahrenheit: ["°F", "  f  ", "FAHRENHEIT", "℉"],
      kelvin: ["K", "  k  ", "KELVIN"],
    },
  },
  humidity: {
    deviceClass: "humidity",
    profiles: {
      percent: ["%", " % ", "％"], // "％" (U+FF05) is the NFKC-compatible full-width percent sign
    },
  },
  co2: {
    deviceClass: "carbon_dioxide",
    profiles: {
      ppm: ["ppm", "PPM", " ppm ", "Ppm"],
    },
  },
  pm25: {
    deviceClass: "pm25",
    profiles: {
      // Deliberately overlaps in spirit (not verbatim) with
      // pm25-unit-regression.test.js's own matrix — that file locks in the
      // exact reported production incident and a full dashboard fixture;
      // this file's pm25 row exists only so PM2.5 isn't silently excluded
      // from the generic per-metric-kind sweep below.
      microgram_per_m3: ["µg/m³", "μg/m³", "ug/m3", "µg/m3", "μg/m^3", " µg / m³ "],
    },
  },
};

for (const [metricKind, { deviceClass, profiles }] of Object.entries(CASES)) {
  for (const [profileKey, variants] of Object.entries(profiles)) {
    test(`${metricKind}/${profileKey}: all real-world unit spellings resolve to the same UnitProfile`, () => {
      for (const [index, unit] of variants.entries()) {
        const entityId = `sensor.${metricKind}_${profileKey}_${index}`;
        const el = env.createCard({ entity: entityId }, mkHass({
          [entityId]: mkState(entityId, 21, { device_class: deviceClass, unit_of_measurement: unit }),
        }));

        const model = el._buildEntityModel(entityId, "primary");
        assert.equal(model.metricKind, metricKind, `metricKind for ${JSON.stringify(unit)}`);
        assert.equal(model.unitProfile, profileKey, `unitProfile for ${JSON.stringify(unit)}`);
        assert.equal(model.validUnit, true, `validUnit for ${JSON.stringify(unit)}`);
        assert.equal(computeLegacyData(el).empty, false, `card must not be empty for ${JSON.stringify(unit)}`);
        env.cleanup(el);
      }
    });
  }
}

test("cross-check: a genuinely different unit for a given metric kind is still correctly rejected (the normalization must not become overly permissive)", () => {
  const cases = [
    { deviceClass: "temperature", unit: "hPa" },
    { deviceClass: "humidity", unit: "ppm" },
    { deviceClass: "carbon_dioxide", unit: "%" },
    { deviceClass: "pm25", unit: "mg/m³" }, // a real but different concentration unit, not equivalent to µg/m³
  ];
  for (const [index, { deviceClass, unit }] of cases.entries()) {
    const entityId = `sensor.mismatch_${index}`;
    const el = env.createCard({ entity: entityId }, mkHass({
      [entityId]: mkState(entityId, 21, { device_class: deviceClass, unit_of_measurement: unit }),
    }));
    const model = el._buildEntityModel(entityId, "primary");
    assert.equal(model.unitProfile, null, `${deviceClass} + ${JSON.stringify(unit)} must not resolve to any profile`);
    assert.equal(model.validUnit, false, `${deviceClass} + ${JSON.stringify(unit)} must be flagged unusable`);
    env.cleanup(el);
  }
});

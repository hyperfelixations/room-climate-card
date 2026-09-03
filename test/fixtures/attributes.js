"use strict";

// The attribute pairs the suite keeps writing out, named once. `{ device_class:
// "temperature", unit_of_measurement: "°C" }` and a dozen siblings appeared hundreds of
// times; each is a place the suite can drift from the product. Derived from METRICS in
// ../manifests/product-surface.js, not restated. A fixture whose whole purpose is to be
// wrong (a thermometer reporting hectopascals) stays inline with its own comment — naming
// it would hide the mismatch the test is about. The shape is a Home Assistant state
// object's attributes, so these go straight into mkStateObj(…) and a scenario() description.

const { METRICS } = require("../manifests/product-surface.js");

// One metric, spelled the way a correctly configured sensor spells it.
function attributesFor(metric, unit) {
  return Object.freeze({
    device_class: METRICS[metric].deviceClass,
    unit_of_measurement: unit === undefined ? METRICS[metric].canonicalUnit : unit,
  });
}

// A sensor that declares its metric but no unit — the card identifies the metric from device_class alone.
function classOnly(metric) {
  return Object.freeze({ device_class: METRICS[metric].deviceClass });
}

// The four metrics with their canonical units.
const TEMPERATURE_C = attributesFor("temperature");
const HUMIDITY = attributesFor("humidity");
const CO2 = attributesFor("co2");
const PM25 = attributesFor("pm25");

// The other units the card converts between; only temperature has any (asserted, not assumed).
const TEMPERATURE_F = attributesFor("temperature", "°F");
const TEMPERATURE_K = attributesFor("temperature", "K");

// The class without the unit, per metric.
const TEMPERATURE = classOnly("temperature");
const HUMIDITY_CLASS_ONLY = classOnly("humidity");
const CO2_CLASS_ONLY = classOnly("co2");
const PM25_CLASS_ONLY = classOnly("pm25");

// Every named pair, so a test can iterate the whole set — and so the guard below can check
// that each one still agrees with the manifest.
const ALL = Object.freeze({
  TEMPERATURE_C,
  TEMPERATURE_F,
  TEMPERATURE_K,
  TEMPERATURE,
  HUMIDITY,
  HUMIDITY_CLASS_ONLY,
  CO2,
  CO2_CLASS_ONLY,
  PM25,
  PM25_CLASS_ONLY,
});

module.exports = {
  attributesFor,
  classOnly,
  ALL,
  TEMPERATURE_C,
  TEMPERATURE_F,
  TEMPERATURE_K,
  TEMPERATURE,
  HUMIDITY,
  HUMIDITY_CLASS_ONLY,
  CO2,
  CO2_CLASS_ONLY,
  PM25,
  PM25_CLASS_ONLY,
};

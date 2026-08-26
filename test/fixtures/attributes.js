"use strict";

// THE ATTRIBUTE PAIRS THE SUITE KEEPS WRITING OUT, named once.
//
// `{ device_class: "temperature", unit_of_measurement: "°C" }` appeared 364 times across 65
// files, and twelve other pairs made up the rest of 550. Written out, every one of them is a
// place the suite can drift from the product: a metric whose canonical unit changed would
// leave hundreds of fixtures quietly describing a sensor Home Assistant no longer produces,
// and the tests would go on passing against a card nobody has.
//
// DERIVED FROM THE MANIFEST, NOT RESTATED. Every constant below is built from METRICS in
// ../contracts/product-surface.js, which is the suite's single statement of what the card
// supports. Restating "°C" here would only move the duplication one file further away.
//
// WHAT DELIBERATELY STAYS INLINE. A fixture whose whole purpose is to be WRONG — a
// thermometer reporting hectopascals, a `pressure` sensor the card does not handle — is not
// covered here and must not be. Naming it would hide the very thing the test is about, and
// the reader of that test needs to see the mismatch on the line in front of them. Those
// fixtures carry a comment saying why instead.
//
// The shape matches what the card reads off a Home Assistant state object, so these go
// straight into mkStateObj(…) and into a `scenario()` description alike.

const { METRICS } = require("../contracts/product-surface.js");

// One metric, spelled the way a correctly configured sensor spells it.
function attributesFor(metric, unit) {
  return Object.freeze({
    device_class: METRICS[metric].deviceClass,
    unit_of_measurement: unit === undefined ? METRICS[metric].canonicalUnit : unit,
  });
}

// A sensor that states what it measures and says nothing about the unit. Common enough in
// the wild to be worth a name: the card has to identify the metric from the device class
// alone, and several tests exist to prove it does.
function classOnly(metric) {
  return Object.freeze({ device_class: METRICS[metric].deviceClass });
}

// The four metrics with their canonical units — the overwhelming majority of every fixture
// in the suite.
const TEMPERATURE_C = attributesFor("temperature");
const HUMIDITY = attributesFor("humidity");
const CO2 = attributesFor("co2");
const PM25 = attributesFor("pm25");

// The other units the card converts between. Only temperature has any; the manifest says so
// and this asserts it rather than assuming it, because a metric that gained a second unit
// would otherwise leave this file silently incomplete.
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
